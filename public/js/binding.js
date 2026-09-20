// Two-way binding between a Monaco text model and a Y.Text, plus remote cursors/selections.
const LOCAL = Symbol("local");

export function bindModel(monaco, model, ytext, isEditable = () => true) {
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
    /** Replace the whole text through Yjs (used when switching language templates). */
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

/** Renders other people's cursors and selections as Monaco decorations, only for the file shown. */
export function createRemoteCursors(monaco, editor, getActiveFile) {
  const style = document.head.appendChild(document.createElement("style"));
  const state = new Map(); // peerId -> {name, color, sel}
  const collections = new Map(); // peerId -> decorations collection
  const cssId = (peerId) => peerId.replace(/[^a-zA-Z0-9]/g, "");
  const safeName = (n) => String(n).replace(/[^\p{L}\p{N} _.-]/gu, "").slice(0, 24) || "Guest";
  const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? c : "#7fb7f5");

  const rebuildStyles = () => {
    style.textContent = [...state].map(([id, { name, color }]) => {
      const c = cssId(id), col = safeColor(color);
      return `.rc-${c}{position:relative;border-left:2px solid ${col};margin-left:-1px}` +
        `.rc-${c}::before{content:"${safeName(name)}";position:absolute;transform:translateY(-100%);background:${col};color:#10120f;font:700 10px/1 "Barlow Condensed",system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;padding:2px 5px;border-radius:2px 2px 2px 0;white-space:nowrap;pointer-events:none}` +
        `.rs-${c}{background:${col}33}`;
    }).join("\n");
  };

  function render(peerId) {
    const s = state.get(peerId);
    const coll = collections.get(peerId);
    const model = editor.getModel();
    if (!s?.sel || !model || (s.sel.file ?? "") !== getActiveFile()) { coll?.clear(); return; }
    const clamp = (n) => Math.max(0, Math.min(model.getValueLength(), Number.isFinite(n) ? n : 0));
    const a = model.getPositionAt(clamp(s.sel.anchor)), h = model.getPositionAt(clamp(s.sel.head));
    const c = cssId(peerId);
    const decorations = [{
      range: new monaco.Range(h.lineNumber, h.column, h.lineNumber, h.column),
      options: { afterContentClassName: `rc-${c}`, stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges },
    }];
    if (a.lineNumber !== h.lineNumber || a.column !== h.column) {
      decorations.push({ range: new monaco.Range(a.lineNumber, a.column, h.lineNumber, h.column), options: { className: `rs-${c}` } });
    }
    (collections.get(peerId) ?? collections.set(peerId, editor.createDecorationsCollection()).get(peerId)).set(decorations);
  }

  return {
    update(peerId, next) {
      if (!next) {
        collections.get(peerId)?.clear();
        collections.delete(peerId);
        state.delete(peerId);
        rebuildStyles();
        return;
      }
      const prev = state.get(peerId);
      state.set(peerId, next);
      if (!prev || prev.name !== next.name || prev.color !== next.color) rebuildStyles();
      render(peerId);
    },
    /** Call after switching files so cursors appear only where their owner is. */
    refresh() { for (const id of state.keys()) render(id); },
  };
}
