/* global io, require, monaco */

const $ = (id) => document.getElementById(id);

const state = {
  socket: null,
  roomId: null,
  me: null,
  users: new Map(), // sid -> user
  editor: null,
  model: null,
  theme: "dark",
  language: "python",
  codeVersion: 0,
  applyingRemote: false,
  cursorDecorations: new Map(), // sid -> decorationIds
  execHistory: [],
  lastMarkers: [],
};

const COLORS = ["#60a5fa", "#f472b6", "#34d399", "#fbbf24", "#a78bfa", "#fb7185", "#22c55e", "#38bdf8"];

function randomColor(seed = Math.random()) {
  const idx = Math.floor(seed * COLORS.length) % COLORS.length;
  return COLORS[idx];
}

function toast(kind, message, ttl = 2800) {
  const el = document.createElement("div");
  const base =
    "fade-in max-w-sm rounded-2xl px-3 py-2 text-sm border shadow-glass " +
    (state.theme === "dark" ? "glass border-white/10" : "glass-light border-black/10");
  const tone =
    kind === "success"
      ? " text-emerald-200"
      : kind === "error"
        ? " text-rose-200"
        : kind === "warn"
          ? " text-amber-200"
          : " text-slate-100";
  el.className = base + tone;
  el.textContent = message;
  $("toasts").appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(6px)";
    el.style.transition = "opacity 180ms ease, transform 180ms ease";
    setTimeout(() => el.remove(), 220);
  }, ttl);
}

function setTheme(next) {
  state.theme = next;
  document.body.classList.toggle("dark", next === "dark");
  document.body.classList.toggle("bg-slate-950", next === "dark");
  document.body.classList.toggle("text-slate-100", next === "dark");
  document.body.classList.toggle("bg-slate-50", next !== "dark");
  document.body.classList.toggle("text-slate-950", next !== "dark");
  document.body.classList.toggle("light", next !== "dark");

  if (state.editor) {
    monaco.editor.setTheme(next === "dark" ? "codesync-dark" : "vs");
  }
}

function getRoomIdFromUrl() {
  const url = new URL(window.location.href);
  const fromQuery = url.searchParams.get("room");
  if (fromQuery) return fromQuery;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length >= 2 && parts[0] === "room") return parts[1];
  return null;
}

function setRoomIdInUrl(roomId) {
  const url = new URL(window.location.href);
  url.searchParams.set("room", roomId);
  window.history.replaceState({}, "", url.toString());
}

function renderUsers() {
  const list = $("usersList");
  list.innerHTML = "";
  const users = Array.from(state.users.values()).sort((a, b) => {
    const rank = (u) => (u.role === "host" ? 0 : u.role === "editor" ? 1 : 2);
    return rank(a) - rank(b) || a.name.localeCompare(b.name);
  });
  $("onlineCount").textContent = String(users.length);

  for (const u of users) {
    const row = document.createElement("div");
    row.className =
      "flex items-center justify-between rounded-xl px-2 py-2 border " +
      (state.theme === "dark" ? "border-white/10 bg-white/5" : "border-black/10 bg-black/5");

    const left = document.createElement("div");
    left.className = "flex items-center gap-2 min-w-0";

    const avatar = document.createElement("div");
    avatar.className = "h-7 w-7 rounded-xl flex items-center justify-center text-xs font-bold";
    avatar.style.background = u.color || "#60a5fa";
    avatar.textContent = (u.name || "?").slice(0, 2).toUpperCase();

    const meta = document.createElement("div");
    meta.className = "min-w-0";
    const name = document.createElement("div");
    name.className = "text-sm font-semibold truncate";
    name.textContent = u.sid === state.me?.sid ? `${u.name} (you)` : u.name;
    const role = document.createElement("div");
    role.className = "text-xs text-slate-300";
    role.textContent = u.role;

    meta.appendChild(name);
    meta.appendChild(role);
    left.appendChild(avatar);
    left.appendChild(meta);

    row.appendChild(left);
    list.appendChild(row);
  }
}

function appendChat(entry) {
  const log = $("chatLog");
  const row = document.createElement("div");
  row.className = "rounded-xl px-2 py-2 border " + (state.theme === "dark" ? "border-white/10 bg-white/5" : "border-black/10 bg-black/5");

  const head = document.createElement("div");
  head.className = "flex items-center justify-between";
  const who = document.createElement("div");
  who.className = "text-xs font-semibold";
  who.style.color = entry.color || "#60a5fa";
  who.textContent = entry.sid === state.me?.sid ? `${entry.name} (you)` : entry.name;
  const ts = document.createElement("div");
  ts.className = "text-[10px] opacity-60";
  ts.textContent = new Date(entry.ts * 1000).toLocaleTimeString();
  head.appendChild(who);
  head.appendChild(ts);

  const msg = document.createElement("div");
  msg.className = "text-sm mt-1 whitespace-pre-wrap break-words";
  msg.textContent = entry.message;

  row.appendChild(head);
  row.appendChild(msg);
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
}

function setSyncStatus(text) {
  $("syncStatus").textContent = text;
}

function clearMarkers() {
  if (!state.editor) return;
  monaco.editor.setModelMarkers(state.model, "codesync", []);
  state.lastMarkers = [];
}

function setErrorMarkersFromStderr(stderr) {
  // Heuristic: parse "line X, col Y" from MiniLang errors
  if (!state.editor) return;
  const markers = [];
  const m = /line\s+(\d+),\s*col\s+(\d+)/i.exec(stderr || "");
  if (m) {
    const line = Number(m[1]);
    const col = Number(m[2]);
    markers.push({
      severity: monaco.MarkerSeverity.Error,
      message: stderr,
      startLineNumber: line,
      startColumn: col,
      endLineNumber: line,
      endColumn: col + 1,
    });
  } else if (stderr) {
    markers.push({
      severity: monaco.MarkerSeverity.Error,
      message: stderr,
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 1,
    });
  }
  monaco.editor.setModelMarkers(state.model, "codesync", markers);
  state.lastMarkers = markers;
}

function outputWrite(text) {
  $("output").textContent = text || "";
}

async function runCode() {
  if (!state.model) return;
  clearMarkers();
  const code = state.model.getValue();
  const stdin = $("stdin").value || "";
  const language = $("languageSelect").value;
  state.language = language;

  const btn = $("runBtn");
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = "Running...";
  btn.classList.add("opacity-70");

  outputWrite("");

  try {
    const res = await fetch("/api/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language, code, stdin }),
    });
    const data = await res.json();
    if (!data.ok) {
      toast("error", data.error || "Execution failed");
      outputWrite(data.error || "Execution failed");
      return;
    }

    const stdout = data.stdout || "";
    const stderr = data.stderr || "";
    const status = data.status || "";

    const combined =
      (status ? `Status: ${status}\n\n` : "") +
      (stdout ? `stdout:\n${stdout}\n\n` : "") +
      (stderr ? `stderr:\n${stderr}\n` : "");
    outputWrite(combined.trim() + "\n");

    if (stderr) {
      setErrorMarkersFromStderr(stderr);
      toast("warn", "Completed with errors");
    } else {
      toast("success", "Run completed");
    }

    state.execHistory.unshift({ ts: Date.now(), language, status, stdout, stderr });
    state.execHistory = state.execHistory.slice(0, 30);
  } catch (e) {
    toast("error", String(e));
    outputWrite(String(e));
  } finally {
    btn.disabled = false;
    btn.textContent = old;
    btn.classList.remove("opacity-70");
  }
}

function ensureSocket() {
  if (state.socket) return state.socket;
  if (typeof io === "undefined") {
    toast("error", "Socket.IO client failed to load. Refresh the page.");
    throw new Error("Socket.IO client not loaded (io is undefined)");
  }
  // When the server runs with async_mode="threading" (Werkzeug), WebSocket upgrades can 500.
  // Force long-polling for reliability on macOS dev.
  const sock = io({ transports: ["polling"], upgrade: false });
  state.socket = sock;

  sock.on("connect", () => {
    setSyncStatus("Connected");
    $("chatStatus").textContent = "Connected";
  });

  sock.on("disconnect", () => {
    setSyncStatus("Disconnected");
    $("chatStatus").textContent = "Disconnected";
  });

  sock.on("room:state", (payload) => {
    state.roomId = payload.roomId;
    state.me = payload.me;
    state.users.clear();
    for (const u of payload.users || []) state.users.set(u.sid, u);
    $("roomLabel").textContent = state.roomId;
    setRoomIdInUrl(state.roomId);
    renderUsers();

    state.applyingRemote = true;
    if (typeof payload.code === "string" && state.model) state.model.setValue(payload.code);
    state.applyingRemote = false;

    if (payload.language) {
      $("languageSelect").value = payload.language;
      state.language = payload.language;
      setEditorLanguage(payload.language);
    }

    $("chatLog").innerHTML = "";
    for (const c of payload.chat || []) appendChat(c);
    toast("success", `Joined room ${state.roomId}`);
  });

  sock.on("room:user_joined", ({ user }) => {
    if (!user) return;
    state.users.set(user.sid, user);
    renderUsers();
    toast("info", `${user.name} joined`);
  });

  sock.on("room:user_left", ({ sid }) => {
    if (!sid) return;
    const u = state.users.get(sid);
    state.users.delete(sid);
    renderUsers();
    if (u) toast("info", `${u.name} left`);
    clearRemoteCursor(sid);
  });

  sock.on("room:host_changed", ({ hostSid }) => {
    for (const u of state.users.values()) {
      if (u.sid === hostSid) u.role = "host";
      else if (u.role === "host") u.role = "editor";
    }
    renderUsers();
    toast("info", "Host changed");
  });

  sock.on("room:toast", ({ kind, message }) => toast(kind || "info", message || ""));

  sock.on("room:chat", (entry) => appendChat(entry));

  sock.on("room:language", ({ language }) => {
    if (!language) return;
    $("languageSelect").value = language;
    state.language = language;
    setEditorLanguage(language);
    toast("info", `Language set to ${language}`);
  });

  sock.on("editor:code", ({ code, fromSid }) => {
    if (!state.model) return;
    if (fromSid && fromSid === state.me?.sid) return;
    state.applyingRemote = true;
    state.model.setValue(code || "");
    state.applyingRemote = false;
    setSyncStatus("Synced");
    setTimeout(() => setSyncStatus("Connected"), 700);
  });

  sock.on("editor:cursor", ({ sid, cursor }) => {
    if (!sid || !cursor) return;
    renderRemoteCursor(sid, cursor);
  });

  return sock;
}

function joinRoom(roomId) {
  if (!roomId) {
    toast("error", "Missing room id");
    return;
  }
  const sock = ensureSocket();
  const url = new URL(window.location.href);
  const nameFromUrl = url.searchParams.get("name");
  const roleFromUrl = url.searchParams.get("role");
  if (nameFromUrl && $("nameInput").value.trim().length === 0) $("nameInput").value = nameFromUrl;
  if (roleFromUrl) $("roleSelect").value = roleFromUrl;

  const name = $("nameInput").value.trim() || "Anonymous";
  const role = $("roleSelect").value;
  const color = state.me?.color || randomColor(hashString(name));
  sock.emit("room:join", { roomId, name, role, color });
  setSyncStatus("Joining...");
}

function sendChat() {
  if (!state.roomId) return toast("error", "Join a room first");
  const msg = $("chatInput").value.trim();
  if (!msg) return;
  $("chatInput").value = "";
  ensureSocket().emit("room:chat", { roomId: state.roomId, message: msg });
}

function setEditorLanguage(lang) {
  if (!state.model) return;
  if (lang === "minilang") monaco.editor.setModelLanguage(state.model, "minilang");
  else if (lang === "cpp") monaco.editor.setModelLanguage(state.model, "cpp");
  else if (lang === "java") monaco.editor.setModelLanguage(state.model, "java");
  else monaco.editor.setModelLanguage(state.model, "python");
}

function clearRemoteCursor(sid) {
  const dec = state.cursorDecorations.get(sid);
  if (!dec || !state.editor) return;
  state.editor.deltaDecorations(dec, []);
  state.cursorDecorations.delete(sid);
}

function renderRemoteCursor(sid, cursor) {
  if (!state.editor || sid === state.me?.sid) return;
  const user = state.users.get(sid);
  const color = user?.color || "#60a5fa";

  const range = new monaco.Range(cursor.lineNumber || 1, cursor.column || 1, cursor.lineNumber || 1, cursor.column || 1);
  const className = `remote-cursor-${sid.slice(0, 6)}`;
  ensureCursorStyle(className, color);

  const newDecs = [
    {
      range,
      options: {
        className,
        hoverMessage: { value: user ? `${user.name}` : "Collaborator" },
      },
    },
  ];
  const old = state.cursorDecorations.get(sid) || [];
  const ids = state.editor.deltaDecorations(old, newDecs);
  state.cursorDecorations.set(sid, ids);
}

function ensureCursorStyle(className, color) {
  const id = `style-${className}`;
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    .${className} {
      border-left: 2px solid ${color};
      margin-left: -1px;
    }
  `;
  document.head.appendChild(style);
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 2 ** 32;
}

function setupCommandPalette() {
  const backdrop = $("paletteBackdrop");
  const palette = $("palette");
  const input = $("paletteInput");
  const list = $("paletteList");

  const commands = [
    { id: "run", label: "Run code", action: () => runCode() },
    {
      id: "share",
      label: "Copy room share link",
      action: () => $("shareBtn").click(),
    },
    { id: "theme", label: "Toggle theme", action: () => $("themeBtn").click() },
    {
      id: "export",
      label: "Export project JSON",
      action: () => exportProject(),
    },
    {
      id: "save",
      label: "Save locally",
      action: () => saveLocal(),
    },
  ];

  function open() {
    backdrop.classList.remove("hidden");
    palette.classList.remove("hidden");
    input.value = "";
    render("");
    setTimeout(() => input.focus(), 0);
  }
  function close() {
    backdrop.classList.add("hidden");
    palette.classList.add("hidden");
  }
  function render(q) {
    const qq = (q || "").toLowerCase().trim();
    const filtered = commands.filter((c) => c.label.toLowerCase().includes(qq));
    list.innerHTML = "";
    for (const c of filtered.slice(0, 8)) {
      const item = document.createElement("button");
      item.className =
        "w-full text-left rounded-xl px-3 py-2 border " +
        (state.theme === "dark" ? "border-white/10 hover:bg-white/10" : "border-black/10 hover:bg-black/5");
      item.textContent = c.label;
      item.onclick = () => {
        close();
        c.action();
      };
      list.appendChild(item);
    }
  }

  backdrop.onclick = close;
  input.addEventListener("input", () => render(input.value));
  document.addEventListener("keydown", (e) => {
    const isMac = navigator.platform.toLowerCase().includes("mac");
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (palette.classList.contains("hidden")) open();
      else close();
    }
    if (e.key === "Escape" && !palette.classList.contains("hidden")) close();
  });
}

function saveLocal() {
  if (!state.model) return;
  const payload = {
    roomId: state.roomId,
    language: $("languageSelect").value,
    code: state.model.getValue(),
    stdin: $("stdin").value || "",
    ts: Date.now(),
  };
  localStorage.setItem("codesync:last", JSON.stringify(payload));
  toast("success", "Saved locally");
}

function restoreLocal() {
  try {
    const raw = localStorage.getItem("codesync:last");
    if (!raw) return;
    const p = JSON.parse(raw);
    if (p.language) $("languageSelect").value = p.language;
    if (p.stdin) $("stdin").value = p.stdin;
    if (p.code && state.model) state.model.setValue(p.code);
    toast("info", "Restored local draft");
  } catch {
    // ignore
  }
}

function exportProject() {
  if (!state.model) return;
  const payload = {
    roomId: state.roomId,
    language: $("languageSelect").value,
    files: [{ path: "main", content: state.model.getValue() }],
    stdin: $("stdin").value || "",
    history: state.execHistory,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `codesync-${state.roomId || "project"}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("success", "Exported project JSON");
}

function setupResizableBottomPanel() {
  const handle = $("resizeHandle");
  const panel = $("bottomPanel");
  let dragging = false;
  let startY = 0;
  let startH = 0;

  handle.addEventListener("mousedown", (e) => {
    dragging = true;
    startY = e.clientY;
    startH = panel.getBoundingClientRect().height;
    document.body.style.userSelect = "none";
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dy = startY - e.clientY;
    const next = Math.max(140, Math.min(420, startH + dy));
    panel.style.height = `${next}px`;
    if (state.editor) state.editor.layout();
  });
  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.userSelect = "";
  });
}

function setupShare() {
  $("shareBtn").addEventListener("click", async () => {
    if (!state.roomId) return toast("error", "Join a room first");
    const url = new URL(window.location.href);
    url.searchParams.set("room", state.roomId);
    try {
      await navigator.clipboard.writeText(url.toString());
      toast("success", "Copied share link");
    } catch {
      toast("warn", "Copy failed (browser permissions). Link in URL bar.");
    }
  });
}

function setupEditorSync() {
  state.model.onDidChangeContent(() => {
    if (state.applyingRemote) return;
    saveLocal();
    if (!state.roomId) return;
    if (state.me?.role === "viewer") return;
    state.codeVersion += 1;
    ensureSocket().emit("editor:code", { roomId: state.roomId, code: state.model.getValue(), version: state.codeVersion });
    setSyncStatus("Syncing...");
  });

  state.editor.onDidChangeCursorPosition((e) => {
    if (!state.roomId) return;
    ensureSocket().emit("editor:cursor", {
      roomId: state.roomId,
      cursor: { lineNumber: e.position.lineNumber, column: e.position.column },
    });
  });
}

function setupUi() {
  $("themeBtn").addEventListener("click", () => setTheme(state.theme === "dark" ? "light" : "dark"));
  $("runBtn").addEventListener("click", runCode);
  $("clearOutputBtn").addEventListener("click", () => outputWrite(""));
  $("chatSendBtn").addEventListener("click", sendChat);
  $("chatInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendChat();
  });

  $("languageSelect").addEventListener("change", () => {
    const lang = $("languageSelect").value;
    setEditorLanguage(lang);
    clearMarkers();
    if (state.roomId) ensureSocket().emit("room:set_language", { roomId: state.roomId, language: lang });
  });

  $("joinBtn").addEventListener("click", () => {
    const rid = state.roomId || getRoomIdFromUrl() || $("roomLabel").textContent;
    const roomId = rid && rid !== "—" ? rid : prompt("Enter room ID");
    if (roomId) joinRoom(roomId);
  });
}

function registerMiniLangMonaco() {
  monaco.languages.register({ id: "minilang" });
  monaco.languages.setMonarchTokensProvider("minilang", {
    tokenizer: {
      root: [
        [/#.*$/, "comment"],
        [/"([^"\\]|\\.)*$/, "string.invalid"],
        [/"/, { token: "string.quote", bracket: "@open", next: "@string" }],
        [/\b(START|STOP|LET|PRINT|IF|THEN|END)\b/, "keyword"],
        [/\b(true|false|null)\b/i, "constant"],
        [/[a-zA-Z_]\w*/, "identifier"],
        [/\d+(\.\d+)?/, "number"],
        [/==|[+\-*/<>=()]/, "operator"],
        [/[ \t\r\n]+/, "white"],
      ],
      string: [
        [/[^\\"]+/, "string"],
        [/\\./, "string.escape"],
        [/"/, { token: "string.quote", bracket: "@close", next: "@pop" }],
      ],
    },
  });
}

function initMonaco() {
  require.config({ paths: { vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs" } });
  require(["vs/editor/editor.main"], () => {
    registerMiniLangMonaco();
    monaco.editor.defineTheme("codesync-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "keyword", foreground: "93c5fd", fontStyle: "bold" },
        { token: "comment", foreground: "64748b" },
        { token: "number", foreground: "fbbf24" },
        { token: "string", foreground: "34d399" },
      ],
      colors: {
        "editor.background": "#0b1220",
      },
    });

    state.model = monaco.editor.createModel("", "python");
    state.editor = monaco.editor.create($("editor"), {
      model: state.model,
      theme: "codesync-dark",
      automaticLayout: true,
      minimap: { enabled: true },
      fontSize: 13,
      fontLigatures: true,
      scrollBeyondLastLine: false,
      cursorSmoothCaretAnimation: "on",
      smoothScrolling: true,
      renderWhitespace: "selection",
    });

    setupEditorSync();
    restoreLocal();

    const maybeRoom = getRoomIdFromUrl();
    if (maybeRoom) {
      $("roomLabel").textContent = maybeRoom;
      joinRoom(maybeRoom);
    } else {
      setSyncStatus("Create or join a room");
    }
  });
}

function setupShortcuts() {
  document.addEventListener("keydown", (e) => {
    const isMac = navigator.platform.toLowerCase().includes("mac");
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (mod && e.key === "Enter") {
      e.preventDefault();
      runCode();
    }
    if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      saveLocal();
    }
  });
}

function boot() {
  setupUi();
  setupShare();
  setupResizableBottomPanel();
  setupCommandPalette();
  setupShortcuts();
  setTheme("dark");
  initMonaco();
}

boot();

