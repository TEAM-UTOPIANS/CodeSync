/* global io, require, monaco */

const $ = (id) => document.getElementById(id);

// ---- OT helpers (pos-based ops) ----
// Op: {pos:number, del:number, ins:string}
function transform(a, b) {
  let aPos = a.pos;
  let aDel = a.del || 0;
  const aIns = a.ins || "";
  const bPos = b.pos;
  const bDel = b.del || 0;
  const bIns = b.ins || "";

  if (bIns) {
    if (bPos < aPos || (bPos === aPos && !aIns)) aPos += bIns.length;
  }

  if (bDel) {
    const bEnd = bPos + bDel;
    if (bEnd <= aPos) aPos -= bDel;
    else if (bPos < aPos && aPos < bEnd) aPos = bPos;

    if (aDel) {
      const aEnd = aPos + aDel;
      const overlapStart = Math.max(aPos, bPos);
      const overlapEnd = Math.min(aEnd, bEnd);
      if (overlapEnd > overlapStart) aDel = Math.max(0, aDel - (overlapEnd - overlapStart));
    }
  }

  return { pos: aPos, del: aDel, ins: aIns };
}

const state = {
  socket: null,
  roomId: null,
  me: null,
  hostSid: null,
  users: new Map(), // sid -> user
  editor: null,
  theme: "dark",
  language: "python",
  cursorDecorations: new Map(), // sid -> decorationIds
  execHistory: [],
  lastMarkers: [],

  files: new Map(), // path -> {path, model, rev, pending, applying, sub}
  activePath: "main",
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

  if (state.editor) monaco.editor.setTheme(next === "dark" ? "codesync-dark" : "vs");
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

    // Host can assign editor/viewer for non-host users
    if (state.me?.sid === state.hostSid && u.sid !== state.hostSid) {
      const sel = document.createElement("select");
      sel.className =
        "text-xs rounded-lg px-2 py-1 border bg-transparent " +
        (state.theme === "dark" ? "border-white/20" : "border-black/20");
      sel.innerHTML = `
        <option value="editor">editor</option>
        <option value="viewer">viewer</option>
      `;
      sel.value = u.role === "viewer" ? "viewer" : "editor";
      sel.onchange = () => {
        if (!state.roomId) return;
        ensureSocket().emit("room:set_role", { roomId: state.roomId, targetSid: u.sid, role: sel.value });
      };
      row.appendChild(sel);
    }
    list.appendChild(row);
  }
}

function setEditorReadOnly() {
  if (!state.editor) return;
  const isViewer = state.me?.role === "viewer";
  state.editor.updateOptions({ readOnly: !!isViewer });
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
  const f = state.files.get(state.activePath);
  if (!f) return;
  monaco.editor.setModelMarkers(f.model, "codesync", []);
  state.lastMarkers = [];
}

function setErrorMarkersFromStderr(stderr) {
  // Heuristic: parse "line X, col Y" from MiniLang errors
  if (!state.editor) return;
  const f = state.files.get(state.activePath);
  if (!f) return;
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
  monaco.editor.setModelMarkers(f.model, "codesync", markers);
  state.lastMarkers = markers;
}

const term = () => window.CodeSyncTerminal;

async function runCode() {
  const f = state.files.get(state.activePath);
  if (!f) return;
  clearMarkers();
  const code = f.model.getValue();
  if (term()) term().beforeRun();
  const stdin = term() ? term().getStdin() : "";
  const language = $("languageSelect").value;
  state.language = language;

  const btn = $("runBtn");
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = "Running...";
  btn.classList.add("opacity-70");

  try {
    const res = await fetch("/api/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language, code, stdin }),
    });
    const data = await res.json();
    if (!data.ok) {
      const errText = term() ? term().formatRunResult(data) : data.error || data.stderr || "Execution failed";
      const isWaiting = data.status === "WAITING_FOR_INPUT";
      toast(isWaiting ? "info" : "error", errText);
      if (term()) term().setRunOutput(errText);
      if (data.stderr && !isWaiting) setErrorMarkersFromStderr(data.stderr);
      return;
    }

    const stdout = data.stdout || "";
    const stderr = data.stderr || "";
    const status = data.status || "";
    if (term()) term().setRunOutput(term().formatRunResult(data));

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
    if (term()) term().setRunOutput(String(e));
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
    state.hostSid = payload.hostSid || null;
    state.users.clear();
    for (const u of payload.users || []) state.users.set(u.sid, u);
    $("roomLabel").textContent = state.roomId;
    setRoomIdInUrl(state.roomId);
    renderUsers();
    setEditorReadOnly();

    const files = payload.files || [{ path: "main", content: "", rev: 0 }];
    for (const file of files) {
      ensureFileModel(file.path || "main", file.content || "", Number(file.rev || 0));
    }
    renderTabs();
    if (!state.files.has(state.activePath)) state.activePath = files[0]?.path || "main";
    setActiveFile(state.activePath);

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
    state.hostSid = hostSid || null;
    for (const u of state.users.values()) {
      if (u.sid === hostSid) u.role = "host";
      else if (u.role === "host") u.role = "editor";
    }
    if (state.me && state.me.sid === hostSid) state.me.role = "host";
    renderUsers();
    setEditorReadOnly();
    toast("info", "Host changed");
  });

  sock.on("room:role_updated", ({ sid, role }) => {
    const u = state.users.get(sid);
    if (u) u.role = role;
    if (state.me?.sid === sid) {
      state.me.role = role;
      setEditorReadOnly();
      toast("info", role === "viewer" ? "You are now viewer (read-only)" : "You are now editor");
    }
    renderUsers();
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

  sock.on("file:created", ({ file }) => {
    if (!file?.path) return;
    ensureFileModel(file.path, file.content || "", Number(file.rev || 0));
    renderTabs();
    toast("success", `File created: ${file.path}`);
  });

  sock.on("editor:op", ({ path, ops, fromSid }) => {
    if (!path || !Array.isArray(ops)) return;
    if (fromSid && fromSid === state.me?.sid) return;
    applyRemoteOps(path, ops);
    setSyncStatus("Synced");
    setTimeout(() => setSyncStatus("Connected"), 700);
  });

  sock.on("editor:ack", ({ path, acceptedOps, rev }) => {
    const f = state.files.get(path);
    if (!f) return;
    const n = Math.max(0, Number(acceptedOps || 0));
    if (n > 0) f.pending.splice(0, n);
    if (Number.isFinite(Number(rev))) f.rev = Number(rev);
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
  const f = state.files.get(state.activePath);
  if (!f) return;
  if (lang === "minilang") monaco.editor.setModelLanguage(f.model, "minilang");
  else if (lang === "cpp") monaco.editor.setModelLanguage(f.model, "cpp");
  else if (lang === "java") monaco.editor.setModelLanguage(f.model, "java");
  else monaco.editor.setModelLanguage(f.model, "python");
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
      action: () => saveLocal(true),
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

function saveLocal(showToast = false) {
  const f = state.files.get(state.activePath);
  if (!f) return;
  const payload = {
    roomId: state.roomId,
    language: $("languageSelect").value,
    files: [...state.files.values()].map((x) => ({ path: x.path, content: x.model.getValue() })),
    activePath: state.activePath,
    stdin: term() ? term().getStdin() : "",
    ts: Date.now(),
  };
  localStorage.setItem("codesync:last", JSON.stringify(payload));
  if (showToast) toast("success", "Saved locally");
}

function restoreLocal() {
  try {
    const raw = localStorage.getItem("codesync:last");
    if (!raw) return;
    const p = JSON.parse(raw);
    if (p.language) $("languageSelect").value = p.language;
    if (p.stdin && term()) term().setStdin(p.stdin);
    if (Array.isArray(p.files)) {
      for (const file of p.files) {
        if (file?.path && typeof file.content === "string") ensureFileModel(file.path, file.content, 0);
      }
    }
    if (p.activePath) state.activePath = p.activePath;
    toast("info", "Restored local draft");
  } catch {
    // ignore
  }
}

function exportProject() {
  const f = state.files.get(state.activePath);
  if (!f) return;
  const payload = {
    roomId: state.roomId,
    language: $("languageSelect").value,
    files: [...state.files.values()].map((x) => ({ path: x.path, content: x.model.getValue() })),
    stdin: term() ? term().getStdin() : "",
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

function ensureFileModel(path, content, rev = 0) {
  if (state.files.has(path)) return state.files.get(path);
  const model = monaco.editor.createModel(content || "", "python");
  const fileState = { path, model, rev: Number(rev || 0), pending: [], applying: false, sub: null };

  fileState.sub = model.onDidChangeContent((e) => {
    if (fileState.applying) return;
    saveLocal();
    if (!state.roomId) return;
    if (state.me?.role === "viewer") return;
    const changes = [...e.changes].sort((a, b) => a.rangeOffset - b.rangeOffset);
    const ops = changes.map((c) => ({ pos: c.rangeOffset, del: c.rangeLength, ins: c.text || "" }));
    if (ops.length === 0) return;
    const baseRev = fileState.rev;
    fileState.pending.push(...ops);
    fileState.rev += ops.length;
    ensureSocket().emit("editor:op", { roomId: state.roomId, path, baseRev, ops });
    setSyncStatus("Syncing...");
  });

  state.files.set(path, fileState);
  return fileState;
}

function setActiveFile(path) {
  const f = state.files.get(path);
  if (!f || !state.editor) return;
  state.activePath = path;
  state.editor.setModel(f.model);
  setEditorReadOnly();
  clearMarkers();
  renderTabs();
}

function applyRemoteOps(path, ops) {
  const f = state.files.get(path);
  if (!f) return;
  const model = f.model;
  const pending = f.pending || [];
  const transformed = ops.map((op) => {
    let t = { pos: Number(op.pos || 0), del: Number(op.del || 0), ins: op.ins || "" };
    for (const p of pending) t = transform(t, p);
    return t;
  });

  f.applying = true;
  const edits = transformed.map((op) => {
    const start = model.getPositionAt(op.pos);
    const end = model.getPositionAt(op.pos + (op.del || 0));
    return {
      range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
      text: op.ins || "",
      forceMoveMarkers: true,
    };
  });
  model.pushEditOperations([], edits, () => null);
  f.applying = false;
}

function renderTabs() {
  const tabs = $("tabs");
  if (!tabs) return;
  tabs.innerHTML = "";
  const paths = [...state.files.keys()].sort((a, b) => (a === "main" ? -1 : b === "main" ? 1 : a.localeCompare(b)));

  for (const p of paths) {
    const btn = document.createElement("button");
    btn.className =
      "tab-btn px-3 py-2 text-sm rounded-xl " + (p === state.activePath ? "tab-btn-active" : "");
    btn.textContent = p;
    btn.onclick = () => setActiveFile(p);
    tabs.appendChild(btn);
  }

  const plus = document.createElement("button");
  plus.className = "tab-btn px-3 py-2 text-sm rounded-xl";
  plus.textContent = "+";
  plus.title = "New file";
  plus.onclick = () => {
    const name = prompt("New file name (e.g. main.py, utils.js, notes.txt)")?.trim();
    if (!name) return;
    if (state.files.has(name)) return toast("warn", "File already exists");
    ensureFileModel(name, "", 0);
    renderTabs();
    setActiveFile(name);
    if (state.roomId) ensureSocket().emit("file:create", { roomId: state.roomId, path: name });
  };
  tabs.appendChild(plus);
}

function registerMiniLangMonaco() {
  monaco.languages.register({ id: "minilang" });
  monaco.languages.setMonarchTokensProvider("minilang", {
    tokenizer: {
      root: [
        [/#.*$/, "comment"],
        [/"([^"\\]|\\.)*$/, "string.invalid"],
        [/"/, { token: "string.quote", bracket: "@open", next: "@string" }],
        [/\b(START|STOP|LET|PRINT|IF|THEN|ELSE|END|INPUT)\b/, "keyword"],
        [/\b(true|false|null)\b/i, "constant"],
        [/[a-zA-Z_]\w*/, "identifier"],
        [/\d+(\.\d+)?/, "number"],
        [/!=|==|<=|>=|[+\-*/<>=()]/, "operator"],
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

    state.editor = monaco.editor.create($("editor"), {
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
    // Ensure at least one tab/model exists
    ensureFileModel("main", "", 0);
    renderTabs();
    setActiveFile(state.activePath || "main");

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
      saveLocal(true);
    }
  });
}

function boot() {
  if (window.CodeSyncTerminal) window.CodeSyncTerminal.init();
  setupUi();
  setupShare();
  setupResizableBottomPanel();
  setupCommandPalette();
  setupShortcuts();
  setTheme("dark");
  initMonaco();
}

boot();

