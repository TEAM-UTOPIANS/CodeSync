// CodeSync room server. Relays Yjs updates over Socket.IO and enforces roles on the server.
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import * as Y from "yjs";
import { RoomStore, cleanRoomId } from "./rooms.js";

// Yjs updates travel as base64 strings. Binary attachments behave differently in Node and browsers,
// and the documents here are small, so the 33% overhead is a fair price for one simple wire format.
const encode = (bytes) => Buffer.from(bytes).toString("base64");
const decode = (b64) => (typeof b64 === "string" && b64.length < 400_000 ? new Uint8Array(Buffer.from(b64, "base64")) : null);

export function createApp({ corsOrigin = process.env.CORS_ORIGIN || "*", store = new RoomStore() } = {}) {
  const http = createServer((req, res) => {
    if (req.url === "/health" || req.url === "/") {
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ ok: true, service: "codesync", rooms: store.rooms.size }));
      return;
    }
    res.writeHead(404).end();
  });

  const io = new Server(http, {
    cors: { origin: corsOrigin === "*" ? true : corsOrigin.split(",").map((s) => s.trim()) },
    maxHttpBufferSize: 512 * 1024,
    pingInterval: 20_000,
    pingTimeout: 30_000,
  });

  const sweeper = setInterval(() => store.sweep(), 5 * 60 * 1000);
  sweeper.unref();

  io.on("connection", (socket) => {
    let room = null;
    const bucket = { tokens: 60, at: Date.now() };
    // Token bucket: 60 burst, 30 events per second sustained.
    const allow = () => {
      const now = Date.now();
      bucket.tokens = Math.min(60, bucket.tokens + ((now - bucket.at) / 1000) * 30);
      bucket.at = now;
      if (bucket.tokens < 1) return false;
      bucket.tokens -= 1;
      return true;
    };
    const guard = (fn) => (...args) => { if (room && allow()) fn(...args); };
    const ack = (cb, payload) => { if (typeof cb === "function") cb(payload); };
    const broadcastPresence = () => io.to(room.id).emit("presence", room.publicUsers());
    const notify = (code) => socket.emit("notice", { code });

    socket.on("join", (payload, cb) => {
      if (room) return ack(cb, { ok: false, error: "already-joined" });
      const roomId = cleanRoomId(payload?.roomId);
      const clientId = String(payload?.clientId ?? "").slice(0, 64);
      if (!roomId || !clientId) return ack(cb, { ok: false, error: "invalid" });
      const target = store.getOrCreate(roomId);
      if (!target) return ack(cb, { ok: false, error: "busy" });

      const result = target.admit({
        socketId: socket.id, clientId,
        name: payload.name,
        hostToken: typeof payload.hostToken === "string" ? payload.hostToken.slice(0, 64) : "",
        passcode: typeof payload.passcode === "string" ? payload.passcode.slice(0, 64) : "",
      });
      if (!result.ok) return ack(cb, { ok: false, error: result.error });

      room = target;
      socket.join(room.id);
      ack(cb, {
        ok: true,
        you: { id: socket.id, name: result.user.name, color: result.user.color, role: result.user.role },
        users: room.publicUsers(),
        settings: room.publicSettings(),
        chat: room.chat,
        checkpoints: room.publicCheckpoints(),
        doc: encode(Y.encodeStateAsUpdate(room.doc)),
      });
      broadcastPresence();
    });

    // Also used by a returning editor to push its full local state after a server restart.
    socket.on("doc:update", guard((b64, cb) => {
      const res = room.applyUpdate(socket.id, decode(b64));
      if (!res.ok) { if (res.error === "read-only") notify("read-only"); return ack(cb, res); }
      socket.to(room.id).emit("doc:update", b64);
      ack(cb, { ok: true });
    }));

    socket.on("awareness", guard((sel) => {
      if (sel !== null && !(typeof sel?.anchor === "number" && typeof sel?.head === "number")) return;
      socket.to(room.id).emit("awareness", { id: socket.id, sel: sel ? { anchor: sel.anchor, head: sel.head } : null });
    }));

    socket.on("chat:send", guard((text) => {
      const message = room.addChat(socket.id, text);
      if (message) io.to(room.id).emit("chat:message", message);
    }));

    socket.on("run:result", guard((result) => {
      if (!room.canEdit(socket.id) || typeof result !== "object" || result === null) return;
      const user = room.users.get(socket.id);
      const segs = Array.isArray(result.segs)
        ? result.segs.slice(0, 400).map(([t, c]) => [String(t).slice(0, 20_000), ["stdout", "stderr", "meta"].includes(c) ? c : "stdout"])
        : [];
      socket.to(room.id).emit("run:result", {
        by: user.name, lang: String(result.lang ?? "").slice(0, 20), ok: Boolean(result.ok),
        summary: String(result.summary ?? "").slice(0, 120), segs, ts: Date.now(),
      });
    }));

    socket.on("role:set", guard(({ id, role } = {}, cb) => {
      const res = room.setRole(socket.id, id, role);
      if (!res.ok) return ack(cb, res);
      io.to(id).emit("role:changed", { role });
      broadcastPresence();
      ack(cb, { ok: true });
    }));

    socket.on("role:request", guard((_, cb) => {
      const res = room.requestEdit(socket.id);
      if (!res.ok) return ack(cb, res);
      for (const hostId of room.hostIds()) io.to(hostId).emit("role:request", { id: socket.id, name: res.user.name });
      ack(cb, { ok: true });
    }));

    socket.on("role:respond", guard(({ id, approve } = {}, cb) => {
      if (room.users.get(socket.id)?.role !== "host") return ack(cb, { ok: false, error: "not-host" });
      if (!room.requests.has(id)) return ack(cb, { ok: false, error: "no-request" });
      if (!approve) { room.requests.delete(id); io.to(id).emit("role:denied"); return ack(cb, { ok: true }); }
      const res = room.setRole(socket.id, id, "editor");
      if (!res.ok) return ack(cb, res);
      io.to(id).emit("role:changed", { role: "editor" });
      broadcastPresence();
      ack(cb, { ok: true });
    }));

    socket.on("room:settings", guard((settings, cb) => {
      const res = room.updateSettings(socket.id, settings ?? {});
      if (!res.ok) return ack(cb, res);
      io.to(room.id).emit("room:settings", room.publicSettings());
      ack(cb, { ok: true });
    }));

    socket.on("user:kick", guard(({ id } = {}, cb) => {
      const res = room.kick(socket.id, id);
      if (!res.ok) return ack(cb, res);
      io.to(id).emit("kicked");
      io.sockets.sockets.get(id)?.disconnect(true);
      ack(cb, { ok: true });
    }));

    socket.on("host:transfer", guard(({ id } = {}, cb) => {
      const res = room.transferHost(socket.id, id);
      if (!res.ok) return ack(cb, res);
      io.to(id).emit("host:token", { token: res.token });
      io.to(id).emit("role:changed", { role: "host" });
      socket.emit("role:changed", { role: "editor" });
      broadcastPresence();
      ack(cb, { ok: true });
    }));

    socket.on("checkpoint:save", guard(({ name } = {}, cb) => {
      const res = room.saveCheckpoint(socket.id, name);
      if (!res.ok) return ack(cb, res);
      io.to(room.id).emit("checkpoints", room.publicCheckpoints());
      ack(cb, { ok: true });
    }));

    socket.on("checkpoint:restore", guard(({ id } = {}, cb) => {
      const res = room.restoreCheckpoint(socket.id, id);
      if (!res.ok) return ack(cb, res);
      io.to(room.id).emit("doc:update", encode(res.update));
      io.to(room.id).emit("notice", { code: "restored", name: res.checkpoint.name, by: room.users.get(socket.id)?.name });
      ack(cb, { ok: true });
    }));

    socket.on("disconnect", () => {
      if (!room) return;
      const left = room.remove(socket.id);
      if (left) { socket.to(room.id).emit("awareness", { id: socket.id, sel: null }); broadcastPresence(); }
      room.touch();
    });
  });

  return { http, io, store, close: () => new Promise((resolve) => { clearInterval(sweeper); io.close(() => resolve()); }) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT) || 3001;
  createApp().http.listen(port, () => console.log(`CodeSync room server listening on :${port}`));
}
