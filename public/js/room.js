import { Y, persist, connectRoom, serverUrl } from "./net.js";
import { bindEditor, createRemoteCursors } from "./binding.js";
import { LANGUAGES, LANGUAGE_IDS, GROUPS, fileName } from "./languages.js";
import { runCode } from "./runners.js";
import { encodeSnapshot, decodeSnapshot } from "./snapshot.js";
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

/* ── Mode: /r/<room> (shared, needs the room server) or /play (local) ── */
const roomMatch = location.pathname.match(/^\/r\/([a-z0-9-]{4,40})\/?$/i);
const solo = !roomMatch;
if (solo && !location.pathname.startsWith("/play")) location.replace("/");
const roomId = solo ? "solo" : roomMatch[1].toLowerCase();
const snapMatch = solo ? location.hash.match(/[#&]s=([\w-]+)/) : null;
const snapFragment = snapMatch ? snapMatch[1] : null;
const hash32 = (s) => { let h = 5381; for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0; return h.toString(16); };
const docKey = solo ? (snapFragment ? `snap-${hash32(snapFragment)}` : "solo") : roomId;

$("room-name").textContent = solo ? (snapFragment ? "snapshot" : "playground") : roomId;
$("room-id").querySelector("i").className = `ph ${solo ? "ph-laptop" : "ph-broadcast"}`;
$("run-kbd").textContent = `${MOD} ↵`;
document.title = solo ? "CodeSync playground" : `CodeSync ${roomId}`;
if (solo) { $("workspace").classList.add("side-closed"); $("side-toggle").hidden = true; }

/* ── Settings and theme ──────────────────────────────────────────── */
const settings = { fontSize: 14, wrap: false, minimap: false, ligatures: true, ...JSON.parse(store.get("settings") || "{}") };
const saveSettings = () => store.set("settings", JSON.stringify(settings));
let themeMode = store.get("theme") || "system";
let monacoRef = null;
const systemDark = matchMedia("(prefers-color-scheme: dark)");
const resolvedTheme = () => (themeMode === "system" ? (systemDark.matches ? "dark" : "light") : themeMode);
function applyTheme() {
  document.documentElement.dataset.theme = resolvedTheme();
  monacoRef?.editor.setTheme(resolvedTheme() === "light" ? "sb-light" : "sb-dark");
  $("set-theme").value = themeMode;
}
function setThemeMode(mode) { themeMode = mode; store.set("theme", mode); applyTheme(); }
systemDark.addEventListener("change", () => { if (themeMode === "system") applyTheme(); });
$("theme").addEventListener("click", () => setThemeMode(resolvedTheme() === "light" ? "dark" : "light"));
$("set-theme").addEventListener("change", (e) => setThemeMode(e.target.value));

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

function defineThemes(monaco) {
  monaco.editor.defineTheme("sb-dark", {
    base: "vs-dark", inherit: true,
    rules: [
      { token: "comment", foreground: "6f7880", fontStyle: "italic" },
      { token: "keyword", foreground: "f5b83c" },
      { token: "string", foreground: "8fd19e" },
      { token: "number", foreground: "82b6ea" },
      { token: "type", foreground: "ef9a86" },
      { token: "operator", foreground: "aab0b5" },
    ],
    colors: {
      "editor.background": "#101315", "editor.foreground": "#ebe8df",
      "editorLineNumber.foreground": "#4c555c", "editorLineNumber.activeForeground": "#aab0b5",
      "editor.lineHighlightBackground": "#ffffff08", "editor.selectionBackground": "#f5b83c30",
      "editorCursor.foreground": "#f5b83c", "editorIndentGuide.background1": "#22282d",
      "editorWidget.background": "#1b1f23", "scrollbarSlider.background": "#ffffff14",
    },
  });
  monaco.editor.defineTheme("sb-light", {
    base: "vs", inherit: true,
    rules: [
      { token: "comment", foreground: "5e676d", fontStyle: "italic" },
      { token: "keyword", foreground: "8a5a00" },
      { token: "string", foreground: "17722f" },
      { token: "number", foreground: "1f5f9e" },
      { token: "type", foreground: "b8321d" },
    ],
    colors: {
      "editor.background": "#ffffff", "editor.foreground": "#14171a",
      "editorLineNumber.foreground": "#8b949a", "editorLineNumber.activeForeground": "#454d53",
      "editor.lineHighlightBackground": "#00000006", "editor.selectionBackground": "#f0b42942",
      "editorCursor.foreground": "#8a5a00",
    },
  });
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
  defineThemes(monaco);
  registerMiniLang(monaco);
  $("loading").remove();

  const editor = monaco.editor.create($("editor"), {
    value: "", language: "plaintext",
    theme: resolvedTheme() === "light" ? "sb-light" : "sb-dark",
    automaticLayout: true,
    fontFamily: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace',
    fontSize: settings.fontSize, fontLigatures: settings.ligatures,
    wordWrap: settings.wrap ? "on" : "off", minimap: { enabled: settings.minimap },
    scrollBeyondLastLine: false, padding: { top: 16, bottom: 16 }, smoothScrolling: true,
    cursorSmoothCaretAnimation: "on", tabSize: 4, renderLineHighlight: "gutter",
    bracketPairColorization: { enabled: true },
    readOnlyMessage: { value: "You are a viewer. Ask the host for edit access." },
  });
  applyTheme();
  const model = editor.getModel();

  /* Document ----------------------------------------------------- */
  const doc = new Y.Doc();
  persist(doc, docKey);
  const ytext = doc.getText("code");
  const meta = doc.getMap("meta");
  const binding = bindEditor(monaco, editor, ytext, () => canEdit());

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

  /* Language ----------------------------------------------------- */
  let lang = LANGUAGES[meta.get("language")] ? meta.get("language") : "python";
  let remoteInfo = {};
  const runtimeLabel = (id) => {
    const l = LANGUAGES[id];
    if (l.runtime === "browser") return "Runs in your browser";
    if (l.runtime === "preview") return "Live preview";
    const info = remoteInfo[id];
    return info ? `${info.provider} ${info.version}` : "Compiles on a remote service";
  };
  const updatePreview = () => { $("preview").srcdoc = model.getValue(); };

  function applyLanguage(id) {
    lang = id;
    const l = LANGUAGES[id];
    monaco.editor.setModelLanguage(model, l.monaco);
    $("lang-icon").replaceChildren(langTile(l, 20));
    $("lang-label").textContent = l.label;
    $("lang-status").textContent = l.label;
    $("runtime-info").textContent = runtimeLabel(id);
    const html = l.runtime === "preview";
    $("tab-preview").hidden = !html;
    if (html) { selectTab("preview"); updatePreview(); } else if (currentTab === "preview") selectTab("output");
    if (l.stdin && !$("stdin").value) $("stdin").value = l.stdin;
  }
  function setLanguage(id) {
    if (id === lang) return;
    if (!canEdit()) { toast("Only editors can change the language", "ph-lock-simple"); return; }
    const untouched = !model.getValue().trim() || model.getValue().trim() === LANGUAGES[lang].template.trim();
    if (untouched) binding.setText(LANGUAGES[id].template);
    applyLanguage(id);
    meta.set("language", id);
    $("stdin").value = LANGUAGES[id].stdin || "";
  }
  meta.observe(() => { const id = meta.get("language"); if (LANGUAGES[id] && id !== lang) applyLanguage(id); });
  fetch("/api/languages").then((r) => (r.ok ? r.json() : null)).then((j) => {
    if (!j?.languages) return;
    remoteInfo = j.languages;
    $("runtime-info").textContent = runtimeLabel(lang);
  }).catch(() => {});

  let previewTimer;
  model.onDidChangeContent(() => {
    monaco.editor.setModelMarkers(model, "run", []);
    if (LANGUAGES[lang].runtime !== "preview") return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(updatePreview, 350);
  });

  async function seed() {
    if (ytext.length > 0) return;
    const snap = snapFragment ? await decodeSnapshot(snapFragment) : null;
    if (snap && LANGUAGES[snap.lang]) { lang = snap.lang; binding.setText(snap.code); toast("Opened a shared snapshot", "ph-camera"); }
    else binding.setText(LANGUAGES[lang].template);
    meta.set("language", lang);
    applyLanguage(lang);
  }

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
  $("clear").addEventListener("click", () => { clearOutput(); monaco.editor.setModelMarkers(model, "run", []); });
  $("copy-output").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(segments.map(([t]) => t).join("")); toast("Output copied"); } catch { toast("Could not copy", "ph-warning"); }
  });

  /* Running code ------------------------------------------------- */
  const runBtn = $("run");
  let running = false;
  async function run() {
    if (running) return;
    const id = lang, l = LANGUAGES[id];
    if (l.runtime === "preview") { updatePreview(); selectTab("preview"); toast("Preview refreshed", "ph-browser"); return; }
    running = true;
    runBtn.disabled = true;
    $("run-label").textContent = "Running";
    clearOutput();
    showSkeleton();
    setAspect("Running", "running");
    monaco.editor.setModelMarkers(model, "run", []);
    selectTab("output");
    const t0 = performance.now();
    let result = { ok: false };
    try {
      result = await runCode(id, model.getValue(), $("stdin").value, { write, status: (t) => setAspect(t, "running") });
    } catch (e) {
      write(`Unexpected error: ${e.message}\n`, "stderr");
    } finally {
      running = false;
      runBtn.disabled = false;
      $("run-label").textContent = "Run";
      placeholder?.remove(); placeholder = null;
      if (!segments.length) write("The program finished without printing anything.\n", "meta");
    }
    const secs = ((performance.now() - t0) / 1000).toFixed(2);
    const via = result.meta ? `${result.meta.provider} ${result.meta.version} · ` : "";
    const summary = `${l.label} · ${via}${secs}s`;
    setAspect(`${result.ok ? "Clear" : "Fault"} · ${summary}`, result.ok ? "clear" : "fault");
    if (result.error?.line) {
      monaco.editor.setModelMarkers(model, "run", [{
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
  let role = solo ? null : "viewer"; // until the server answers, assume the least privilege
  let users = [];
  let settingsState = { defaultRole: "editor", locked: false, hasPasscode: false };
  let connection = solo ? "local" : "connecting";
  const requests = new Map();
  let requested = false;
  const canEdit = () => solo || role === "host" || role === "editor";
  const cursors = createRemoteCursors(monaco, editor);
  const selections = new Map();
  let following = null;
  let net = null;
  let myId = null;

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
    if (!solo && !serverUrl()) return set("fault", "No room server", "This site has no room server configured, so rooms are unavailable. Solo mode still works.", { label: "Open playground", run: () => { location.href = "/play"; } });
    if (connection === "offline") return set("fault", "Offline", "The room server is unreachable. Your copy stays editable and re-syncs when it returns.", { label: "Retry", run: () => net?.retry() });
    if (connection === "reconnecting") return set("wait", "Reconnecting", "Trying to reach the room server. Edits are kept locally.");
    if (!solo && role === "viewer") {
      return set("locked", "View only", "The host has not given you edit access. You can still run the code for yourself.",
        { label: requested ? "Requested" : "Request edit access", disabled: requested, run: async () => { const r = await net.requestEdit(); if (r.ok) { requested = true; updateBanner(); toast("Request sent to the host", "ph-hand-waving"); } else toast(r.error === "too-soon" ? "Wait a few seconds before asking again" : "Could not send the request", "ph-warning"); } });
    }
    banner.hidden = true;
  }

  function applyRole(next) {
    role = next;
    editor.updateOptions({ readOnly: !canEdit() });
    const badge = $("role-badge");
    badge.hidden = solo;
    badge.className = `role-plate role-badge ${role ?? ""}`;
    badge.textContent = role ?? "";
    $("stab-room").hidden = role !== "host";
    if (role !== "host" && !$("pane-room").hidden) selectSideTab("panel");
    $("cp-save").disabled = !canEdit();
    updateBanner();
    renderPeople();
    renderHistory();
  }

  function setFollow(id) {
    following = id && users.some((u) => u.id === id) ? id : null;
    $("follow").hidden = !following;
    if (following) { $("follow-text").textContent = `Following ${users.find((u) => u.id === following).name}`; jumpTo(selections.get(following)); }
    renderPeople();
  }
  const jumpTo = (sel) => { if (sel) editor.revealPositionInCenterIfOutsideViewport(model.getPositionAt(Math.min(sel.head, model.getValueLength())), monaco.editor.ScrollType.Smooth); };
  $("follow-stop").addEventListener("click", () => setFollow(null));

  function personRow(u) {
    const isMe = u.id === myId;
    const row = el("div", `person ${u.role}${following === u.id ? " followed" : ""}`);
    const dot = el("span", "dot", (u.name[0] || "?").toUpperCase());
    dot.style.background = u.color;
    const name = el("div", "name");
    name.append(el("b", "", u.name));
    if (isMe) name.append(el("span", "you-tag", "You"));
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
    track.append(el("span", `role-plate ${u.role}`, u.role), el("span", `rail ${u.role}`), el("i", `ph ${u.role === "viewer" ? "ph-lock-simple" : "ph-file-code"}`));
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
    if (!solo && net) {
      const n = users.length;
      $("conn-text").textContent = { connected: n > 1 ? `Connected · ${n} people` : "Connected · just you", reconnecting: "Reconnecting", offline: "Offline", connecting: "Connecting" }[connection] ?? "";
      $("conn-lamp").className = `lamp ${connection === "connected" ? "green" : connection === "reconnecting" || connection === "connecting" ? "amber" : "red"}`;
    }
  }

  /* Chat --------------------------------------------------------- */
  let unread = 0;
  const chatLog = $("chat-log");
  function chatRow(m) {
    const row = el("div", "msg");
    const who = el("b");
    who.style.color = /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : "";
    who.append(document.createTextNode(String(m.by).slice(0, 20)), el("span", `role-plate ${["host", "editor", "viewer"].includes(m.role) ? m.role : "viewer"}`, m.role));
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
    if (solo) { box.append(el("div", "empty", "Checkpoints are available in rooms.")); return; }
    if (!checkpoints.length) { box.append(Object.assign(el("div", "empty"), { innerHTML: '<i class="ph ph-clock-counter-clockwise"></i><span>No checkpoints yet.<br />Save one before a risky change.</span>' })); return; }
    for (const cp of checkpoints) {
      const item = el("div", "cp");
      item.append(el("b", "", cp.name), el("small", "", `${cp.by} · ${new Date(cp.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${cp.lang && LANGUAGES[cp.lang] ? ` · ${LANGUAGES[cp.lang].label}` : ""}`));
      const btn = el("button", "btn sm", "Restore");
      btn.disabled = !canEdit();
      btn.addEventListener("click", async () => { if (confirm(`Replace the file for everyone with "${cp.name}"?`)) { const r = await net.restoreCheckpoint(cp.id); if (!r.ok) toast("Could not restore", "ph-warning"); } });
      item.append(btn);
      box.append(item);
    }
  }
  $("cp-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!net) return;
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
  if (solo) {
    applyLanguage(lang);
    renderPeople(); renderHistory();
    await seed();
  } else if (!serverUrl()) {
    applyLanguage(lang);
    updateBanner();
    $("conn-text").textContent = "No room server";
    $("conn-lamp").className = "lamp red";
    await seed();
  } else {
    let name = myName;
    net = connectRoom({
      url: serverUrl(), roomId, doc,
      getIdentity: () => ({ name, hostToken: store.get(hostKey) || undefined }),
      handlers: {
        onStatus: (s) => { connection = s === "connected" ? "connected" : s; updateBanner(); renderPeople(); },
        onJoined: async (res) => {
          gate.close();
          myId = res.you.id;
          users = res.users; settingsState = res.settings; checkpoints = res.checkpoints;
          requested = false;
          chatLog.replaceChildren();
          if (!res.chat.length) chatEmpty(); else res.chat.forEach((m) => addChat(m));
          unread = 0; $("chat-badge").hidden = true;
          applyRole(res.you.role);
          renderSettings();
          if (LANGUAGES[meta.get("language")]) applyLanguage(meta.get("language"));
          // Only the host seeds an empty room, so two people never both insert the starter file.
          if (res.you.role === "host") await seed(); else applyLanguage(lang);
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
          write(`${String(r.by).slice(0, 20)} ran ${LANGUAGES[r.lang]?.label ?? "code"}\n\n`, "who");
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
          if (n.code === "read-only") toast("Viewers cannot edit this file", "ph-lock-simple");
          else if (n.code === "restored") toast(`${n.by ?? "Someone"} restored "${n.name}"`, "ph-clock-counter-clockwise");
        },
        onKicked: () => { net.close(); gate.show({ title: "Removed from the room", text: "The host removed you from this room.", needName: false, action: "", home: true }); },
        onRequest: (r) => { requests.set(r.id, r); renderPeople(); toast(`${r.name} asks to edit`, "ph-hand-waving"); selectSideTab("panel"); },
        onDenied: () => { requested = false; updateBanner(); toast("The host declined your request", "ph-hand-palm"); },
        onHostToken: (token) => store.set(hostKey, token),
      },
    });
    editor.onDidChangeCursorSelection(() => {
      const s = editor.getSelection();
      if (s) net.sendAwareness({ anchor: model.getOffsetAt(s.getStartPosition()), head: model.getOffsetAt(s.getEndPosition()) });
    });
    window.addEventListener("pagehide", () => net.close());
    applyLanguage(lang);
    renderPeople(); renderHistory();
    updateBanner();
  }

  /* Sharing and files ------------------------------------------- */
  const copy = async (text, ok) => { try { await navigator.clipboard.writeText(text); toast(ok); } catch { window.prompt("Copy this link", text); } };
  const copyInvite = () => (solo ? toast("Open a room to invite people", "ph-info") : copy(`${location.origin}/r/${roomId}`, "Invite link copied"));
  const copySnapshot = async () => copy(`${location.origin}/play#s=${await encodeSnapshot({ lang, code: model.getValue() })}`, "Snapshot link copied");
  function download() {
    const url = URL.createObjectURL(new Blob([model.getValue()], { type: "text/plain" }));
    Object.assign(document.createElement("a"), { href: url, download: fileName(lang) }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const openFile = () => { if (!canEdit()) { toast("Only editors can replace the file", "ph-lock-simple"); return; } $("file-input").click(); };
  $("file-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 512 * 1024) { toast("That file is too large (limit 512 KB)", "ph-warning"); return; }
    const text = await file.text();
    const match = LANGUAGE_IDS.find((id) => LANGUAGES[id].ext === file.name.split(".").pop().toLowerCase());
    binding.setText(text);
    if (match && match !== lang) { applyLanguage(match); meta.set("language", match); }
    toast(`Opened ${file.name}`, "ph-folder-open");
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
    hint: id === lang ? "current" : LANGUAGES[id].runtime === "remote" ? "remote compiler" : "",
    run: () => setLanguage(id),
  })));
  const openLanguages = () => palette.open(languageItems, `Search ${LANGUAGE_IDS.length} languages`);
  const commandItems = () => [
    { title: "Run code", group: "Actions", icon: "ph-play", hint: `${MOD} ↵`, run },
    { title: "Change language", group: "Actions", icon: "ph-translate", run: openLanguages },
    ...(solo ? [] : [
      { title: "Copy invite link", group: "Room", icon: "ph-link", run: copyInvite },
      { title: "Save checkpoint", group: "Room", icon: "ph-clock-counter-clockwise", run: () => { selectSideTab("history"); $("cp-name").focus(); } },
      { title: "Show people and roles", group: "Room", icon: "ph-users-three", run: () => selectSideTab("panel") },
      { title: "Open chat", group: "Room", icon: "ph-chat-circle", run: () => selectSideTab("chat") },
    ]),
    { title: "Copy snapshot link", group: "Share", icon: "ph-camera", run: copySnapshot },
    { title: "Download file", group: "Share", icon: "ph-download-simple", run: download },
    { title: "Open file from disk", group: "Share", icon: "ph-folder-open", run: openFile },
    { title: "Toggle theme", group: "View", icon: "ph-circle-half", run: () => setThemeMode(resolvedTheme() === "light" ? "dark" : "light") },
    { title: "Increase font size", group: "View", icon: "ph-text-aa", run: () => bumpFont(1) },
    { title: "Decrease font size", group: "View", icon: "ph-text-aa", run: () => bumpFont(-1) },
    { title: "Toggle word wrap", group: "View", icon: "ph-text-align-left", run: () => { settings.wrap = !settings.wrap; applySettings(); } },
    { title: "Toggle minimap", group: "View", icon: "ph-map-trifold", run: () => { settings.minimap = !settings.minimap; applySettings(); } },
    ...(solo ? [] : [{ title: "Toggle side panel", group: "View", icon: "ph-sidebar-simple", run: toggleSide }]),
    { title: "Clear output", group: "View", icon: "ph-trash", run: () => $("clear").click() },
    { title: "Home", group: "Go", icon: "ph-house", run: () => { location.href = "/"; } },
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
