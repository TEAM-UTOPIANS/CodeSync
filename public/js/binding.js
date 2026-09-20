// Two-way binding between a Monaco text model and a Y.Text, plus remote cursors/selections.
const LOCAL = Symbol("local");

export function bindEditor(monaco, editor, ytext, isEditable = () => true) {
  const model = editor.getModel();
  model.setEOL(monaco.editor.EndOfLineSequence.LF);
  let applyingRemote = false;

  const initial = ytext.toString();
  if (model.getValue() !== initial) model.setValue(initial);

  // Monaco -> Yjs. All changes in one event refer to the pre-change document,
  // so apply them from the end backwards to keep offsets valid.
  const sub = model.onDidChangeContent((e) => {
    if (applyingRemote) return;
    if (!isEditable()) {
      // A viewer changed the model without the UI (for example from devtools). Put the shared text back.
      applyingRemote = true;
      try { model.setValue(ytext.toString()); } finally { applyingRemote = false; }
      return;
    }
    ytext.doc.transact(() => {
      for (const c of [...e.changes].sort((a, b) => b.rangeOffset - a.rangeOffset)) {
        if (c.rangeLength) ytext.delete(c.rangeOffset, c.rangeLength);
        if (c.text) ytext.insert(c.rangeOffset, c.text);
      }
    }, LOCAL);
  });

  // Yjs -> Monaco. Delta positions are relative to the document before the change, which is
  // exactly what model.applyEdits expects.
  const observer = (event, txn) => {
    if (txn.origin === LOCAL) return;
    let pos = 0;
    const edits = [];
    const rangeOf = (a, b) => {
      const s = model.getPositionAt(a), e = model.getPositionAt(b);
      return new monaco.Range(s.lineNumber, s.column, e.lineNumber, e.column);
    };
    for (const d of event.delta) {
      if (d.retain) pos += d.retain;
      else if (d.delete) { edits.push({ range: rangeOf(pos, pos + d.delete), text: "" }); pos += d.delete; }
      else if (typeof d.insert === "string") edits.push({ range: rangeOf(pos, pos), text: d.insert });
    }
    applyingRemote = true;
    try { model.applyEdits(edits); } finally { applyingRemote = false; }
  };
  ytext.observe(observer);

  return {
    /** Replace the whole document through Yjs (used when switching language templates). */
    setText(text) {
      ytext.doc.transact(() => {
        ytext.delete(0, ytext.length);
        ytext.insert(0, text);
      }, LOCAL);
      applyingRemote = true;
      try { model.setValue(text); } finally { applyingRemote = false; }
    },
    dispose() { sub.dispose(); ytext.unobserve(observer); },
  };
}

/** Renders other people's cursors and selections as Monaco decorations. */
export function createRemoteCursors(monaco, editor) {
  const model = editor.getModel();
  const style = document.head.appendChild(document.createElement("style"));
  const known = new Map(); // peerId -> {name, color}
  const collections = new Map(); // peerId -> decorations collection
  const cssId = (peerId) => peerId.replace(/[^a-zA-Z0-9]/g, "");
  const safeName = (n) => String(n).replace(/[^\p{L}\p{N} _.-]/gu, "").slice(0, 24) || "Guest";

  const rebuildStyles = () => {
    style.textContent = [...known].map(([id, { name, color }]) => {
      const c = cssId(id);
      return `.rc-${c}{position:relative;border-left:2px solid ${color};margin-left:-1px}` +
        `.rc-${c}::before{content:"${safeName(name)}";position:absolute;transform:translateY(-100%);background:${color};color:#fff;font:600 10px/1 Geist,system-ui,sans-serif;padding:2px 5px;border-radius:3px 3px 3px 0;white-space:nowrap;pointer-events:none}` +
        `.rs-${c}{background:${color}33}`;
    }).join("\n");
  };

  const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? c : "#4f8dff");
  const clamp = (n) => Math.max(0, Math.min(model.getValueLength(), Number.isFinite(n) ? n : 0));

  return {
    update(peerId, state) {
      let coll = collections.get(peerId);
      if (!state) {
        coll?.clear();
        collections.delete(peerId);
        known.delete(peerId);
        rebuildStyles();
        return;
      }
      const prev = known.get(peerId);
      const color = safeColor(state.color);
      if (!prev || prev.name !== state.name || prev.color !== color) {
        known.set(peerId, { name: state.name, color });
        rebuildStyles();
      }
      if (!state.sel) return;
      if (!coll) collections.set(peerId, (coll = editor.createDecorationsCollection()));
      const a = model.getPositionAt(clamp(state.sel.anchor)), h = model.getPositionAt(clamp(state.sel.head));
      const c = cssId(peerId);
      const decorations = [{
        range: new monaco.Range(h.lineNumber, h.column, h.lineNumber, h.column),
        options: { afterContentClassName: `rc-${c}`, stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges },
      }];
      if (a.lineNumber !== h.lineNumber || a.column !== h.column) {
        decorations.push({
          range: new monaco.Range(a.lineNumber, a.column, h.lineNumber, h.column),
          options: { className: `rs-${c}` },
        });
      }
      coll.set(decorations);
    },
  };
}
