import { Y, persist, connectRoom, serverUrl } from "./net.js";
import { connectPeers } from "./p2p.js";
import { createRemoteCursors } from "./binding.js";
import { createProject, MAX_FILES } from "./project.js";
import { LANGUAGES, LANGUAGE_IDS, GROUPS, languageForFile, extOf, validFileName } from "./languages.js";
import { runCode } from "./runners.js";
import { buildPreview, previewEntry } from "./preview.js";
import { encodeSnapshot, decodeSnapshot } from "./snapshot.js";
import { THEMES, savedPreference, resolveTheme, setTheme, defineMonacoTheme } from "./themes.js";
import { toast, langTile, anchorMenu, createPalette } from "./ui.js";

const $ = (id) => document.getElementById(id);
const store = {
  get: (k) => { try { return localStorage.getItem(`codesync:${k}`); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(`codesync:${k}`, v); } catch { /* storage unavailable */ } },
  del: (k) => { try { localStorage.removeItem(`codesync:${k}`); } catch { /* storage unavailable */ } },
};
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl";
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const icon = (name) => el("i", `ph ${name}`);
const BASE_NAME = "main";

/* ── Mode: /r/<room> (shared) or /play (local) ───────────────────── */
const roomMatch = location.pathname.match(/^\/r\/([a-z0-9-]{4,40})\/?$/i);
const solo = !roomMatch;
if (solo && !location.pathname.startsWith("/play")) location.replace("/");
const roomId = solo ? "solo" : roomMatch[1].toLowerCase();
const snapMatch = solo ? location.hash.match(/[#&]s=([\w-]+)/) : null;
const snapFragment = snapMatch ? snapMatch[1] : null;
const hash32 = (s) => { let h = 5381; for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0; return h.toString(16); };
const docKey = solo ? (snapFragment ? `snap-${hash32(snapFragment)}` : "solo") : roomId;
const useServer = !solo && Boolean(serverUrl());

$("room-name").textContent = solo ? (snapFragment ? "snapshot" : "playground") : roomId;
$("room-id").querySelector("i").className = `ph ${solo ? "ph-laptop" : "ph-broadcast"}`;
$("run-kbd").textContent = `${MOD} ↵`;
document.title = solo ? "CodeSync playground" : `CodeSync ${roomId}`;
if (solo) { $("workspace").classList.add("side-closed"); $("side-toggle").hidden = true; }

/* ── Settings and theme ──────────────────────────────────────────── */
const settings = { fontSize: 14, wrap: false, minimap: false, ligatures: true, ...JSON.parse(store.get("settings") || "{}") };
const saveSettings = () => store.set("settings", JSON.stringify(settings));
let monacoRef = null;
const themeSelect = $("set-theme");
themeSelect.append(new Option("Match system", "system"), ...THEMES.map((t) => new Option(t.label, t.id)));
const syncThemeUi = () => { themeSelect.value = THEMES.some((t) => t.id === savedPreference()) ? savedPreference() : "system"; };
syncThemeUi();
document.addEventListener("themechange", () => { if (monacoRef) defineMonacoTheme(monacoRef); syncThemeUi(); });
matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { if (savedPreference() === "system") setTheme("system"); });
themeSelect.addEventListener("change", (e) => setTheme(e.target.value));
$("theme").addEventListener("click", () => {
  const ids = THEMES.map((t) => t.id);
  setTheme(ids[(ids.indexOf(document.documentElement.dataset.theme) + 1) % ids.length]);
  toast(`${THEMES.find((t) => t.id === document.documentElement.dataset.theme).label} theme`, "ph-palette");
});

/* ── Monaco ──────────────────────────────────────────────────────── */
const MONACO_BASE = "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min";
function loadMonaco() {
  window.MonacoEnvironment = {
    getWorkerUrl: () => `data:text/javascript;charset=utf-8,${encodeURIComponent(
      `self.MonacoEnvironment={baseUrl:"${MONACO_BASE}/"};importScripts("${MONACO_BASE}/vs/base/worker/workerMain.js");`)}`,
  };
  window.require.config({ paths: { vs: `${MONACO_BASE}/vs` } });
  return new Promise((resolve, reject) => window.require(["vs/editor/editor.main"], () => resolve(window.monaco), reject));
}

function registerMiniLang(monaco) {
  monaco.languages.register({ id: "minilang" });
  monaco.languages.setMonarchTokensProvider("minilang", {
    ignoreCase: true,
    keywords: ["START", "STOP", "LET", "PRINT", "IF", "THEN", "ELSE", "END", "INPUT"],
    tokenizer: {
      root: [
        [/#.*$/, "comment"],
        [/"/, "string", "@string"],
        [/\d+(\.\d+)?/, "number"],
        [/[a-zA-Z_]\w*/, { cases: { "@keywords": "keyword", "@default": "identifier" } }],
        [/[<>=!]=?|[+\-*/]/, "operator"],
      ],
      string: [[/\\./, "string.escape"], [/[^\\"]+/, "string"], [/"/, "string", "@pop"]],
    },
  });
  monaco.languages.setLanguageConfiguration("minilang", {
    comments: { lineComment: "#" },
    brackets: [["(", ")"]],
    autoClosingPairs: [{ open: "(", close: ")" }, { open: '"', close: '"', notIn: ["string"] }],
  });
}

/* ── Entry gate: name (and passcode when the room asks for one) ──── */
const gate = {
  dialog: $("gate"),
  show({ title, text, needName = true, needPass = false, error = "", action = "Enter room", home = false }) {
    $("gate-title").textContent = title;
    $("gate-text").textContent = text;
    $("gate-name").hidden = !needName;
    $("gate-pass").hidden = !needPass;
    $("gate-error").textContent = error;
    $("gate-submit").textContent = action;
    $("gate-submit").hidden = !action;
    $("gate-home").hidden = !home;
    if (!this.dialog.open) this.dialog.showModal();
    (needPass ? $("gate-pass") : needName ? $("gate-name") : $("gate-submit")).focus();
    return new Promise((resolve) => {
      $("gate-form").onsubmit = (e) => {
        e.preventDefault();
        resolve({ name: $("gate-name").value.trim().slice(0, 20), passcode: $("gate-pass").value });
      };
    });
  },
  close() { if (this.dialog.open) this.dialog.close(); },
};
gate.dialog.addEventListener("cancel", (e) => e.preventDefault());

async function askName() {
  const saved = store.get("name");
  if (saved) return saved;
  const adjectives = ["Curious", "Swift", "Quiet", "Bright", "Lucky", "Sneaky", "Brave", "Calm"];
  const animals = ["Otter", "Fox", "Heron", "Lynx", "Panda", "Falcon", "Gecko", "Koala"];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  $("gate-name").value = `${pick(adjectives)} ${pick(animals)}`;
  const { name } = await gate.show({ title: "Join the room", text: "Pick a name. It appears next to your cursor and in chat." });
  const final = name || "Guest";
  store.set("name", final);
  return final;
}

/* ── Main ────────────────────────────────────────────────────────── */
async function main() {
  const monacoReady = loadMonaco();
  const myName = solo ? store.get("name") || "You" : await askName();
  const monaco = await monacoReady;
  monacoRef = monaco;
  registerMiniLang(monaco);
  $("loading").remove();

  const editor = monaco.editor.create($("editor"), {
    model: null,
    automaticLayout: true,
    fontFamily: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace',
    fontSize: settings.fontSize, fontLigatures: settings.ligatures,
    wordWrap: settings.wrap ? "on" : "off", minimap: { enabled: settings.minimap },
    scrollBeyondLastLine: false, padding: { top: 16, bottom: 16 }, smoothScrolling: true,
    cursorSmoothCaretAnimation: "on", tabSize: 4, renderLineHighlight: "gutter",
    bracketPairColorization: { enabled: true },
    readOnlyMessage: { value: "You are a viewer. Ask the host for edit access." },
  });
  defineMonacoTheme(monaco);

  /* State -------------------------------------------------------- */
  let role = solo ? null : useServer ? "viewer" : "editor"; // until the server answers, assume least privilege
  let users = [];
  let settingsState = { defaultRole: "editor", locked: false, hasPasscode: false };
  let connection = solo ? "local" : "connecting";
  let p2pMode = false;
  let p2pNoticeDismissed = false;
  let net = null;
  let myId = null;
  let requested = false;
  const requests = new Map();
  const canEdit = () => solo || role === "host" || role === "editor";

  /* Document and project ---------------------------------------- */
  const doc = new Y.Doc();
  persist(doc, docKey);
  let previewTimer;
  const project = createProject({
    doc, monaco, editor, isEditable: () => canEdit(),
    onTabs: () => { renderTabs(); refreshFileState(); },
    onActive: () => { refreshFileState(); cursors.refresh(); sendSelection(); },
    onChange: () => { clearTimeout(previewTimer); previewTimer = setTimeout(updatePreview, 350); },
  });
  const cursors = createRemoteCursors(monaco, editor, () => project.active ?? "");

  /* Console tabs ------------------------------------------------- */
  const panes = { output: $("output"), stdin: $("stdin-pane"), preview: $("preview-pane") };
  let currentTab = "output";
  function selectTab(name) {
    currentTab = name;
    for (const [key, node] of Object.entries(panes)) {
      node.hidden = key !== name;
      $(`tab-${key}`).setAttribute("aria-selected", String(key === name));
    }
  }
  for (const key of Object.keys(panes)) $(`tab-${key}`).addEventListener("click", () => selectTab(key));

  /* Files, language, preview ------------------------------------ */
  let remoteInfo = {};
  const fileLang = (name) => languageForFile(name);
  const runtimeLabel = (id) => {
    if (!id) return "Plain text";
    const l = LANGUAGES[id];
    if (l.runtime === "browser") return "Runs in your browser";
    if (l.runtime === "preview") return "Live preview";
    const info = remoteInfo[id];
    return info ? `${info.provider} ${info.version}` : "Compiles on a remote service";
  };
  const currentEntry = () => previewEntry(project.all(), project.active ?? "");

  function updatePreview() {
    const entry = currentEntry();
    $("tab-preview").hidden = !entry;
    if (!entry) { if (currentTab === "preview") selectTab("output"); return; }
    $("preview").srcdoc = buildPreview(project.all(), entry);
  }

  let lastLang = null;
  function refreshFileState() {
    const name = project.active;
    if (!name) return;
    const id = fileLang(name);
    const l = id ? LANGUAGES[id] : null;
    $("lang-icon").replaceChildren(l ? langTile(l, 20) : Object.assign(icon("ph-file-text"), {}));
    $("lang-label").textContent = l ? l.label : "Plain text";
    $("lang-status").textContent = name;
    $("runtime-info").textContent = runtimeLabel(id);
    if (l?.stdin && !$("stdin").value) $("stdin").value = l.stdin;
    if (id !== lastLang) {
      lastLang = id;
      if (id && LANGUAGES[id].runtime === "preview") selectTab("preview");
    }
    updatePreview();
  }

  /* Tabs --------------------------------------------------------- */
  const filebar = $("filebar");
  function inlineName(initial, onDone, anchorBefore = null) {
    const input = el("input", "field file-input");
    input.value = initial;
    input.setAttribute("aria-label", "File name");
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      input.remove();
      if (commit && value && value !== initial) onDone(value);
      renderTabs();
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") finish(true); else if (e.key === "Escape") finish(false); });
    input.addEventListener("blur", () => finish(true));
    if (anchorBefore) filebar.insertBefore(input, anchorBefore); else filebar.append(input);
    input.focus();
    input.select();
  }
  function fileError(name) {
    if (!validFileName(name)) toast("Use letters, numbers, dots, dashes and spaces (no slashes)", "ph-warning");
    else if (project.has(name)) toast(`${name} already exists`, "ph-warning");
    else toast(`A project can hold ${MAX_FILES} files`, "ph-warning");
  }
  function newFile() {
    if (!canEdit()) return;
    const id = fileLang(project.active) ?? "python";
    const suggestion = (() => { let i = 1, n; do { n = `file${i++}.${LANGUAGES[id].ext}`; } while (project.has(n)); return n; })();
    inlineName("", (name) => { if (!project.create(name, "")) fileError(name); }, filebar.querySelector(".file-new"));
    filebar.querySelector(".file-input").placeholder = suggestion;
  }
  function renderTabs() {
    filebar.replaceChildren();
    const editable = canEdit();
    for (const name of project.names()) {
      const tab = el("button", "file");
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(name === project.active));
      tab.title = editable ? "Double-click to rename" : name;
      const id = fileLang(name);
      tab.append(id ? langTile(LANGUAGES[id], 16) : icon("ph-file-text"), el("span", "", name));
      tab.addEventListener("click", () => { project.open(name); editor.focus(); });
      if (editable) {
        tab.addEventListener("dblclick", () => {
          tab.remove();
          inlineName(name, (to) => { if (!project.rename(name, to)) fileError(to); });
        });
        if (project.names().length > 1) {
          const x = el("button", "x");
          x.setAttribute("aria-label", `Close ${name}`);
          x.title = "Delete file";
          x.append(icon("ph-x"));
          x.addEventListener("click", (e) => {
            e.stopPropagation();
            if (confirm(`Delete ${name} for everyone in the project?`)) project.remove(name);
          });
          tab.append(x);
        }
      }
      filebar.append(tab);
    }
    if (editable && project.names().length < MAX_FILES) {
      const add = el("button", "file-new");
      add.title = "New file";
      add.setAttribute("aria-label", "New file");
      add.append(icon("ph-plus"));
      add.addEventListener("click", newFile);
      filebar.append(add);
    }
  }

  /* Changing the language of the open file renames its extension. */
  function setLanguage(id) {
    const name = project.active;
    if (!name) return;
    if (!canEdit()) { toast("Only editors can change the language", "ph-lock-simple"); return; }
    const current = fileLang(name);
    if (current === id) return;
    const base = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
    const target = `${base}.${LANGUAGES[id].ext}`;
    if (project.has(target)) { toast(`${target} already exists`, "ph-warning"); return; }
    const text = project.text(name).trim();
    const untouched = !text || (current && text === LANGUAGES[current].template.trim());
    if (!project.rename(name, target)) { fileError(target); return; }
    if (untouched) project.setText(target, LANGUAGES[id].template);
    $("stdin").value = LANGUAGES[id].stdin || "";
  }

  async function seedProject() {
    if (project.names().length) return;
    const snap = snapFragment ? await decodeSnapshot(snapFragment) : null;
    if (snap) {
      for (const f of snap.files) project.create(f.name, f.code);
      if (snap.active && project.has(snap.active)) project.open(snap.active);
      toast("Opened a shared snapshot", "ph-camera");
    } else {
      project.create(`${BASE_NAME}.${LANGUAGES.python.ext}`, LANGUAGES.python.template);
    }
  }

  fetch("/api/languages").then((r) => (r.ok ? r.json() : null)).then((j) => {
    if (!j?.languages) return;
    remoteInfo = j.languages;
    refreshFileState();
  }).catch(() => {});

  /* Output ------------------------------------------------------- */
  const out = $("output");
  let segments = [], budget = 0, placeholder = null;
  const setAspect = (text, cls = "") => {
    const a = $("aspect");
    a.className = `aspect ${cls}`;
    a.replaceChildren(...(cls ? [el("i", `lamp ${{ clear: "green", fault: "red", running: "amber" }[cls]}`)] : []), document.createTextNode(text));
  };
  function showPlaceholder(html, cls) {
    out.replaceChildren();
    placeholder = Object.assign(el("div", cls), { innerHTML: html });
    out.append(placeholder);
  }
  const showEmpty = () => showPlaceholder(`<i class="ph ph-terminal-window"></i><span>Run the code to see its output here</span><span><kbd>${MOD}</kbd> <kbd>↵</kbd></span>`, "empty");
  const showSkeleton = () => showPlaceholder("<i></i><i></i><i></i>", "skeleton");
  function clearOutput() { segments = []; budget = 200_000; showEmpty(); setAspect(""); }
  function write(text, cls = "stdout") {
    if (budget <= 0) return;
    placeholder?.remove(); placeholder = null;
    budget -= text.length;
    segments.push([text, cls]);
    out.append(el("span", cls, budget < 0 ? `${text.slice(0, text.length + budget)}\n... output truncated\n` : text));
    out.scrollTop = out.scrollHeight;
  }
  clearOutput();
  $("clear").addEventListener("click", () => { clearOutput(); monaco.editor.setModelMarkers(editor.getModel(), "run", []); });
  $("copy-output").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(segments.map(([t]) => t).join("")); toast("Output copied"); } catch { toast("Could not copy", "ph-warning"); }
  });
  editor.onDidChangeModelContent(() => monaco.editor.setModelMarkers(editor.getModel(), "run", []));

  /* Running code ------------------------------------------------- */
  const runBtn = $("run");
  let running = false;
  async function run() {
    if (running || !project.active) return;
    const name = project.active;
    const id = fileLang(name);
    const files = project.all();
    if (!id || LANGUAGES[id].runtime === "preview") {
      const entry = previewEntry(files, name);
      if (!entry) { toast("This file type cannot be run. Open a code file.", "ph-warning"); return; }
      updatePreview(); selectTab("preview"); toast("Preview refreshed", "ph-browser");
      return;
    }
    const l = LANGUAGES[id];
    running = true;
    runBtn.disabled = true;
    runBtn.className = "btn go running";
    $("status").classList.add("busy");
    $("run-label").textContent = "Running";
    clearOutput();
    showSkeleton();
    setAspect("Running", "running");
    monaco.editor.setModelMarkers(editor.getModel(), "run", []);
    selectTab("output");
    const t0 = performance.now();
    let result = { ok: false };
    try {
      result = await runCode(id, project.text(name), $("stdin").value, { write, status: (t) => setAspect(t, "running") }, files.filter((f) => f.name !== name));
    } catch (e) {
      write(`Unexpected error: ${e.message}\n`, "stderr");
    } finally {
      running = false;
      runBtn.disabled = false;
      runBtn.className = "btn go";
      $("status").classList.remove("busy");
      $("run-label").textContent = "Run";
      placeholder?.remove(); placeholder = null;
      if (!segments.length) write("The program finished without printing anything.\n", "meta");
    }
    if (!result.ok) { runBtn.classList.add("fault"); setTimeout(() => runBtn.classList.remove("fault"), 2500); }
    const secs = ((performance.now() - t0) / 1000).toFixed(2);
    const via = result.meta ? `${result.meta.provider} ${result.meta.version} · ` : "";
    const summary = `${name} · ${via}${secs}s`;
    setAspect(`${result.ok ? "Clear" : "Fault"} · ${summary}`, result.ok ? "clear" : "fault");
    if (result.error?.line && project.active === name) {
      monaco.editor.setModelMarkers(editor.getModel(), "run", [{
        severity: monaco.MarkerSeverity.Error,
        message: result.error.message.replace(/^MiniLang \w+ at line \d+, col \d+: /, ""),
        startLineNumber: result.error.line, startColumn: result.error.col || 1,
        endLineNumber: result.error.line, endColumn: (result.error.col || 1) + 1,
      }]);
    }
    if (net && canEdit()) net.sendRun({ lang: id, ok: result.ok, summary, segs: segments.slice(0, 400) });
  }
  runBtn.addEventListener("click", run);

  /* Roles, presence, follow mode -------------------------------- */
  const selections = new Map();
  let following = null;

  function updateBanner() {
    const banner = $("banner");
    const set = (kind, title, text, action) => {
      banner.hidden = false;
      banner.className = `banner ${kind}`;
      $("banner-title").textContent = title;
      $("banner-text").textContent = text;
      const btn = $("banner-action");
      btn.hidden = !action;
      if (action) { btn.textContent = action.label; btn.disabled = Boolean(action.disabled); btn.onclick = action.run; }
    };
    if (connection === "offline") return set("fault", "Offline", "The room server is unreachable. Your copy stays editable and re-syncs when it returns.", { label: "Retry", run: () => net?.retry() });
    if (connection === "reconnecting") return set("wait", "Reconnecting", "Trying to reach the room server. Edits are kept locally.");
    if (p2pMode && !p2pNoticeDismissed) return set("wait", "Peer to peer", "This site has no room server, so everyone can edit. Roles, passcodes and checkpoints need one.", { label: "Got it", run: () => { p2pNoticeDismissed = true; updateBanner(); } });
    if (!solo && role === "viewer" && connection === "connected") {
      return set("locked", "View only", "The host has not given you edit access. You can still run the code for yourself.",
        { label: requested ? "Requested" : "Request edit access", disabled: requested, run: async () => { const r = await net.requestEdit(); if (r.ok) { requested = true; updateBanner(); toast("Request sent to the host", "ph-hand-waving"); } else toast(r.error === "too-soon" ? "Wait a few seconds before asking again" : "Could not send the request", "ph-warning"); } });
    }
    banner.hidden = true;
  }

  function applyRole(next) {
    const before = role;
    role = next;
    editor.updateOptions({ readOnly: !canEdit() });
    const badge = $("role-badge");
    badge.hidden = solo || p2pMode;
    badge.className = `role-plate role-badge ${role ?? ""}${before !== role ? " stamp" : ""}`;
    badge.textContent = role ?? "";
    $("mode-tag").hidden = !p2pMode;
    $("stab-room").hidden = role !== "host";
    if (role !== "host" && !$("pane-room").hidden) selectSideTab("panel");
    $("cp-save").disabled = !canEdit() || p2pMode;
    updateBanner();
    renderPeople();
    renderHistory();
    renderTabs();
  }

  const jumpTo = (sel) => {
    if (!sel) return;
    if (sel.file && project.has(sel.file) && project.active !== sel.file) project.open(sel.file);
    editor.revealPositionInCenterIfOutsideViewport(editor.getModel().getPositionAt(Math.min(sel.head, editor.getModel().getValueLength())), monaco.editor.ScrollType.Smooth);
  };
  function setFollow(id) {
    following = id && users.some((u) => u.id === id) ? id : null;
    $("follow").hidden = !following;
    if (following) { $("follow-text").textContent = `Following ${users.find((u) => u.id === following).name}`; jumpTo(selections.get(following)); }
    renderPeople();
  }
  $("follow-stop").addEventListener("click", () => setFollow(null));

  function personRow(u) {
    const isMe = u.id === myId;
    const row = el("div", `person ${u.role}${following === u.id ? " followed" : ""}`);
    const dot = el("span", "dot", (u.name[0] || "?").toUpperCase());
    dot.style.background = u.color;
    const name = el("div", "name");
    name.append(el("b", "", u.name));
    if (isMe) name.append(el("span", "you-tag", "You"));
    const where = selections.get(u.id)?.file;
    if (where && !isMe) name.append(el("small", "", where));
    const actions = el("div", "actions");
    const act = (iconName, label, run, danger) => {
      const b = el("button", `btn icon ghost sm${danger ? " danger" : ""}`);
      b.title = label; b.setAttribute("aria-label", label); b.append(icon(iconName)); b.addEventListener("click", run);
      actions.append(b);
    };
    if (!isMe) act("ph-crosshair", following === u.id ? "Stop following" : `Follow ${u.name}`, () => setFollow(following === u.id ? null : u.id));
    if (role === "host" && !isMe && u.role !== "host") {
      act(u.role === "viewer" ? "ph-pencil-simple" : "ph-eye", u.role === "viewer" ? `Let ${u.name} edit` : `Make ${u.name} a viewer`, async () => {
        const r = await net.setRole(u.id, u.role === "viewer" ? "editor" : "viewer");
        if (!r.ok) toast("Could not change the role", "ph-warning");
      });
      act("ph-crown-simple", `Make ${u.name} the host`, async () => { if (confirm(`Hand the host role to ${u.name}? You will become an editor.`)) { const r = await net.transfer(u.id); if (!r.ok) toast("Could not transfer", "ph-warning"); } });
      act("ph-user-minus", `Remove ${u.name}`, async () => { if (confirm(`Remove ${u.name} from the room?`)) { const r = await net.kick(u.id); if (!r.ok) toast("Could not remove", "ph-warning"); } }, true);
    }
    const track = el("div", "track");
    track.style.setProperty("--c", `var(--${u.role === "host" ? "red" : u.role === "editor" ? "amber" : "blue"})`);
    if (!p2pMode) track.append(el("span", `role-plate ${u.role}`, u.role));
    track.append(el("span", `rail ${u.role}`), el("i", `ph ${u.role === "viewer" ? "ph-lock-simple" : "ph-file-code"}`));
    row.append(dot, name, actions, track);
    return row;
  }

  function renderPeople() {
    const box = $("diagram");
    box.replaceChildren();
    for (const [id, r] of requests) {
      const card = el("div", "request");
      card.append(el("span", "", `${r.name} asks to edit`));
      const allow = el("button", "btn sm go", "Allow");
      allow.addEventListener("click", async () => { await net.respond(id, true); requests.delete(id); renderPeople(); });
      const deny = el("button", "btn sm", "Deny");
      deny.addEventListener("click", async () => { await net.respond(id, false); requests.delete(id); renderPeople(); });
      card.append(allow, deny);
      box.append(card);
    }
    if (solo) box.append(el("div", "empty", "Rooms show everyone here, with their roles."));
    for (const u of users) box.append(personRow(u));
    $("people-count").textContent = String(Math.max(1, users.length));
    if (!solo) {
      const n = users.length;
      $("conn-text").textContent = { connected: n > 1 ? `Connected · ${n} people` : "Connected · just you", reconnecting: "Reconnecting", offline: "Offline", connecting: "Connecting" }[connection] ?? "";
      $("conn-lamp").className = `lamp ${connection === "connected" ? "green" : connection === "reconnecting" || connection === "connecting" ? "amber" : "red"}`;
      $("status").classList.toggle("busy", connection === "connecting" || connection === "reconnecting");
    }
  }

  /* Chat --------------------------------------------------------- */
  let unread = 0;
  const chatLog = $("chat-log");
  function chatRow(m) {
    const row = el("div", "msg");
    const who = el("b");
    who.style.color = /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : "";
    who.append(document.createTextNode(String(m.by).slice(0, 20)));
    if (!p2pMode) who.append(el("span", `role-plate ${["host", "editor", "viewer"].includes(m.role) ? m.role : "viewer"}`, m.role));
    row.append(who, el("span", "", String(m.text).slice(0, 500)));
    return row;
  }
  function addChat(m) {
    chatLog.querySelector(".empty")?.remove();
    chatLog.append(chatRow(m));
    chatLog.scrollTop = chatLog.scrollHeight;
    if ($("pane-chat").hidden && m.by !== myName) { unread += 1; $("chat-badge").textContent = String(unread); $("chat-badge").hidden = false; }
  }
  const chatEmpty = () => chatLog.append(Object.assign(el("div", "empty"), { innerHTML: '<i class="ph ph-chat-circle"></i><span>No messages yet</span>' }));
  chatEmpty();
  $("chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("chat-input").value.trim();
    if (text && net) net.sendChat(text);
    $("chat-input").value = "";
  });

  /* History (checkpoints) --------------------------------------- */
  let checkpoints = [];
  function renderHistory() {
    const box = $("history");
    box.replaceChildren();
    if (solo || p2pMode) { box.append(Object.assign(el("div", "empty"), { innerHTML: `<i class="ph ph-clock-counter-clockwise"></i><span>${solo ? "Checkpoints are available in rooms." : "Checkpoints need the room server."}</span>` })); return; }
    if (!checkpoints.length) { box.append(Object.assign(el("div", "empty"), { innerHTML: '<i class="ph ph-clock-counter-clockwise"></i><span>No checkpoints yet.<br />Save one before a risky change.</span>' })); return; }
    for (const cp of checkpoints) {
      const item = el("div", "cp");
      item.title = (cp.names || []).join(", ");
      item.append(el("b", "", cp.name), el("small", "", `${cp.by} · ${new Date(cp.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${cp.count} file${cp.count === 1 ? "" : "s"}`));
      const btn = el("button", "btn sm", "Restore");
      btn.disabled = !canEdit();
      btn.addEventListener("click", async () => { if (confirm(`Replace the whole project for everyone with "${cp.name}"?`)) { const r = await net.restoreCheckpoint(cp.id); if (!r.ok) toast("Could not restore", "ph-warning"); } });
      item.append(btn);
      box.append(item);
    }
  }
  $("cp-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!net || p2pMode) return;
    const r = await net.saveCheckpoint($("cp-name").value);
    if (r.ok) { $("cp-name").value = ""; toast("Checkpoint saved", "ph-clock-counter-clockwise"); } else toast("Only editors can save checkpoints", "ph-lock-simple");
  });

  /* Room settings (host) ---------------------------------------- */
  function renderSettings() {
    for (const b of $("seg-default").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.role === settingsState.defaultRole));
    $("lock").checked = settingsState.locked;
    $("pass").placeholder = settingsState.hasPasscode ? "Passcode is set" : "No passcode";
  }
  $("seg-default").addEventListener("click", async (e) => { const b = e.target.closest("button[data-role]"); if (b) { const r = await net.settings({ defaultRole: b.dataset.role }); if (!r.ok) toast("Only the host can do that", "ph-lock-simple"); } });
  $("lock").addEventListener("change", async (e) => { const r = await net.settings({ locked: e.target.checked }); if (!r.ok) e.target.checked = !e.target.checked; });
  $("pass-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = $("pass").value.trim();
    const r = await net.settings({ passcode: value });
    if (r.ok) { $("pass").value = ""; toast(value ? "Passcode set" : "Passcode cleared", "ph-key"); }
  });

  /* Side panel tabs --------------------------------------------- */
  const sidePanes = { panel: "pane-panel", chat: "pane-chat", history: "pane-history", room: "pane-room" };
  function selectSideTab(name) {
    for (const [key, id] of Object.entries(sidePanes)) { $(id).hidden = key !== name; $(`stab-${key}`).setAttribute("aria-selected", String(key === name)); }
    if (name === "chat") { unread = 0; $("chat-badge").hidden = true; chatLog.scrollTop = chatLog.scrollHeight; }
  }
  for (const key of Object.keys(sidePanes)) $(`stab-${key}`).addEventListener("click", () => selectSideTab(key));

  /* Networking --------------------------------------------------- */
  const hostKey = `host:${roomId}`;
  const sendSelection = () => {
    const s = editor.getSelection();
    const model = editor.getModel();
    if (net && s && model) net.sendAwareness({ anchor: model.getOffsetAt(s.getStartPosition()), head: model.getOffsetAt(s.getEndPosition()), file: project.active ?? "" });
  };
  const handlers = {
    onStatus: (s) => { connection = s === "connected" ? "connected" : s; updateBanner(); renderPeople(); },
    onJoined: async (res) => {
      gate.close();
      myId = res.you.id;
      p2pMode = Boolean(res.p2p);
      users = res.users; settingsState = res.settings; checkpoints = res.checkpoints;
      requested = false;
      chatLog.replaceChildren();
      if (!res.chat.length) chatEmpty(); else res.chat.forEach((m) => addChat(m));
      unread = 0; $("chat-badge").hidden = true;
      project.migrateLegacy(`${BASE_NAME}.${LANGUAGES.python.ext}`);
      applyRole(res.you.role);
      renderSettings();
      if (p2pMode) {
        $("stab-history").querySelector(".hide-md")?.replaceChildren(document.createTextNode("History"));
        // Wait for peers to hand over the project before creating a starter file.
        setTimeout(() => { if (users.length <= 1) seedProject(); }, 1800);
      } else if (res.you.role === "host") await seedProject(); // only the host seeds, so two people never both add a starter file
    },
    onJoinError: async (code) => {
      connection = "connected";
      if (code === "passcode" || code === "passcode-wrong") {
        const { passcode } = await gate.show({ title: "Passcode needed", text: "The host protected this room with a passcode.", needName: false, needPass: true, error: code === "passcode-wrong" ? "That passcode is not right." : "", action: "Join room" });
        net.join({ passcode });
        return;
      }
      const messages = {
        locked: ["Room is locked", "The host has locked this room to newcomers. Ask them to unlock it."],
        removed: ["Removed from the room", "The host removed you from this room for the rest of the session."],
        full: ["Room is full", "This room has reached its limit of 30 people."],
        busy: ["Server is busy", "The room server cannot open another room right now. Try again shortly."],
        invalid: ["Invalid room", "This room code is not valid."],
      };
      const [title, text] = messages[code] ?? ["Could not join", "Something went wrong while joining the room."];
      gate.show({ title, text, needName: false, action: code === "locked" ? "Try again" : "", home: true }).then(() => net.join());
    },
    onPresence: (list) => {
      const ids = new Set(list.map((u) => u.id));
      for (const id of [...selections.keys()]) if (!ids.has(id)) { selections.delete(id); cursors.update(id, null); }
      users = list;
      if (following && !ids.has(following)) setFollow(null);
      for (const [id, sel] of selections) { const u = list.find((x) => x.id === id); if (u) cursors.update(id, { name: u.name, color: u.color, sel }); }
      for (const id of [...requests.keys()]) if (!ids.has(id)) requests.delete(id);
      renderPeople();
    },
    onAwareness: (id, sel) => {
      const u = users.find((x) => x.id === id);
      if (!sel || !u) { selections.delete(id); cursors.update(id, null); return; }
      selections.set(id, sel);
      cursors.update(id, { name: u.name, color: u.color, sel });
      if (following === id) jumpTo(sel);
    },
    onChat: addChat,
    onRun: (r) => {
      clearOutput();
      write(`${String(r.by).slice(0, 20)} ran ${String(r.summary || "the project").split(" · ")[0].slice(0, 40)}\n\n`, "who");
      for (const [text, cls] of r.segs || []) write(String(text), ["stdout", "stderr", "meta"].includes(cls) ? cls : "stdout");
      setAspect(`${r.ok ? "Clear" : "Fault"} · ${String(r.summary).slice(0, 80)}`, r.ok ? "clear" : "fault");
      selectTab("output");
    },
    onRole: (next) => {
      const before = role;
      if (before === "host" && next !== "host") store.del(hostKey);
      applyRole(next);
      if (next === "editor" && before === "viewer") { requested = false; toast("You can edit now", "ph-pencil-simple"); }
      else if (next === "viewer") toast("The host made you a viewer", "ph-eye");
      else if (next === "host") toast("You are now the host", "ph-crown-simple");
    },
    onSettings: (s) => { settingsState = s; renderSettings(); },
    onCheckpoints: (list) => { checkpoints = list; renderHistory(); },
    onNotice: (n) => {
      if (n.code === "read-only") toast("Viewers cannot edit this project", "ph-lock-simple");
      else if (n.code === "restored") toast(`${n.by ?? "Someone"} restored "${n.name}"`, "ph-clock-counter-clockwise");
    },
    onKicked: () => { net.close(); gate.show({ title: "Removed from the room", text: "The host removed you from this room.", needName: false, action: "", home: true }); },
    onRequest: (r) => { requests.set(r.id, r); renderPeople(); toast(`${r.name} asks to edit`, "ph-hand-waving"); selectSideTab("panel"); },
    onDenied: () => { requested = false; updateBanner(); toast("The host declined your request", "ph-hand-palm"); },
    onHostToken: (token) => store.set(hostKey, token),
  };

  project.migrateLegacy(`${BASE_NAME}.${LANGUAGES.python.ext}`);
  if (solo) {
    $("conn-text").textContent = "Local session, saved in this browser";
    applyRole(null);
    await seedProject();
    renderPeople();
  } else {
    let name = myName;
    const args = { roomId, doc, getIdentity: () => ({ name, hostToken: store.get(hostKey) || undefined }), handlers };
    net = useServer ? connectRoom({ url: serverUrl(), ...args }) : connectPeers(args);
    applyRole(role);
    window.addEventListener("pagehide", () => net.close());
  }
  editor.onDidChangeCursorSelection(sendSelection);
  window.__project = project; // handy for debugging in the console

  /* Sharing and files ------------------------------------------- */
  const copy = async (text, ok) => { try { await navigator.clipboard.writeText(text); toast(ok); } catch { window.prompt("Copy this link", text); } };
  const copyInvite = () => (solo ? toast("Open a room to invite people", "ph-info") : copy(`${location.origin}/r/${roomId}`, "Invite link copied"));
  const copySnapshot = async () => copy(`${location.origin}/play#s=${await encodeSnapshot({ files: project.all(), active: project.active })}`, "Snapshot link copied");
  function download() {
    const name = project.active;
    const url = URL.createObjectURL(new Blob([project.text(name)], { type: "text/plain" }));
    Object.assign(document.createElement("a"), { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const openFile = () => { if (!canEdit()) { toast("Only editors can add files", "ph-lock-simple"); return; } $("file-input").click(); };
  $("file-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 512 * 1024) { toast("That file is too large (limit 512 KB)", "ph-warning"); return; }
    let name = file.name.replace(/[^\w .-]/g, "_");
    if (!validFileName(name)) name = `upload.${extOf(file.name) || "txt"}`;
    if (project.has(name)) { const dot = name.lastIndexOf("."); name = `${dot > 0 ? name.slice(0, dot) : name}-copy${dot > 0 ? name.slice(dot) : ""}`; }
    if (!project.create(name, await file.text())) { fileError(name); return; }
    toast(`Added ${name}`, "ph-folder-open");
  });
  anchorMenu($("share-btn"), $("share-menu"));
  $("m-invite").addEventListener("click", copyInvite);
  $("m-snapshot").addEventListener("click", copySnapshot);
  $("m-download").addEventListener("click", download);
  $("m-open").addEventListener("click", openFile);
  $("m-invite").hidden = solo;

  /* Settings ----------------------------------------------------- */
  anchorMenu($("settings-btn"), $("settings-menu"));
  const applySettings = () => {
    editor.updateOptions({ fontSize: settings.fontSize, wordWrap: settings.wrap ? "on" : "off", minimap: { enabled: settings.minimap }, fontLigatures: settings.ligatures });
    $("fs-value").textContent = String(settings.fontSize);
    $("set-wrap").checked = settings.wrap; $("set-minimap").checked = settings.minimap; $("set-ligatures").checked = settings.ligatures;
    saveSettings();
  };
  const bumpFont = (d) => { settings.fontSize = Math.max(10, Math.min(28, settings.fontSize + d)); applySettings(); };
  $("fs-minus").addEventListener("click", (e) => { e.stopPropagation(); bumpFont(-1); });
  $("fs-plus").addEventListener("click", (e) => { e.stopPropagation(); bumpFont(1); });
  $("set-wrap").addEventListener("change", (e) => { settings.wrap = e.target.checked; applySettings(); });
  $("set-minimap").addEventListener("change", (e) => { settings.minimap = e.target.checked; applySettings(); });
  $("set-ligatures").addEventListener("change", (e) => { settings.ligatures = e.target.checked; applySettings(); });
  applySettings();

  /* Layout: side panel, resizer, status bar --------------------- */
  const workspace = $("workspace");
  const toggleSide = () => { if (!solo) { workspace.classList.toggle("side-closed"); store.set("side", workspace.classList.contains("side-closed") ? "closed" : "open"); } };
  if (!solo && store.get("side") === "closed") workspace.classList.add("side-closed");
  $("side-toggle").addEventListener("click", toggleSide);

  const main = $("main"), resizer = $("resizer");
  const savedH = Number(store.get("consoleH"));
  if (savedH >= 80) main.style.setProperty("--console", `${savedH}px`);
  resizer.addEventListener("pointerdown", (e) => {
    resizer.setPointerCapture(e.pointerId);
    resizer.classList.add("dragging");
    const move = (ev) => {
      const rect = main.getBoundingClientRect();
      main.style.setProperty("--console", `${Math.min(rect.height - 160, Math.max(80, rect.bottom - ev.clientY))}px`);
    };
    const up = () => {
      resizer.classList.remove("dragging");
      resizer.removeEventListener("pointermove", move);
      resizer.removeEventListener("pointerup", up);
      store.set("consoleH", parseInt(main.style.getPropertyValue("--console")));
    };
    resizer.addEventListener("pointermove", move);
    resizer.addEventListener("pointerup", up);
  });
  editor.onDidChangeCursorPosition((e) => { $("pos").textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`; });

  /* Command palette --------------------------------------------- */
  const palette = createPalette($("palette"));
  const languageItems = () => GROUPS.flatMap((g) => LANGUAGE_IDS.filter((id) => LANGUAGES[id].group === g).map((id) => ({
    title: LANGUAGES[id].label, group: g, keywords: `${id} ${LANGUAGES[id].ext}`,
    tile: () => langTile(LANGUAGES[id], 22),
    hint: id === fileLang(project.active) ? "current" : LANGUAGES[id].runtime === "remote" ? "remote compiler" : "",
    run: () => setLanguage(id),
  })));
  const openLanguages = () => palette.open(languageItems, `Set the language of ${project.active ?? "this file"}`);
  const fileItems = () => project.names().map((n) => ({ title: n, group: "Open file", icon: "ph-file-code", hint: n === project.active ? "open" : "", run: () => project.open(n) }));
  const commandItems = () => [
    { title: "Run", group: "Actions", icon: "ph-play", hint: `${MOD} ↵`, run },
    { title: "New file", group: "Actions", icon: "ph-file-plus", run: newFile },
    { title: "Change language of this file", group: "Actions", icon: "ph-translate", run: openLanguages },
    ...(solo ? [] : [
      { title: "Copy invite link", group: "Room", icon: "ph-link", run: copyInvite },
      { title: "Save checkpoint", group: "Room", icon: "ph-clock-counter-clockwise", run: () => { selectSideTab("history"); $("cp-name").focus(); } },
      { title: "Show people and roles", group: "Room", icon: "ph-users-three", run: () => selectSideTab("panel") },
      { title: "Open chat", group: "Room", icon: "ph-chat-circle", run: () => selectSideTab("chat") },
    ]),
    { title: "Copy snapshot link", group: "Share", icon: "ph-camera", run: copySnapshot },
    { title: "Download this file", group: "Share", icon: "ph-download-simple", run: download },
    { title: "Add file from disk", group: "Share", icon: "ph-folder-open", run: openFile },
    ...THEMES.map((t) => ({ title: `Theme: ${t.label}`, group: "View", icon: "ph-palette", run: () => setTheme(t.id) })),
    { title: "Increase font size", group: "View", icon: "ph-text-aa", run: () => bumpFont(1) },
    { title: "Decrease font size", group: "View", icon: "ph-text-aa", run: () => bumpFont(-1) },
    { title: "Toggle word wrap", group: "View", icon: "ph-text-align-left", run: () => { settings.wrap = !settings.wrap; applySettings(); } },
    { title: "Toggle minimap", group: "View", icon: "ph-map-trifold", run: () => { settings.minimap = !settings.minimap; applySettings(); } },
    ...(solo ? [] : [{ title: "Toggle side panel", group: "View", icon: "ph-sidebar-simple", run: toggleSide }]),
    { title: "Clear output", group: "View", icon: "ph-trash", run: () => $("clear").click() },
    { title: "Home", group: "Go", icon: "ph-house", run: () => { location.href = "/"; } },
    ...fileItems(),
    ...languageItems().map((i) => ({ ...i, group: "Languages" })),
  ];
  const openCommands = () => palette.open(commandItems);
  $("palette-btn").addEventListener("click", openCommands);
  $("lang-btn").addEventListener("click", openLanguages);

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, run);
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, openCommands);
  document.addEventListener("keydown", (e) => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); openCommands(); }
    else if (mod && e.key === "Enter") { e.preventDefault(); run(); }
    else if (e.key === "Escape" && following && !document.querySelector("dialog[open]")) setFollow(null);
  });
}

main().catch((e) => {
  console.error(e);
  document.getElementById("loading")?.replaceChildren(`Could not start the editor: ${e.message}`);
});
