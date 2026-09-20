import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { io as connect } from "socket.io-client";
import * as Y from "yjs";
import { createApp } from "../index.js";
import { Room, cleanName, cleanRoomId } from "../rooms.js";

let app, url;
const clients = [];

before(async () => {
  app = createApp({ corsOrigin: "*" });
  await new Promise((resolve) => app.http.listen(0, resolve));
  url = `http://localhost:${app.http.address().port}`;
});
after(async () => {
  for (const c of clients) c.close();
  await app.close();
  app.http.close();
});

const emit = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));
const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const roomName = () => `room-${Date.now().toString(36)}-${n++}`;

async function join(roomId, { name = "User", hostToken, passcode, clientId = `c-${Math.random()}` } = {}) {
  const socket = connect(url, { transports: ["websocket"], forceNew: true });
  clients.push(socket);
  await once(socket, "connect");
  const res = await emit(socket, "join", { roomId, name, hostToken, passcode, clientId });
  return { socket, res, clientId };
}

const b64 = (u8) => Buffer.from(u8).toString("base64");
const unb64 = (s) => new Uint8Array(Buffer.from(s, "base64"));
const typeInto = (doc, text) => { let captured; doc.once("update", (u) => { captured = u; }); doc.getText("code").insert(0, text); return b64(captured); };

test("helpers sanitize input", () => {
  assert.equal(cleanName("  <b>Mira</b>  "), "bMira/b");
  assert.equal(cleanName(""), "Guest");
  assert.equal(cleanRoomId("Abcd-1234"), "abcd-1234");
  assert.equal(cleanRoomId("../x"), null);
});

test("first joiner with a host token becomes host; others get the default role", async () => {
  const id = roomName();
  const host = await join(id, { name: "Mira", hostToken: "secret-host-token" });
  assert.equal(host.res.ok, true);
  assert.equal(host.res.you.role, "host");
  const guest = await join(id, { name: "Tomas" });
  assert.equal(guest.res.you.role, "editor");
  assert.equal(guest.res.users.length, 2);
  // A wrong host token is just a guest.
  const fake = await join(id, { name: "Fake", hostToken: "not-the-token" });
  assert.equal(fake.res.you.role, "editor");
  // The real token still works from another connection.
  const again = await join(id, { name: "Mira 2", hostToken: "secret-host-token" });
  assert.equal(again.res.you.role, "host");
});

test("editors sync documents to everyone else", async () => {
  const id = roomName();
  const a = await join(id, { name: "A", hostToken: "t1" });
  const b = await join(id, { name: "B" });
  const docA = new Y.Doc();
  const update = typeInto(docA, "print('hi')");
  const received = once(b.socket, "doc:update");
  assert.deepEqual(await emit(a.socket, "doc:update", update), { ok: true });
  const docB = new Y.Doc();
  Y.applyUpdate(docB, unb64(await received));
  assert.equal(docB.getText("code").toString(), "print('hi')");
  // A late joiner gets the state in the join reply.
  const late = await join(id, { name: "C" });
  const docC = new Y.Doc();
  Y.applyUpdate(docC, unb64(late.res.doc));
  assert.equal(docC.getText("code").toString(), "print('hi')");
});

test("viewers cannot change the document, even by bypassing the UI", async () => {
  const id = roomName();
  const host = await join(id, { name: "Host", hostToken: "t2" });
  await emit(host.socket, "room:settings", { defaultRole: "viewer" });
  const viewer = await join(id, { name: "Viewer" });
  assert.equal(viewer.res.you.role, "viewer");
  const notice = once(viewer.socket, "notice");
  const res = await emit(viewer.socket, "doc:update", typeInto(new Y.Doc(), "hacked"));
  assert.deepEqual(res, { ok: false, error: "read-only" });
  assert.equal((await notice).code, "read-only");
  assert.equal(app.store.get(id).text.toString(), "");
  // Nor can they save checkpoints or broadcast a run result.
  assert.equal((await emit(viewer.socket, "checkpoint:save", { name: "x" })).error, "read-only");
});

test("only the host can change roles; the change is enforced immediately", async () => {
  const id = roomName();
  const host = await join(id, { name: "Host", hostToken: "t3" });
  const ed = await join(id, { name: "Ed" });
  const other = await join(id, { name: "Other" });
  assert.equal((await emit(ed.socket, "role:set", { id: other.socket.id, role: "viewer" })).error, "not-host");
  const changed = once(other.socket, "role:changed");
  assert.deepEqual(await emit(host.socket, "role:set", { id: other.socket.id, role: "viewer" }), { ok: true });
  assert.deepEqual(await changed, { role: "viewer" });
  assert.equal((await emit(other.socket, "doc:update", typeInto(new Y.Doc(), "x"))).error, "read-only");
  assert.equal((await emit(host.socket, "role:set", { id: host.socket.id, role: "viewer" })).error, "target-is-host");
});

test("viewer edit request: host approves and the viewer becomes an editor", async () => {
  const id = roomName();
  const host = await join(id, { name: "Host", hostToken: "t4" });
  await emit(host.socket, "room:settings", { defaultRole: "viewer" });
  const viewer = await join(id, { name: "Lena" });
  const asked = once(host.socket, "role:request");
  assert.deepEqual(await emit(viewer.socket, "role:request"), { ok: true });
  const request = await asked;
  assert.equal(request.name, "Lena");
  assert.equal((await emit(viewer.socket, "role:request")).error, "too-soon");
  const promoted = once(viewer.socket, "role:changed");
  await emit(host.socket, "role:respond", { id: request.id, approve: true });
  assert.deepEqual(await promoted, { role: "editor" });
  assert.deepEqual(await emit(viewer.socket, "doc:update", typeInto(new Y.Doc(), "now I can")), { ok: true });
});

test("kick removes and bans; lock and passcode gate new joiners", async () => {
  const id = roomName();
  const host = await join(id, { name: "Host", hostToken: "t5" });
  const troll = await join(id, { name: "Troll", clientId: "troll-1" });
  const kicked = once(troll.socket, "kicked");
  assert.deepEqual(await emit(host.socket, "user:kick", { id: troll.socket.id }), { ok: true });
  await kicked;
  assert.equal((await join(id, { name: "Troll", clientId: "troll-1" })).res.error, "removed");

  await emit(host.socket, "room:settings", { passcode: "open sesame" });
  assert.equal((await join(id, { name: "A" })).res.error, "passcode");
  assert.equal((await join(id, { name: "A", passcode: "nope" })).res.error, "passcode-wrong");
  assert.equal((await join(id, { name: "A", passcode: "open sesame" })).res.ok, true);

  await emit(host.socket, "room:settings", { passcode: "", locked: true });
  assert.equal((await join(id, { name: "B" })).res.error, "locked");
  assert.equal((await join(id, { name: "Host again", hostToken: "t5" })).res.you.role, "host");
});

test("host transfer moves control and issues a new token", async () => {
  const id = roomName();
  const host = await join(id, { name: "Host", hostToken: "old-token" });
  const next = await join(id, { name: "Next" });
  const token = once(next.socket, "host:token");
  assert.deepEqual(await emit(host.socket, "host:transfer", { id: next.socket.id }), { ok: true });
  const { token: newToken } = await token;
  assert.ok(newToken.length > 10);
  assert.equal((await emit(host.socket, "room:settings", { locked: true })).error, "not-host");
  assert.equal((await join(id, { name: "Old", hostToken: "old-token" })).res.you.role, "editor");
  assert.equal((await join(id, { name: "New", hostToken: newToken })).res.you.role, "host");
});

test("chat is stored and broadcast; checkpoints save and restore for everyone", async () => {
  const id = roomName();
  const a = await join(id, { name: "A", hostToken: "t6" });
  const b = await join(id, { name: "B" });
  const msg = once(b.socket, "chat:message");
  a.socket.emit("chat:send", "hello");
  assert.equal((await msg).text, "hello");
  assert.equal((await join(id, { name: "C" })).res.chat.length, 1);

  const doc = new Y.Doc();
  await emit(a.socket, "doc:update", typeInto(doc, "v1"));
  await emit(a.socket, "checkpoint:save", { name: "first" });
  const room = app.store.get(id);
  assert.equal(room.checkpoints[0].code, "v1");
  await emit(a.socket, "doc:update", (() => { let u; doc.once("update", (x) => { u = x; }); doc.getText("code").insert(0, "v2-"); return b64(u); })());
  assert.equal(room.text.toString(), "v2-v1");
  const restored = once(b.socket, "doc:update");
  assert.deepEqual(await emit(a.socket, "checkpoint:restore", { id: room.checkpoints[0].id }), { ok: true });
  const bDoc = new Y.Doc();
  Y.applyUpdate(bDoc, unb64(await restored));
  assert.equal(room.text.toString(), "v1");
});

test("oversized or malformed updates are rejected", async () => {
  const id = roomName();
  const a = await join(id, { name: "A", hostToken: "t7" });
  assert.equal((await emit(a.socket, "doc:update", b64(new Uint8Array(300 * 1024)))).error, "bad-update");
  assert.equal((await emit(a.socket, "doc:update", b64(new Uint8Array([1, 2, 3])))).error, "bad-update");
  assert.equal((await emit(a.socket, "doc:update", 42)).error, "bad-update");
});

test("presence updates when people leave and rooms are swept when idle", async () => {
  const id = roomName();
  const a = await join(id, { name: "A", hostToken: "t8" });
  const b = await join(id, { name: "B" });
  const left = new Promise((resolve) => a.socket.on("presence", (users) => { if (users.length === 1) resolve(users); }));
  b.socket.close();
  assert.equal((await left).length, 1);
  a.socket.close();
  await wait(100);
  app.store.sweep(0);
  assert.equal(app.store.get(id), undefined);
});

test("Room enforces the user cap and reports it", () => {
  const room = new Room("cap-test");
  for (let i = 0; i < 30; i++) assert.equal(room.admit({ socketId: `s${i}`, clientId: `c${i}`, name: "x" }).ok, true);
  assert.equal(room.admit({ socketId: "s31", clientId: "c31", name: "x" }).error, "full");
});
