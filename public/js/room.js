import { Y, persist, connectRoom, serverUrl } from "./net.js";
import { connectPeers } from "./p2p.js";
import { createRemoteCursors } from "./binding.js";
import { createProject, MAX_FILES } from "./project.js";
import { LANGUAGES, LANGUAGE_IDS, GROUPS, languageForFile, extOf, validFileName } from "./languages.js";
import { runCode } from "./runners.js";
import { buildPreview, previewEntry } from "./preview.js";
import { encodeSnapshot, decodeSnapshot } from "./snapshot.js";
import { THEMES, savedPreference, setTheme, currentTheme, defineMonacoTheme } from "./themes.js";
import { createTerminal } from "./terminal.js";
import { copyText } from "./clipboard.js";
import { toast, langTile, anchorMenu, createPalette } from "./ui.js";

const $ = (id) => document.getElementById(id);
const store = {
  get: (k) => { try { return localStorage.getItem(`codesync:${k}`); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(`codesync:${k}`, v); } catch { /* storage unavailable */ } },
  del: (k) => { try { localStorage.removeItem(`codesync:${k}`); } catch { /* storage unavailable */ } },
};
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl";
// Small DOM helper: tag, class, text.
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
// A Phosphor icon element.
const icon = (name) => el("i", `ph ${name}`);
const TEAM = ["Mayank Karki", "Nitin Kandpal", "Swarit Kumar"];
const TEAM_COLORS = ["#ffb3a0", "#9ceccd", "#b9ccff"];

/* ── Which room is this ─────────────────────────────────────────── */
const roomMatch = location.pathname.match(/^\/r\/([a-z0-9-]{4,40})\/?$/i);
const solo = !roomMatch;
if (solo && !location.pathname.startsWith("/play")) location.replace("/");
const roomId = solo ? "solo" : roomMatch[1].toLowerCase();
const snapMatch = solo ? location.hash.match(/[#&]s=([\w-]+)/) : null;
const snapFragment = snapMatch ? snapMatch[1] : null;
// A cheap stable hash, used to key a snapshot's local copy.
const hash32 = (s) => { let h = 5381; for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0; return h.toString(16); };
const docKey = solo ? (snapFragment ? `snap-${hash32(snapFragment)}` : "solo") : roomId;
const useServer = !solo && Boolean(serverUrl());
const START_FILE = "main.py";

$("room-name").textContent = solo ? (snapFragment ? "snapshot" : "playground") : roomId;
$("room-id").querySelector("i").className = `ph ${solo ? "ph-laptop" : "ph-broadcast"}`;
$("room-id").title = solo ? "Runs and saves in this browser only" : "Shared room";
$("run-kbd").textContent = `${MOD} ↵`;
document.title = solo ? "CodeSync playground" : `CodeSync ${roomId}`;
if (solo) { $("workspace").classList.add("closed"); $("side-toggle").hidden = true; }

/* ── Settings and theme ─────────────────────────────────────────── */
const settings = { fontSize: 14, wrap: false, minimap: false, ligatures: true, ...JSON.parse(store.get("settings") || "{}") };
// Persist the editor settings for this browser.
const saveSettings = () => store.set("settings", JSON.stringify(settings));
let monacoRef = null;

const themeSelect = $("set-theme");
themeSelect.append(new Option("Match the system", "system"), ...THEMES.map((t) => new Option(t.label, t.id)));
// Point the theme dropdown at whatever is stored.
const syncThemeUi = () => { themeSelect.value = THEMES.some((t) => t.id === savedPreference()) ? savedPreference() : "system"; };
syncThemeUi();
themeSelect.addEventListener("change", (e) => setTheme(e.target.value));
document.addEventListener("themechange", () => { if (monacoRef) defineMonacoTheme(monacoRef); syncThemeUi(); });
matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { if (savedPreference() === "system") setTheme("system"); });
$("theme-btn").addEventListener("click", () => {
  const ids = THEMES.map((t) => t.id);
  const next = ids[(ids.indexOf(currentTheme()) + 1) % ids.length];
  setTheme(next);
  toast(`${THEMES.find((t) => t.id === next).label} theme`, "ph-palette");
});

/* ── About ──────────────────────────────────────────────────────── */
TEAM.forEach((name, i) => {
  const row = el("div");
  const chip = el("span", "chip", name[0]);
  chip.style.background = TEAM_COLORS[i];
  row.append(chip, el("b", "", name));
  $("about-crew").append(row);
});
// Show the About dialog with the credits.
const openAbout = () => $("about").showModal();
$("m-about").addEventListener("click", openAbout);
$("about-close").addEventListener("click", () => $("about").close());
$("about").addEventListener("click", (e) => { if (e.target === $("about")) $("about").close(); });

/* ── Monaco ─────────────────────────────────────────────────────── */
const MONACO_BASE = "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min";
// Load Monaco from the CDN and hand back the namespace.
function loadMonaco() {
  window.MonacoEnvironment = {
    getWorkerUrl: () => `data:text/javascript;charset=utf-8,${encodeURIComponent(
      `self.MonacoEnvironment={baseUrl:"${MONACO_BASE}/"};importScripts("${MONACO_BASE}/vs/base/worker/workerMain.js");`)}`,
  };
  window.require.config({ paths: { vs: `${MONACO_BASE}/vs` } });
  return new Promise((resolve, reject) => window.require(["vs/editor/editor.main"], () => resolve(window.monaco), reject));
}

// Teach Monaco how to colour MiniLang.
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

/* ── The door: name, and a passcode when the room asks for one ──── */
const gate = {
  node: $("gate"),
  // Open the door dialog and resolve once the visitor submits it.
  show({ title, text, needName = true, needPass = false, error = "", action = "Enter the room", home = false }) {
    $("gate-title").textContent = title;
    $("gate-text").textContent = text;
    $("gate-name").hidden = !needName;
    $("gate-pass").hidden = !needPass;
    $("gate-err").textContent = error;
    $("gate-submit").textContent = action;
    $("gate-submit").hidden = !action;
    $("gate-home").hidden = !home;
    if (!this.node.open) this.node.showModal();
    (needPass ? $("gate-pass") : needName ? $("gate-name") : $("gate-submit")).focus();
    return new Promise((resolve) => {
      $("gate-form").onsubmit = (e) => {
        e.preventDefault();
        resolve({ name: $("gate-name").value.trim().slice(0, 20), passcode: $("gate-pass").value });
      };
    });
  },
  // Close the dialog if it is open.
  close() { if (this.node.open) this.node.close(); },
};
gate.node.addEventListener("cancel", (e) => e.preventDefault());

// Ask for a display name once, then remember it.
async function askName() {
  const saved = store.get("name");
  if (saved) return saved;
  const adjectives = ["Curious", "Swift", "Quiet", "Bright", "Lucky", "Careful", "Brave", "Calm"];
  const animals = ["Otter", "Fox", "Heron", "Lynx", "Panda", "Falcon", "Gecko", "Koala"];
  // Pick a random entry, for the suggested name.
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  $("gate-name").value = `${pick(adjectives)} ${pick(animals)}`;
  const { name } = await gate.show({ title: "Join the room", text: "Pick a name. It shows next to your cursor and in chat." });
  const final = name || "Guest";
  store.set("name", final);
  return final;
}

/* ── Main ───────────────────────────────────────────────────────── */
async function main() {
  const monacoReady = loadMonaco();
  const myName = solo ? store.get("name") || "You" : await askName();
  const monaco = await monacoReady;
  monacoRef = monaco;
  registerMiniLang(monaco);
  $("booting").remove();

  const editor = monaco.editor.create($("editor"), {
    model: null,
    automaticLayout: true,
    fontFamily: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace',
    fontSize: settings.fontSize,
    fontLigatures: settings.ligatures,
    wordWrap: settings.wrap ? "on" : "off",
    minimap: { enabled: settings.minimap },
    scrollBeyondLastLine: false,
    padding: { top: 16, bottom: 18 },
    smoothScrolling: true,
    cursorSmoothCaretAnimation: "on",
    cursorBlinking: "smooth",
    tabSize: 4,
    renderLineHighlight: "gutter",
    bracketPairColorization: { enabled: true },
    readOnlyMessage: { value: "You are a viewer in this room. Ask the host for edit access." },
  });
  defineMonacoTheme(monaco);

  /* State ------------------------------------------------------- */
  let role = solo ? null : useServer ? "viewer" : "editor"; // assume the least until the server answers
  let members = [];
  let roomSettings = { defaultRole: "editor", locked: false, hasPasscode: false };
  let connection = solo ? "local" : "connecting";
  let peerMode = false;
  let peerNoticeSeen = false;
  let net = null;
  let myId = null;
  let asked = false;
  const pending = new Map();
  // The one question the whole UI asks before letting anything change.
  const canEdit = () => solo || role === "host" || role === "editor";

  /* Document and project ---------------------------------------- */
  const doc = new Y.Doc();
  persist(doc, docKey);
  let previewTimer;
  const project = createProject({
    doc, monaco, editor,
    isEditable: () => canEdit(),
    onTabs: () => { renderTabs(); refreshFile(); },
    onActive: () => { refreshFile(); cursors.refresh(); sendSelection(); },
    onChange: () => { clearTimeout(previewTimer); previewTimer = setTimeout(updatePreview, 350); },
  });
  const cursors = createRemoteCursors(monaco, editor, () => project.active ?? "");
  // The terminal is created early because the file panes talk to it as soon as a file opens.
  const term = createTerminal($("terminal"), { onRun: () => run() });

  /* Console tabs ------------------------------------------------ */
  const panes = { terminal: $("terminal"), preview: $("preview-pane") };
  let openTab = "terminal";
  // Switch the console between output, input and preview.
  function selectTab(name) {
    openTab = name;
    for (const [key, node] of Object.entries(panes)) {
      node.hidden = key !== name;
      $(`tab-${key}`).setAttribute("aria-selected", String(key === name));
    }
  }
  for (const key of Object.keys(panes)) $(`tab-${key}`).addEventListener("click", () => selectTab(key));

  /* Files and language ------------------------------------------ */
  let compilers = {};
  // Which language the open file implies.
  const fileLang = (name) => (name ? languageForFile(name) : null);
  // The line in the status bar saying where this language runs.
  const runtimeLabel = (id) => {
    if (!id) return "Plain text";
    const l = LANGUAGES[id];
    if (l.runtime === "browser") return "Runs in this browser";
    if (l.runtime === "preview") return "Live preview";
    const info = compilers[id];
    return info ? `${info.provider} ${info.version}` : "Built on a public service";
  };

  // Rebuild the preview document, or hide the tab when no HTML file is open.
  function updatePreview() {
    const entry = previewEntry(project.all(), project.active ?? "");
    $("tab-preview").hidden = !entry;
    if (!entry) { if (openTab === "preview") selectTab("terminal"); return; }
    $("preview").srcdoc = buildPreview(project.all(), entry);
  }

  let lastLang;
  // Update everything that depends on which file is open.
  function refreshFile() {
    const name = project.active;
    if (!name) return;
    const id = fileLang(name);
    const l = id ? LANGUAGES[id] : null;
    $("lang-icon").replaceChildren(l ? langTile(l, 19) : icon("ph-file-text"));
    $("lang-label").textContent = l ? l.label : "Plain text";
    $("file-status").textContent = name;
    $("runtime-info").textContent = runtimeLabel(id);
    // The sample input belongs to the sample program, so it is only offered while the file is
    // still the starter template.
    if (l?.stdin && project.text(name).trim() === l.template.trim()) term.preload(l.stdin);
    if (id !== lastLang) {
      lastLang = id;
      if (l?.runtime === "preview") selectTab("preview");
    }
    updatePreview();
  }

  // Changing the language of a file renames it, since the extension is what decides.
  function setLanguage(id) {
    const name = project.active;
    if (!name) return;
    if (!canEdit()) { toast("Only editors can change the language", "ph-lock-simple"); return; }
    const current = fileLang(name);
    if (current === id) return;
    const base = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
    const target = `${base}.${LANGUAGES[id].ext}`;
    if (project.has(target)) { toast(`${target} is already in this project`, "ph-warning"); return; }
    const body = project.text(name).trim();
    const untouched = !body || (current && body === LANGUAGES[current].template.trim());
    if (!project.rename(name, target)) { nameProblem(target); return; }
    if (untouched) project.setText(target, LANGUAGES[id].template);
  }

  // Fill an empty project: a shared snapshot if the link had one, otherwise a starter file.
  async function seed() {
    if (project.names().length) return;
    const snap = snapFragment ? await decodeSnapshot(snapFragment) : null;
    if (snap) {
      for (const f of snap.files) project.create(f.name, f.code);
      if (snap.active && project.has(snap.active)) project.open(snap.active);
      toast("Opened a shared snapshot", "ph-camera");
    } else {
      project.create(START_FILE, LANGUAGES.python.template);
    }
  }

  fetch("/api/languages").then((r) => (r.ok ? r.json() : null)).then((j) => {
    if (!j?.languages) return;
    compilers = j.languages;
    refreshFile();
  }).catch(() => {});

  /* File tabs --------------------------------------------------- */
  const filebar = $("filebar");
  // Explain why a file name was refused.
  function nameProblem(name) {
    if (!validFileName(name)) toast("Letters, numbers, dots, dashes and spaces only", "ph-warning");
    else if (project.has(name)) toast(`${name} is already in this project`, "ph-warning");
    else toast(`A project holds up to ${MAX_FILES} files`, "ph-warning");
  }
  // Inline input in the tab bar for naming and renaming.
  function askFileName(initial, done, before) {
    const input = el("input", "field file-input");
    input.value = initial;
    input.placeholder = "name.py";
    input.setAttribute("aria-label", "File name");
    let settled = false;
    // Close the inline input, keeping or discarding what was typed.
    const finish = (commit) => {
      if (settled) return;
      settled = true;
      const value = input.value.trim();
      input.remove();
      if (commit && value && value !== initial) done(value);
      renderTabs();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finish(true);
      else if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
    if (before) filebar.insertBefore(input, before); else filebar.append(input);
    input.focus();
    input.select();
  }
  // Add a file, if this person is allowed to.
  const newFile = () => {
    if (!canEdit()) { toast("Only editors can add files", "ph-lock-simple"); return; }
    askFileName("", (name) => { if (!project.create(name, "")) nameProblem(name); }, filebar.querySelector(".file-add"));
  };

  // Draw the file tabs, with rename and delete for editors only.
  function renderTabs() {
    filebar.replaceChildren();
    const editable = canEdit();
    const names = project.names();
    for (const name of names) {
      const tab = el("button", "file");
      tab.type = "button";
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(name === project.active));
      tab.title = editable ? `${name} (double-click to rename)` : name;
      const id = fileLang(name);
      tab.append(id ? langTile(LANGUAGES[id], 15) : icon("ph-file-text"), el("span", "", name));
      tab.addEventListener("click", () => { project.open(name); editor.focus(); });
      if (editable) {
        tab.addEventListener("dblclick", () => {
          tab.remove();
          askFileName(name, (to) => { if (!project.rename(name, to)) nameProblem(to); });
        });
        if (names.length > 1) {
          const x = el("button", "x");
          x.type = "button";
          x.title = `Delete ${name}`;
          x.setAttribute("aria-label", `Delete ${name}`);
          x.append(icon("ph-x"));
          x.addEventListener("click", (e) => {
            e.stopPropagation();
            if (confirm(`Delete ${name} from the project, for everyone?`)) project.remove(name);
          });
          tab.append(x);
        }
      }
      filebar.append(tab);
    }
    if (editable && names.length < MAX_FILES) {
      const add = el("button", "file-add");
      add.type = "button";
      add.title = "New file";
      add.setAttribute("aria-label", "New file");
      add.append(icon("ph-plus"));
      add.addEventListener("click", newFile);
      filebar.append(add);
    }
  }

  /* Terminal ---------------------------------------------------- */
  const chunks = [];
  // Terminal colours: the runners speak in stdout/stderr/meta.
  const KIND = { stdout: "out", stderr: "err", meta: "meta", who: "who", cmd: "cmd" };

  // The short run summary beside the console tabs.
  function setVerdict(text, kind = "") {
    const node = $("verdict");
    node.className = `verdict ${kind}`;
    node.replaceChildren(...(kind ? [el("i", `dot ${kind === "ok" ? "ok" : kind === "bad" ? "bad" : "warn"}`)] : []), document.createTextNode(text));
  }

  // Append one chunk of program output, keeping a copy for the room and the clipboard.
  function write(text, kind = "stdout") {
    chunks.push([text, kind]);
    if (chunks.length > 500) chunks.shift();
    term.write(text, KIND[kind] ?? "out");
  }

  // Wipe the transcript and forget what it held.
  function clearOutput() {
    chunks.length = 0;
    term.clear();
    setVerdict("");
  }

  term.write(`Type a line and press Enter to hand it to the next run. ${MOD} + Enter runs.\n`, "meta");
  $("clear").addEventListener("click", () => { clearOutput(); monaco.editor.setModelMarkers(editor.getModel(), "run", []); });
  $("copy-output").addEventListener("click", async () => {
    if (await copyText(term.text())) toast("Terminal copied");
    else toast("Could not copy the terminal", "ph-warning");
  });
  editor.onDidChangeModelContent(() => monaco.editor.setModelMarkers(editor.getModel(), "run", []));

  /* Running ----------------------------------------------------- */
  const runBtn = $("run");
  let running = false;
  // Run the open file, or refresh the preview when it is a web page.
  async function run() {
    if (running || !project.active) return;
    const name = project.active;
    const id = fileLang(name);
    const files = project.all();

    if (!id || LANGUAGES[id].runtime === "preview") {
      if (!previewEntry(files, name)) { toast("This file type cannot be run. Open a code file.", "ph-warning"); return; }
      updatePreview();
      selectTab("preview");
      toast("Preview refreshed", "ph-browser");
      return;
    }

    running = true;
    runBtn.disabled = true;
    $("run-label").textContent = "Running";
    term.setBusy(true);
    setVerdict("Working", "busy");
    monaco.editor.setModelMarkers(editor.getModel(), "run", []);
    selectTab("terminal");

    // Whatever was typed ahead of the run is this program's standard input.
    const stdin = term.takeQueued().join("\n");
    chunks.length = 0;
    term.write(`\n$ run ${name}\n`, "cmd");

    const started = performance.now();
    let result = { ok: false };
    try {
      result = await runCode(id, project.text(name), stdin, {
        write,
        status: (t) => setVerdict(t, "busy"),
        // Local programs can ask for another line; the terminal collects it.
        needInput: LANGUAGES[id].runtime === "browser" ? () => term.ask() : undefined,
      }, files.filter((f) => f.name !== name));
    } catch (e) {
      write(`Unexpected error: ${e.message}\n`, "stderr");
    } finally {
      running = false;
      runBtn.disabled = false;
      $("run-label").textContent = "Run";
      term.setBusy(false);
      if (!chunks.length) write("The program finished without printing anything.\n", "meta");
    }

    const secs = ((performance.now() - started) / 1000).toFixed(2);
    const via = result.meta ? `${result.meta.provider} ${result.meta.version} · ` : "";
    const summary = `${name} · ${via}${secs}s`;
    setVerdict(`${result.ok ? "Finished" : "Failed"} · ${summary}`, result.ok ? "ok" : "bad");
    if (result.error?.line && project.active === name) {
      monaco.editor.setModelMarkers(editor.getModel(), "run", [{
        severity: monaco.MarkerSeverity.Error,
        message: result.error.message.replace(/^MiniLang \w+ at line \d+, col \d+: /, ""),
        startLineNumber: result.error.line,
        startColumn: result.error.col || 1,
        endLineNumber: result.error.line,
        endColumn: (result.error.col || 1) + 1,
      }]);
    }
    if (net && canEdit()) net.sendRun({ lang: id, ok: result.ok, summary, segs: chunks.slice(0, 400) });
  }
  runBtn.addEventListener("click", run);

  /* People, roles, follow --------------------------------------- */
  const selections = new Map();
  let following = null;

  // The strip above the editor: what is going on and what to do about it.
  function showNotice(kind, stamp, text, action) {
    const node = $("notice");
    node.hidden = false;
    $("notice-stamp").className = `stamp ${kind}`;
    $("notice-stamp").textContent = stamp;
    $("notice-text").textContent = text;
    const btn = $("notice-action");
    btn.hidden = !action;
    if (action) {
      btn.textContent = action.label;
      btn.disabled = Boolean(action.disabled);
      btn.onclick = action.run;
    }
  }

  // Work out which notice, if any, the current state deserves.
  function updateNotice() {
    if (connection === "offline") {
      return showNotice("bad", "Offline", "The room server cannot be reached. Your copy stays editable and syncs when it comes back.", { label: "Try again", run: () => net?.retry() });
    }
    if (connection === "reconnecting") return showNotice("bad", "Reconnecting", "Looking for the room server. Your edits are kept in this browser.");
    if (peerMode && !peerNoticeSeen) {
      return showNotice("viewer", "Peer to peer", "This site has no room server, so everyone here can edit. Roles, passcodes and checkpoints need one.", { label: "Got it", run: () => { peerNoticeSeen = true; updateNotice(); } });
    }
    if (!solo && role === "viewer" && connection === "connected") {
      return showNotice("viewer", "View only", "The host has not given you edit access yet. You can still run the project for yourself.", {
        label: asked ? "Request sent" : "Ask to edit",
        disabled: asked,
        run: async () => {
          const r = await net.requestEdit();
          if (r.ok) { asked = true; updateNotice(); toast("The host has been asked", "ph-hand-waving"); }
          else toast(r.error === "too-soon" ? "Give the host a few seconds" : "Could not send that request", "ph-warning");
        },
      });
    }
    $("notice").hidden = true;
  }

  // Apply a role everywhere: the editor, the badge, the panels, the tabs.
  function applyRole(next) {
    const before = role;
    role = next;
    editor.updateOptions({ readOnly: !canEdit() });
    const badge = $("role-badge");
    badge.hidden = solo || peerMode || !role;
    badge.className = `stamp ${role ?? ""}`;
    badge.textContent = role ?? "";
    $("stab-room").hidden = role !== "host";
    if (role !== "host" && !$("pane-room").hidden) selectSide("crew");
    $("cp-save").disabled = !canEdit() || peerMode;
    if (before !== role) updateNotice();
    updateNotice();
    renderPeople();
    renderHistory();
    renderTabs();
  }

  // Follow a selection, switching files when it is somewhere else.
  const jumpTo = (sel) => {
    if (!sel) return;
    if (sel.file && project.has(sel.file) && project.active !== sel.file) project.open(sel.file);
    const model = editor.getModel();
    if (model) editor.revealPositionInCenterIfOutsideViewport(model.getPositionAt(Math.min(sel.head, model.getValueLength())), monaco.editor.ScrollType.Smooth);
  };
  // Start or stop following somebody.
  function setFollow(id) {
    following = id && members.some((m) => m.id === id) ? id : null;
    $("follow").hidden = !following;
    if (following) {
      $("follow-text").textContent = `Following ${members.find((m) => m.id === following).name}`;
      jumpTo(selections.get(following));
    }
    renderPeople();
  }
  $("follow-stop").addEventListener("click", () => setFollow(null));

  // One person in the side panel, with whatever actions we may take on them.
  function memberRow(m) {
    const mine = m.id === myId;
    const row = el("div", `member${following === m.id ? " followed" : ""}`);
    const chip = el("span", "chip", (m.name[0] || "?").toUpperCase());
    chip.style.background = m.color;

    const who = el("div", "who");
    who.append(el("b", "", m.name));
    if (!peerMode) who.append(el("span", `stamp ${m.role}`, m.role));
    if (mine) who.append(el("span", "mine", "You"));

    const acts = el("div", "acts");
    // Add one small icon button to a person's row.
    const act = (name, label, run, danger) => {
      const b = el("button", `btn sm icon quiet${danger ? " danger" : ""}`);
      b.type = "button";
      b.title = label;
      b.setAttribute("aria-label", label);
      b.append(icon(name));
      b.addEventListener("click", run);
      acts.append(b);
    };
    if (!mine) act("ph-crosshair", following === m.id ? "Stop following" : `Follow ${m.name}`, () => setFollow(following === m.id ? null : m.id));
    if (role === "host" && !mine && m.role !== "host") {
      act(m.role === "viewer" ? "ph-pencil-simple" : "ph-eye", m.role === "viewer" ? `Let ${m.name} edit` : `Make ${m.name} a viewer`, async () => {
        const r = await net.setRole(m.id, m.role === "viewer" ? "editor" : "viewer");
        if (!r.ok) toast("Could not change that role", "ph-warning");
      });
      act("ph-crown-simple", `Make ${m.name} the host`, async () => {
        if (!confirm(`Hand the host role to ${m.name}? You become an editor.`)) return;
        const r = await net.transfer(m.id);
        if (!r.ok) toast("Could not hand over the host role", "ph-warning");
      });
      act("ph-user-minus", `Remove ${m.name}`, async () => {
        if (!confirm(`Remove ${m.name} from this room?`)) return;
        const r = await net.kick(m.id);
        if (!r.ok) toast("Could not remove them", "ph-warning");
      }, true);
    }

    row.append(chip, who, acts);
    const where = selections.get(m.id)?.file;
    if (where && !mine) row.append(el("span", "at", `in ${where}`));
    return row;
  }

  // Draw pending requests, then everybody in the room, then the connection line.
  function renderPeople() {
    const box = $("crew");
    box.replaceChildren();
    for (const [id, req] of pending) {
      const card = el("div", "ask");
      card.append(el("span", "", `${req.name} asks to edit`));
      const yes = el("button", "btn sm primary", "Allow");
      yes.type = "button";
      yes.addEventListener("click", async () => { await net.respond(id, true); pending.delete(id); renderPeople(); });
      const no = el("button", "btn sm", "Deny");
      no.type = "button";
      no.addEventListener("click", async () => { await net.respond(id, false); pending.delete(id); renderPeople(); });
      card.append(yes, no);
      box.append(card);
    }
    if (solo) {
      box.append(Object.assign(el("div", "blank"), { innerHTML: '<i class="ph ph-users-three"></i><span>Open a room to work with other people. Everyone shows up here with their role.</span>' }));
    }
    for (const m of members) box.append(memberRow(m));
    $("crew-count").textContent = String(Math.max(1, members.length));
    if (!solo) {
      const n = members.length;
      const text = { connected: n > 1 ? `Connected, ${n} people` : "Connected, just you", reconnecting: "Reconnecting", offline: "Offline", connecting: "Connecting" }[connection] ?? "";
      $("conn-text").textContent = text;
      $("conn-dot").className = `dot ${connection === "connected" ? "ok" : connection === "offline" ? "bad" : "warn"}`;
    }
  }

  /* Chat -------------------------------------------------------- */
  let unread = 0;
  const chatLog = $("chat-log");
  // Empty state for the chat pane.
  const chatBlank = () => chatLog.append(Object.assign(el("div", "blank"), { innerHTML: '<i class="ph ph-chat-circle"></i><span>No messages yet</span>' }));
  // Append a chat message and count it as unread when the pane is closed.
  function addChat(m) {
    chatLog.querySelector(".blank")?.remove();
    const row = el("div", "msg");
    const who = el("b");
    who.style.color = /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : "";
    who.append(document.createTextNode(String(m.by).slice(0, 20)));
    if (!peerMode && ["host", "editor", "viewer"].includes(m.role)) who.append(el("span", `stamp ${m.role}`, m.role));
    row.append(who, el("span", "", String(m.text).slice(0, 500)));
    chatLog.append(row);
    chatLog.scrollTop = chatLog.scrollHeight;
    if ($("pane-chat").hidden && m.by !== myName) {
      unread += 1;
      $("chat-badge").textContent = String(unread);
      $("chat-badge").hidden = false;
    }
  }
  chatBlank();
  $("chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("chat-input").value.trim();
    if (text && net) net.sendChat(text);
    $("chat-input").value = "";
  });

  /* Checkpoints ------------------------------------------------- */
  let checkpoints = [];
  // Draw the checkpoint list, or explain why there is none.
  function renderHistory() {
    const box = $("hist");
    box.replaceChildren();
    if (solo || peerMode) {
      box.append(Object.assign(el("div", "blank"), { innerHTML: `<i class="ph ph-clock-counter-clockwise"></i><span>${solo ? "Checkpoints live in rooms." : "Checkpoints need a room server."}</span>` }));
      return;
    }
    if (!checkpoints.length) {
      box.append(Object.assign(el("div", "blank"), { innerHTML: '<i class="ph ph-clock-counter-clockwise"></i><span>No checkpoints yet. Save one before a risky change.</span>' }));
      return;
    }
    for (const cp of checkpoints) {
      const row = el("div", "rev");
      row.title = (cp.names || []).join(", ");
      const when = new Date(cp.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      row.append(el("b", "", cp.name), el("small", "", `${cp.by} · ${when} · ${cp.count} file${cp.count === 1 ? "" : "s"}`));
      const btn = el("button", "btn sm", "Restore");
      btn.type = "button";
      btn.disabled = !canEdit();
      btn.addEventListener("click", async () => {
        if (!confirm(`Replace the whole project with "${cp.name}", for everyone?`)) return;
        const r = await net.restoreCheckpoint(cp.id);
        if (!r.ok) toast("Could not restore that checkpoint", "ph-warning");
      });
      row.append(btn);
      box.append(row);
    }
  }
  $("cp-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!net || peerMode) return;
    const r = await net.saveCheckpoint($("cp-name").value);
    if (r.ok) { $("cp-name").value = ""; toast("Checkpoint saved", "ph-clock-counter-clockwise"); }
    else toast("Only editors can save checkpoints", "ph-lock-simple");
  });

  /* Room controls (host) ---------------------------------------- */
  function renderRoomControls() {
    $("seg-default").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.role === roomSettings.defaultRole)));
    $("lock").checked = roomSettings.locked;
    $("pass").placeholder = roomSettings.hasPasscode ? "A passcode is set" : "No passcode";
  }
  $("seg-default").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-role]");
    if (!b) return;
    const r = await net.settings({ defaultRole: b.dataset.role });
    if (!r.ok) toast("Only the host can change that", "ph-lock-simple");
  });
  $("lock").addEventListener("change", async (e) => {
    const r = await net.settings({ locked: e.target.checked });
    if (!r.ok) e.target.checked = !e.target.checked;
  });
  $("pass-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = $("pass").value.trim();
    const r = await net.settings({ passcode: value });
    if (r.ok) { $("pass").value = ""; toast(value ? "Passcode set" : "Passcode cleared", "ph-key"); }
  });

  /* Side panel -------------------------------------------------- */
  const sidePanes = { crew: "pane-crew", chat: "pane-chat", history: "pane-history", room: "pane-room" };
  // Switch the side panel between people, chat, saves and room settings.
  function selectSide(name) {
    for (const [key, id] of Object.entries(sidePanes)) {
      $(id).hidden = key !== name;
      $(`stab-${key}`).setAttribute("aria-selected", String(key === name));
    }
    if (name === "chat") {
      unread = 0;
      $("chat-badge").hidden = true;
      chatLog.scrollTop = chatLog.scrollHeight;
    }
  }
  for (const key of Object.keys(sidePanes)) $(`stab-${key}`).addEventListener("click", () => selectSide(key));

  /* Networking -------------------------------------------------- */
  const hostKey = `host:${roomId}`;
  // Tell the room where this cursor is, and in which file.
  const sendSelection = () => {
    const s = editor.getSelection();
    const model = editor.getModel();
    if (net && s && model) {
      net.sendAwareness({ anchor: model.getOffsetAt(s.getStartPosition()), head: model.getOffsetAt(s.getEndPosition()), file: project.active ?? "" });
    }
  };

  const handlers = {
    onStatus: (s) => { connection = s === "connected" ? "connected" : s; updateNotice(); renderPeople(); },
    onJoined: async (res) => {
      gate.close();
      myId = res.you.id;
      peerMode = Boolean(res.p2p);
      members = res.users;
      roomSettings = res.settings;
      checkpoints = res.checkpoints;
      asked = false;
      chatLog.replaceChildren();
      if (res.chat.length) res.chat.forEach(addChat); else chatBlank();
      unread = 0;
      $("chat-badge").hidden = true;
      project.migrateLegacy(START_FILE);
      applyRole(res.you.role);
      renderRoomControls();
      // Only one person seeds a fresh room, so two people never both add a starter file.
      if (peerMode) setTimeout(() => { if (members.length <= 1) seed(); }, 1800);
      else if (res.you.role === "host") await seed();
    },
    onJoinError: async (code) => {
      connection = "connected";
      if (code === "passcode" || code === "passcode-wrong") {
        const { passcode } = await gate.show({
          title: "This room has a passcode",
          text: "Ask the host for it, then type it here.",
          needName: false, needPass: true,
          error: code === "passcode-wrong" ? "That passcode was not right." : "",
          action: "Join the room",
        });
        net.join({ passcode });
        return;
      }
      const messages = {
        locked: ["The room is locked", "The host closed this room to new people. Ask them to unlock it."],
        removed: ["You were removed", "The host removed you from this room for the rest of the session."],
        full: ["The room is full", "This room already holds 30 people."],
        busy: ["The server is busy", "It cannot open another room right now. Try again shortly."],
        invalid: ["Not a valid room", "That room code does not look right."],
      };
      const [title, text] = messages[code] ?? ["Could not join", "Something went wrong on the way into this room."];
      gate.show({ title, text, needName: false, action: code === "locked" ? "Try again" : "", home: true }).then(() => net.join());
    },
    onPresence: (list) => {
      const ids = new Set(list.map((m) => m.id));
      for (const id of [...selections.keys()]) if (!ids.has(id)) { selections.delete(id); cursors.update(id, null); }
      members = list;
      if (following && !ids.has(following)) setFollow(null);
      for (const [id, sel] of selections) {
        const m = list.find((x) => x.id === id);
        if (m) cursors.update(id, { name: m.name, color: m.color, sel });
      }
      for (const id of [...pending.keys()]) if (!ids.has(id)) pending.delete(id);
      renderPeople();
    },
    onAwareness: (id, sel) => {
      const m = members.find((x) => x.id === id);
      if (!sel || !m) { selections.delete(id); cursors.update(id, null); return; }
      selections.set(id, sel);
      cursors.update(id, { name: m.name, color: m.color, sel });
      if (following === id) jumpTo(sel);
      renderPeople();
    },
    onChat: addChat,
    onRun: (r) => {
      clearOutput();
      write(`${String(r.by).slice(0, 20)} ran ${String(r.summary || "the project").split(" · ")[0].slice(0, 40)}\n\n`, "who");
      for (const [text, kind] of r.segs || []) write(String(text), ["stdout", "stderr", "meta"].includes(kind) ? kind : "stdout");
      setVerdict(`${r.ok ? "Finished" : "Failed"} · ${String(r.summary).slice(0, 80)}`, r.ok ? "ok" : "bad");
      selectTab("terminal");
    },
    onRole: (next) => {
      const before = role;
      if (before === "host" && next !== "host") store.del(hostKey);
      applyRole(next);
      if (next === "editor" && before === "viewer") { asked = false; toast("You can edit now", "ph-pencil-simple"); }
      else if (next === "viewer") toast("The host made you a viewer", "ph-eye");
      else if (next === "host") toast("You are the host now", "ph-crown-simple");
    },
    onSettings: (s) => { roomSettings = s; renderRoomControls(); },
    onCheckpoints: (list) => { checkpoints = list; renderHistory(); },
    onNotice: (n) => {
      if (n.code === "read-only") toast("Viewers cannot change the project", "ph-lock-simple");
      else if (n.code === "restored") toast(`${n.by ?? "Someone"} restored "${n.name}"`, "ph-clock-counter-clockwise");
    },
    onKicked: () => {
      net.close();
      gate.show({ title: "You were removed", text: "The host removed you from this room.", needName: false, action: "", home: true });
    },
    onRequest: (r) => { pending.set(r.id, r); renderPeople(); toast(`${r.name} asks to edit`, "ph-hand-waving"); selectSide("crew"); },
    onDenied: () => { asked = false; updateNotice(); toast("The host said no for now", "ph-hand-palm"); },
    onHostToken: (token) => store.set(hostKey, token),
  };

  project.migrateLegacy(START_FILE);
  if (solo) {
    $("conn-text").textContent = "Local session, saved in this browser";
    $("conn-dot").className = "dot ok";
    applyRole(null);
    await seed();
    renderPeople();
  } else {
    const identity = { roomId, doc, getIdentity: () => ({ name: myName, hostToken: store.get(hostKey) || undefined }), handlers };
    net = useServer ? connectRoom({ url: serverUrl(), ...identity }) : connectPeers(identity);
    applyRole(role);
    window.addEventListener("pagehide", () => net.close());
  }
  editor.onDidChangeCursorSelection(sendSelection);
  window.__project = project; // convenient in the browser console

  /* Sharing and files ------------------------------------------- */
  const copy = async (text, ok) => {
    if (await copyText(text)) { toast(ok); return; }
    // Browsers refuse the clipboard when the page is not focused, so never fail silently.
    toast("The browser blocked the clipboard, so here is the link", "ph-warning");
    window.prompt("Copy this link", text);
  };
  // Copy the plain room link.
  const copyInvite = () => (solo ? toast("Open a room to invite people", "ph-info") : copy(`${location.origin}/r/${roomId}`, "Invite link copied"));
  // Copy a link that carries the whole project inside it.
  const copySnapshot = async () => copy(`${location.origin}/play#s=${await encodeSnapshot({ files: project.all(), active: project.active })}`, "Snapshot link copied");
  // Save the open file to disk.
  function download() {
    const name = project.active;
    const url = URL.createObjectURL(new Blob([project.text(name)], { type: "text/plain" }));
    Object.assign(document.createElement("a"), { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  // Add a file from the visitor's machine.
  const addFromDisk = () => {
    if (!canEdit()) { toast("Only editors can add files", "ph-lock-simple"); return; }
    $("file-input").click();
  };
  $("file-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 512 * 1024) { toast("That file is larger than 512 KB", "ph-warning"); return; }
    let name = file.name.replace(/[^\w .-]/g, "_");
    if (!validFileName(name)) name = `upload.${extOf(file.name) || "txt"}`;
    if (project.has(name)) {
      const dot = name.lastIndexOf(".");
      name = `${dot > 0 ? name.slice(0, dot) : name}-copy${dot > 0 ? name.slice(dot) : ""}`;
    }
    if (!project.create(name, await file.text())) { nameProblem(name); return; }
    toast(`Added ${name}`, "ph-folder-open");
  });
  if (!solo) {
    $("room-id").style.cursor = "pointer";
    $("room-id").title = "Copy the invite link";
    $("room-id").addEventListener("click", copyInvite);
  }
  anchorMenu($("share-btn"), $("share-menu"));
  $("m-invite").addEventListener("click", copyInvite);
  $("m-snapshot").addEventListener("click", copySnapshot);
  $("m-download").addEventListener("click", download);
  $("m-open").addEventListener("click", addFromDisk);
  $("m-invite").hidden = solo;

  /* Editor settings --------------------------------------------- */
  anchorMenu($("settings-btn"), $("settings-menu"));
  // Push the editor settings into Monaco and store them.
  const applySettings = () => {
    editor.updateOptions({
      fontSize: settings.fontSize,
      wordWrap: settings.wrap ? "on" : "off",
      minimap: { enabled: settings.minimap },
      fontLigatures: settings.ligatures,
    });
    $("fs-value").textContent = String(settings.fontSize);
    $("set-wrap").checked = settings.wrap;
    $("set-minimap").checked = settings.minimap;
    $("set-ligatures").checked = settings.ligatures;
    saveSettings();
  };
  // Step the font size within sensible bounds.
  const bumpFont = (d) => { settings.fontSize = Math.max(10, Math.min(28, settings.fontSize + d)); applySettings(); };
  $("fs-minus").addEventListener("click", (e) => { e.stopPropagation(); bumpFont(-1); });
  $("fs-plus").addEventListener("click", (e) => { e.stopPropagation(); bumpFont(1); });
  $("set-wrap").addEventListener("change", (e) => { settings.wrap = e.target.checked; applySettings(); });
  $("set-minimap").addEventListener("change", (e) => { settings.minimap = e.target.checked; applySettings(); });
  $("set-ligatures").addEventListener("change", (e) => { settings.ligatures = e.target.checked; applySettings(); });
  applySettings();

  /* Layout ------------------------------------------------------ */
  const workspace = $("workspace");
  // Show or hide the side panel, and remember the choice.
  const toggleSide = () => {
    if (solo) return;
    workspace.classList.toggle("closed");
    store.set("side", workspace.classList.contains("closed") ? "closed" : "open");
  };
  if (!solo && store.get("side") === "closed") workspace.classList.add("closed");
  $("side-toggle").addEventListener("click", toggleSide);

  const main = $("main"), grip = $("grip");
  const savedHeight = Number(store.get("consoleH"));
  if (savedHeight >= 80) main.style.setProperty("--console", `${savedHeight}px`);
  grip.addEventListener("pointerdown", (e) => {
    grip.setPointerCapture(e.pointerId);
    grip.classList.add("dragging");
    // Drag the console taller or shorter.
    const move = (ev) => {
      const rect = main.getBoundingClientRect();
      main.style.setProperty("--console", `${Math.min(rect.height - 160, Math.max(80, rect.bottom - ev.clientY))}px`);
    };
    // Finish the drag and remember the height.
    const up = () => {
      grip.classList.remove("dragging");
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      store.set("consoleH", parseInt(main.style.getPropertyValue("--console")));
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
  });
  editor.onDidChangeCursorPosition((e) => { $("pos").textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`; });

  /* Command palette --------------------------------------------- */
  const palette = createPalette($("palette"));
  // Every language, as palette entries that rename the open file.
  const languageItems = () => GROUPS.flatMap((g) => LANGUAGE_IDS.filter((id) => LANGUAGES[id].group === g).map((id) => ({
    title: LANGUAGES[id].label,
    group: g,
    keywords: `${id} ${LANGUAGES[id].ext}`,
    tile: () => langTile(LANGUAGES[id], 22),
    hint: id === fileLang(project.active) ? "current" : LANGUAGES[id].runtime === "remote" ? "remote" : "local",
    run: () => setLanguage(id),
  })));
  // Open the palette filtered to languages.
  const openLanguages = () => palette.open(languageItems, `Set the language of ${project.active ?? "this file"}`);
  // Everything the palette can do, grouped.
  const commandItems = () => [
    { title: "Run the project", group: "Do", icon: "ph-play", hint: `${MOD} ↵`, run },
    { title: "New file", group: "Do", icon: "ph-file-plus", run: newFile },
    { title: "Set the language of this file", group: "Do", icon: "ph-translate", run: openLanguages },
    ...(solo ? [] : [
      { title: "Copy the invite link", group: "Room", icon: "ph-link", run: copyInvite },
      { title: "Save a checkpoint", group: "Room", icon: "ph-clock-counter-clockwise", run: () => { selectSide("history"); $("cp-name").focus(); } },
      { title: "People and roles", group: "Room", icon: "ph-users-three", run: () => selectSide("crew") },
      { title: "Open chat", group: "Room", icon: "ph-chat-circle", run: () => selectSide("chat") },
    ]),
    { title: "Copy a snapshot link", group: "Share", icon: "ph-camera", run: copySnapshot },
    { title: "Download this file", group: "Share", icon: "ph-download-simple", run: download },
    { title: "Add a file from disk", group: "Share", icon: "ph-folder-open", run: addFromDisk },
    ...THEMES.map((t) => ({ title: `Theme: ${t.label}`, group: "Look", icon: "ph-palette", run: () => setTheme(t.id) })),
    { title: "Bigger text", group: "Look", icon: "ph-text-aa", run: () => bumpFont(1) },
    { title: "Smaller text", group: "Look", icon: "ph-text-aa", run: () => bumpFont(-1) },
    { title: "Word wrap", group: "Look", icon: "ph-text-align-left", run: () => { settings.wrap = !settings.wrap; applySettings(); } },
    { title: "Minimap", group: "Look", icon: "ph-map-trifold", run: () => { settings.minimap = !settings.minimap; applySettings(); } },
    ...(solo ? [] : [{ title: "Side panel", group: "Look", icon: "ph-sidebar-simple", run: toggleSide }]),
    { title: "Clear the output", group: "Look", icon: "ph-trash", run: () => $("clear").click() },
    { title: "About CodeSync", group: "Go", icon: "ph-info", run: openAbout },
    { title: "Home page", group: "Go", icon: "ph-house", run: () => { location.href = "/"; } },
    ...project.names().map((n) => ({ title: n, group: "Open a file", icon: "ph-file-code", hint: n === project.active ? "open" : "", run: () => project.open(n) })),
    ...languageItems().map((i) => ({ ...i, group: "Languages" })),
  ];
  // Open the palette on the full command list.
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
  const booting = document.getElementById("booting");
  if (booting) booting.replaceChildren(`Could not start the editor: ${e.message}`);
});
