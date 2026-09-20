// A project is a set of files. Each file is a Y.Text inside a Y.Map called "files", with a Y.Array
// "order" for tab order, and each open file gets its own Monaco model.
import { Y } from "./net.js";
import { bindModel } from "./binding.js";
import { monacoForFile, validFileName } from "./languages.js";

export const MAX_FILES = 12;

export function createProject({ doc, monaco, editor, isEditable, onTabs, onActive, onChange }) {
  const files = doc.getMap("files");
  const order = doc.getArray("order");
  const entries = new Map(); // name -> {model, ytext, binding}
  let active = null;

  const names = () => {
    const ordered = order.toArray().filter((n, i, a) => files.has(n) && a.indexOf(n) === i);
    return [...ordered, ...[...files.keys()].filter((n) => !ordered.includes(n)).sort()];
  };

  function sync() {
    for (const name of files.keys()) {
      if (entries.has(name)) continue;
      const ytext = files.get(name);
      if (!(ytext instanceof Y.Text)) continue;
      const model = monaco.editor.createModel("", monacoForFile(name));
      entries.set(name, { model, ytext, binding: bindModel(monaco, model, ytext, isEditable) });
    }
    for (const [name, entry] of entries) {
      if (files.has(name)) continue;
      entry.binding.dispose();
      entry.model.dispose();
      entries.delete(name);
    }
    if (!entries.size) { active = null; onTabs(); return; }
    if (!active || !entries.has(active)) open(names()[0]);
    else onTabs();
  }

  function open(name) {
    const entry = entries.get(name);
    if (!entry) return;
    active = name;
    editor.setModel(entry.model);
    onActive(name);
    onTabs();
  }

  files.observeDeep((events) => {
    const structural = events.some((e) => e.target === files);
    if (structural) sync();
    onChange(structural);
  });
  order.observe(() => onTabs());

  const reserve = (name) => validFileName(name) && !files.has(name) && files.size < MAX_FILES;

  return {
    get active() { return active; },
    names,
    has: (name) => files.has(name),
    open,
    sync,
    create(name, content = "") {
      if (!reserve(name)) return false;
      doc.transact(() => { files.set(name, new Y.Text(content)); order.push([name]); });
      sync();
      open(name);
      return true;
    },
    remove(name) {
      if (files.size <= 1 || !files.has(name)) return false;
      doc.transact(() => {
        files.delete(name);
        const i = order.toArray().indexOf(name);
        if (i >= 0) order.delete(i, 1);
      });
      sync();
      return true;
    },
    rename(from, to) {
      if (from === to || !files.has(from) || !validFileName(to) || files.has(to)) return false;
      const content = files.get(from).toString();
      doc.transact(() => {
        files.set(to, new Y.Text(content));
        const list = order.toArray();
        const i = list.indexOf(from);
        if (i >= 0) { order.delete(i, 1); order.insert(i, [to]); } else order.push([to]);
        files.delete(from);
      });
      const wasActive = active === from;
      sync();
      if (wasActive) open(to);
      return true;
    },
    setText(name, text) { entries.get(name)?.binding.setText(text); },
    text: (name) => files.get(name)?.toString() ?? "",
    all: () => names().map((name) => ({ name, code: files.get(name)?.toString() ?? "" })),
    /** Older rooms stored one file in a Y.Text called "code": move it into the file map. */
    migrateLegacy(fallbackName) {
      const legacy = doc.getText("code");
      if (files.size === 0 && legacy.length > 0) {
        doc.transact(() => { files.set(fallbackName, new Y.Text(legacy.toString())); order.push([fallbackName]); legacy.delete(0, legacy.length); });
      }
      sync();
    },
  };
}
