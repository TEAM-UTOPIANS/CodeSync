// Room networking: Socket.IO transport for a Yjs document plus presence, roles, chat and history.
// The server is the authority for roles. This module only reflects what the server says.
import * as Y from "https://esm.sh/yjs@13.6.32";
import { io } from "https://cdn.jsdelivr.net/npm/socket.io-client@4.8.1/dist/socket.io.esm.min.js";

export { Y };
const REMOTE = "remote";

// Bytes to base64, the shape updates travel in.
const toB64 = (u8) => { let s = ""; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
// Base64 back to bytes.
const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
// Updates cross the wire as base64 strings (see server/index.js).

/** Where the Socket.IO server lives. Set by config.js in production; localhost defaults to :3001. */
export function serverUrl() {
  if (new URLSearchParams(location.search).has("p2p")) return ""; // ?p2p forces the serverless peer-to-peer mode
  const configured = window.CODESYNC?.socketUrl;
  if (configured) return configured.replace(/\/$/, "");
  if (["localhost", "127.0.0.1"].includes(location.hostname)) return `http://${location.hostname}:3001`;
  return "";
}

/** Load and save a document snapshot in localStorage so a room survives a refresh or a server restart. */
export function persist(doc, key) {
  const storageKey = `codesync:doc:${key}`;
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) Y.applyUpdate(doc, fromB64(saved), REMOTE);
  } catch { /* corrupt or unavailable storage: start empty */ }
  let timer;
  doc.on("update", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try { localStorage.setItem(storageKey, toB64(Y.encodeStateAsUpdate(doc))); } catch { /* quota or private mode */ }
    }, 400);
  });
}

// A stable id for this browser, used to keep removed people out.
export function clientId() {
  try {
    let id = localStorage.getItem("codesync:clientId");
    if (!id) { id = crypto.randomUUID(); localStorage.setItem("codesync:clientId", id); }
    return id;
  } catch { return crypto.randomUUID(); }
}

/**
 * Connect to a room.
 * handlers: onStatus(status), onJoined(res), onJoinError(code), onPresence(users), onChat(message),
 *   onRun(result), onRole(role), onSettings(settings), onCheckpoints(list), onNotice(notice), onKicked(),
 *   onRequest({id,name}), onDenied(), onHostToken(token), onAwareness(id, sel)
 */
export function connectRoom({ url, roomId, doc, getIdentity, handlers }) {
  const socket = io(url, { transports: ["websocket", "polling"], reconnectionDelayMax: 5000 });
  let role = null;
  let joined = false;

  // Only the host and editors may send document updates.
  const canEdit = () => role === "host" || role === "editor";
  // Emit an event and wait for the server's answer, with a timeout.
  const call = (event, payload) => new Promise((resolve) => {
    if (!socket.connected) return resolve({ ok: false, error: "offline" });
    socket.timeout(8000).emit(event, payload, (err, res) => resolve(err ? { ok: false, error: "timeout" } : res));
  });

  // Local edits go to the server, which drops them if this user is not allowed to edit.
  doc.on("update", (update, origin) => {
    if (origin !== REMOTE && joined && canEdit()) socket.emit("doc:update", toB64(update));
  });

  // Announce ourselves to the room and take whatever state the server hands back.
  function join(extra = {}) {
    const identity = getIdentity();
    socket.emit("join", { roomId, clientId: clientId(), ...identity, ...extra }, (res) => {
      if (!res?.ok) { joined = false; handlers.onJoinError?.(res?.error ?? "invalid"); return; }
      joined = true;
      role = res.you.role;
      const serverState = fromB64(res.doc);
      Y.applyUpdate(doc, serverState, REMOTE);
      // Push what the server is missing (first join, or the server restarted and lost the room).
      if (canEdit()) {
        const missing = Y.encodeStateAsUpdate(doc, Y.encodeStateVectorFromUpdate(serverState));
        if (missing.byteLength > 2) socket.emit("doc:update", toB64(missing));
      }
      handlers.onJoined?.(res);
    });
  }

  socket.on("connect", () => { handlers.onStatus?.("connected"); join(); });
  socket.on("disconnect", () => { joined = false; handlers.onStatus?.("reconnecting"); });
  socket.on("connect_error", () => handlers.onStatus?.(socket.active ? "reconnecting" : "offline"));
  socket.io.on("reconnect_attempt", () => handlers.onStatus?.("reconnecting"));

  socket.on("doc:update", (b64) => { try { Y.applyUpdate(doc, fromB64(b64), REMOTE); } catch { /* ignore malformed update */ } });
  socket.on("presence", (users) => handlers.onPresence?.(users));
  socket.on("awareness", ({ id, sel }) => handlers.onAwareness?.(id, sel));
  socket.on("chat:message", (m) => handlers.onChat?.(m));
  socket.on("run:result", (r) => handlers.onRun?.(r));
  socket.on("role:changed", ({ role: next }) => {
    role = next;
    handlers.onRole?.(next);
  });
  socket.on("room:settings", (s) => handlers.onSettings?.(s));
  socket.on("checkpoints", (list) => handlers.onCheckpoints?.(list));
  socket.on("notice", (n) => handlers.onNotice?.(n));
  socket.on("kicked", () => handlers.onKicked?.());
  socket.on("role:request", (r) => handlers.onRequest?.(r));
  socket.on("role:denied", () => handlers.onDenied?.());
  socket.on("host:token", ({ token }) => handlers.onHostToken?.(token));

  return {
    join,
    close: () => socket.close(),
    retry: () => socket.connect(),
    get connected() { return socket.connected; },
    sendAwareness: (sel) => { if (joined) socket.volatile.emit("awareness", sel); },
    sendChat: (text) => socket.emit("chat:send", text),
    sendRun: (result) => socket.emit("run:result", result),
    setRole: (id, next) => call("role:set", { id, role: next }),
    requestEdit: () => call("role:request"),
    respond: (id, approve) => call("role:respond", { id, approve }),
    settings: (s) => call("room:settings", s),
    kick: (id) => call("user:kick", { id }),
    transfer: (id) => call("host:transfer", { id }),
    saveCheckpoint: (name) => call("checkpoint:save", { name }),
    restoreCheckpoint: (id) => call("checkpoint:restore", { id }),
  };
}
