// Room state and permission rules. No networking in here, so every rule is unit-testable.
import { createHash, randomBytes } from "node:crypto";
import * as Y from "yjs";

export const ROLES = ["host", "editor", "viewer"];
export const JOINABLE_ROLES = ["editor", "viewer"];
export const LIMITS = { users: 30, chat: 200, checkpoints: 30, update: 256 * 1024, name: 20, message: 500, fileName: 60 };

// Cursor colours (identity only). Role is shown separately, so these stay away from the role colours.
const CURSOR_COLORS = ["#f28b82", "#7bc47f", "#7fb7f5", "#f6c453", "#c3a6f2", "#f2a1cf", "#f4a261", "#9bd16b"];

// Hash a secret so the room can compare it without storing it.
export const sha = (s) => createHash("sha256").update(String(s)).digest("hex");
// A fresh random token, used for host handover.
export const newToken = () => randomBytes(18).toString("base64url");
// Strip control characters and angle brackets out of a display name.
export const cleanName = (s) => [...String(s ?? "")].filter((c) => c.charCodeAt(0) >= 32 && c !== "<" && c !== ">").join("").trim().slice(0, LIMITS.name) || "Guest";
// Accept a room id only if it looks like one of ours.
export const cleanRoomId = (s) => (/^[a-z0-9-]{4,40}$/i.test(String(s)) ? String(s).toLowerCase() : null);

export class Room {
  // A room starts empty, unlocked, with no host and no passcode.
  constructor(id) {
    this.id = id;
    this.doc = new Y.Doc();
    this.users = new Map(); // socket id -> {id, clientId, name, color, role}
    this.hostHash = null;
    this.defaultRole = "editor";
    this.locked = false;
    this.passHash = null;
    this.banned = new Set(); // clientIds removed by the host for this session
    this.chat = [];
    this.checkpoints = [];
    this.requests = new Map(); // socket id -> timestamp of the last edit request
    this.touched = Date.now();
    this.colorIndex = 0;
  }

  // Mark the room as used, so the sweeper leaves it alone.
  touch() { this.touched = Date.now(); }
  /** Project files in tab order: [{name, code}]. Each file is a Y.Text inside the "files" map. */
  files() {
    const map = this.doc.getMap("files");
    const order = this.doc.getArray("order").toArray();
    const names = [...new Set([...order.filter((n) => map.has(n)), ...map.keys()])];
    return names.map((name) => ({ name, code: String(map.get(name)?.toString?.() ?? "") }));
  }
  // Socket ids of everyone currently hosting.
  hostIds() { return [...this.users.values()].filter((u) => u.role === "host").map((u) => u.id); }

  // The people list as the clients see it, without client ids.
  publicUsers() {
    return [...this.users.values()].map(({ id, name, color, role }) => ({ id, name, color, role }));
  }
  // Room settings as the clients see them, with the passcode reduced to a yes or no.
  publicSettings() {
    return { defaultRole: this.defaultRole, locked: this.locked, hasPasscode: Boolean(this.passHash) };
  }

  /**
   * Try to admit a user. Returns {ok, user} or {ok:false, error}.
   * The first user to present a host token for a fresh room becomes host; the room remembers only its hash.
   */
  admit({ socketId, clientId, name, hostToken, passcode }) {
    if (this.banned.has(clientId)) return { ok: false, error: "removed" };
    if (this.users.size >= LIMITS.users) return { ok: false, error: "full" };

    const isHost = Boolean(hostToken) && (this.hostHash === null || sha(hostToken) === this.hostHash);
    if (!isHost) {
      if (this.locked) return { ok: false, error: "locked" };
      if (this.passHash && sha(passcode ?? "") !== this.passHash) return { ok: false, error: passcode ? "passcode-wrong" : "passcode" };
    }
    if (isHost && this.hostHash === null) this.hostHash = sha(hostToken);

    const user = {
      id: socketId,
      clientId,
      name: cleanName(name),
      color: CURSOR_COLORS[this.colorIndex++ % CURSOR_COLORS.length],
      role: isHost ? "host" : this.defaultRole,
    };
    this.users.set(socketId, user);
    this.touch();
    return { ok: true, user };
  }

  // Forget a disconnected socket and any request it had pending.
  remove(socketId) {
    const user = this.users.get(socketId);
    this.users.delete(socketId);
    this.requests.delete(socketId);
    return user;
  }

  // The single question every write goes through.
  canEdit(socketId) {
    const role = this.users.get(socketId)?.role;
    return role === "host" || role === "editor";
  }

  /** Host changes another user's role between editor and viewer. */
  setRole(actorId, targetId, role) {
    if (this.users.get(actorId)?.role !== "host") return { ok: false, error: "not-host" };
    const target = this.users.get(targetId);
    if (!target) return { ok: false, error: "no-user" };
    if (target.role === "host") return { ok: false, error: "target-is-host" };
    if (!JOINABLE_ROLES.includes(role)) return { ok: false, error: "bad-role" };
    target.role = role;
    this.requests.delete(targetId);
    return { ok: true, target };
  }

  /** Move the host role to another connected user. Returns a new host token, to be stored by that browser. */
  transferHost(actorId, targetId) {
    const actor = this.users.get(actorId);
    const target = this.users.get(targetId);
    if (actor?.role !== "host") return { ok: false, error: "not-host" };
    if (!target || target.id === actor.id) return { ok: false, error: "no-user" };
    const token = newToken();
    this.hostHash = sha(token);
    for (const u of this.users.values()) if (u.role === "host") u.role = "editor";
    target.role = "host";
    this.requests.delete(targetId);
    return { ok: true, target, token };
  }

  // Host only: default role for new people, the lock, and the passcode.
  updateSettings(actorId, { defaultRole, locked, passcode }) {
    if (this.users.get(actorId)?.role !== "host") return { ok: false, error: "not-host" };
    if (defaultRole !== undefined) {
      if (!JOINABLE_ROLES.includes(defaultRole)) return { ok: false, error: "bad-role" };
      this.defaultRole = defaultRole;
    }
    if (locked !== undefined) this.locked = Boolean(locked);
    if (passcode !== undefined) this.passHash = passcode ? sha(String(passcode).slice(0, 64)) : null;
    return { ok: true };
  }

  // Host only: remove somebody and keep their browser out for this session.
  kick(actorId, targetId) {
    if (this.users.get(actorId)?.role !== "host") return { ok: false, error: "not-host" };
    const target = this.users.get(targetId);
    if (!target || target.role === "host") return { ok: false, error: "no-user" };
    this.banned.add(target.clientId);
    return { ok: true, target };
  }

  // A viewer asks for a pen, at most once every fifteen seconds.
  requestEdit(socketId) {
    const user = this.users.get(socketId);
    if (user?.role !== "viewer") return { ok: false, error: "not-viewer" };
    const last = this.requests.get(socketId) ?? 0;
    if (Date.now() - last < 15_000) return { ok: false, error: "too-soon" };
    this.requests.set(socketId, Date.now());
    return { ok: true, user };
  }

  // Store a chat message and hand back the version everyone should see.
  addChat(socketId, text) {
    const user = this.users.get(socketId);
    const body = String(text ?? "").trim().slice(0, LIMITS.message);
    if (!user || !body) return null;
    const message = { id: newToken().slice(0, 8), by: user.name, color: user.color, role: user.role, text: body, ts: Date.now() };
    this.chat.push(message);
    if (this.chat.length > LIMITS.chat) this.chat.shift();
    return message;
  }

  /** Apply a Yjs update from an editor. Viewers are refused here, not just in the UI. */
  applyUpdate(socketId, update) {
    if (!this.canEdit(socketId)) return { ok: false, error: "read-only" };
    if (!(update instanceof Uint8Array) || update.byteLength === 0 || update.byteLength > LIMITS.update) return { ok: false, error: "bad-update" };
    try { Y.applyUpdate(this.doc, update, socketId); } catch { return { ok: false, error: "bad-update" }; }
    this.touch();
    return { ok: true };
  }

  // Snapshot every file in the project under a name.
  saveCheckpoint(socketId, name) {
    const user = this.users.get(socketId);
    if (!this.canEdit(socketId)) return { ok: false, error: "read-only" };
    const files = this.files();
    if (!files.length) return { ok: false, error: "empty" };
    const cp = {
      id: newToken().slice(0, 8),
      name: String(name ?? "").trim().slice(0, 40) || `Checkpoint ${this.checkpoints.length + 1}`,
      by: user.name,
      ts: Date.now(),
      files,
    };
    this.checkpoints.unshift(cp);
    if (this.checkpoints.length > LIMITS.checkpoints) this.checkpoints.pop();
    return { ok: true, checkpoint: cp };
  }

  /** Replace every file with a checkpoint's files. Returns the Yjs update to broadcast to everyone. */
  restoreCheckpoint(socketId, id) {
    if (!this.canEdit(socketId)) return { ok: false, error: "read-only" };
    const cp = this.checkpoints.find((c) => c.id === id);
    if (!cp) return { ok: false, error: "no-checkpoint" };
    const updates = [];
    // Collect the updates the transaction produces so they can be broadcast as one.
    const capture = (u) => updates.push(u);
    this.doc.on("update", capture);
    this.doc.transact(() => {
      const map = this.doc.getMap("files");
      const order = this.doc.getArray("order");
      for (const key of [...map.keys()]) map.delete(key);
      order.delete(0, order.length);
      for (const f of cp.files) {
        map.set(f.name, new Y.Text(f.code));
        order.push([f.name]);
      }
    }, "server");
    this.doc.off("update", capture);
    this.touch();
    return { ok: true, update: Y.mergeUpdates(updates), checkpoint: cp };
  }

  // Checkpoint list for the side panel: names and counts, not the code.
  publicCheckpoints() {
    return this.checkpoints.map(({ id, name, by, ts, files }) => ({ id, name, by, ts, count: files.length, names: files.map((f) => f.name).slice(0, 6) }));
  }
}

export class RoomStore {
  // Holds every live room and drops the ones nobody is using.
  constructor({ maxRooms = 500, idleMs = 30 * 60 * 1000 } = {}) {
    this.rooms = new Map();
    this.maxRooms = maxRooms;
    this.idleMs = idleMs;
  }
  // An existing room, or undefined.
  get(id) { return this.rooms.get(id); }
  // The room, creating it if there is space once idle rooms are swept.
  getOrCreate(id) {
    let room = this.rooms.get(id);
    if (!room) {
      if (this.rooms.size >= this.maxRooms) this.sweep(0);
      if (this.rooms.size >= this.maxRooms) return null;
      room = new Room(id);
      this.rooms.set(id, room);
    }
    return room;
  }
  /** Drop empty rooms idle for longer than `idleMs`. */
  sweep(idleMs = this.idleMs) {
    for (const [id, room] of this.rooms) {
      if (room.users.size === 0 && Date.now() - room.touched >= idleMs) { room.doc.destroy(); this.rooms.delete(id); }
    }
  }
}
