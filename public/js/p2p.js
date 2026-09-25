// Fallback for sites deployed without a room server: peers connect directly over WebRTC and find each
// other through public Nostr relays (Trystero). Same interface as connectRoom() in net.js, but without
// what needs a trusted server: roles, passcodes, host controls and checkpoints.
import { joinRoom, selfId } from "https://esm.sh/trystero@0.25.4";
import { Y } from "./net.js";

const REMOTE = "remote";
const PALETTE = ["#f28b82", "#7bc47f", "#7fb7f5", "#f6c453", "#c3a6f2", "#f2a1cf", "#f4a261", "#9bd16b"];
// Give every peer a stable colour from their id.
const colorFor = (id) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };
// Trim a name to something displayable.
const cleanName = (s) => String(s ?? "").trim().slice(0, 20) || "Guest";
// Anything that needs a trusted server simply is not available here.
const unsupported = async () => ({ ok: false, error: "p2p" });

// Join a room without a server: peers find each other and sync directly.
export function connectPeers({ roomId, doc, getIdentity, handlers }) {
  const room = joinRoom({ appId: "codesync-collab-v2" }, roomId);
  const syncAction = room.makeAction("sync");
  const helloAction = room.makeAction("hello");
  const awareAction = room.makeAction("aware");
  const chatAction = room.makeAction("chat");
  const runAction = room.makeAction("run");

  // How this browser describes itself to peers.
  const self = () => ({ id: selfId, name: cleanName(getIdentity().name), color: colorFor(selfId), role: "editor" });
  const peers = new Map();
  // Rebuild the people list from the peers we know about.
  const presence = () => handlers.onPresence?.([self(), ...peers.values()]);
  let lastSel = null;

  doc.on("update", (update, origin) => { if (origin !== REMOTE && peers.size) syncAction.send(update); });
  syncAction.onMessage = (data) => { try { Y.applyUpdate(doc, new Uint8Array(data), REMOTE); } catch { /* ignore malformed update */ } };
  helloAction.onMessage = (data, { peerId }) => {
    peers.set(peerId, { id: peerId, name: cleanName(data?.name), color: colorFor(peerId), role: "editor" });
    presence();
  };
  awareAction.onMessage = (sel, { peerId }) => handlers.onAwareness?.(peerId, sel && typeof sel.anchor === "number" ? sel : null);
  chatAction.onMessage = (m, { peerId }) => {
    const p = peers.get(peerId);
    handlers.onChat?.({ by: p?.name ?? "Guest", color: p?.color ?? "#7fb7f5", role: "editor", text: String(m?.text ?? "").slice(0, 500), ts: Date.now() });
  };
  runAction.onMessage = (r, { peerId }) => handlers.onRun?.({ ...r, by: peers.get(peerId)?.name ?? "Guest" });

  room.onPeerJoin = (peerId) => {
    // Full-state exchange in both directions is idempotent and fine for source-file-sized documents.
    syncAction.send(Y.encodeStateAsUpdate(doc), { target: peerId });
    helloAction.send({ name: self().name }, { target: peerId });
    if (lastSel) awareAction.send(lastSel, { target: peerId });
  };
  room.onPeerLeave = (peerId) => { peers.delete(peerId); handlers.onAwareness?.(peerId, null); presence(); };

  queueMicrotask(() => {
    handlers.onStatus?.("connected");
    handlers.onJoined?.({ ok: true, p2p: true, you: self(), users: [self()], settings: { defaultRole: "editor", locked: false, hasPasscode: false }, chat: [], checkpoints: [] });
  });

  return {
    p2p: true,
    // Nothing to join: the connection is the swarm itself.
    join() {},
    close: () => room.leave(),
    // Trystero reconnects on its own.
    retry() {},
    get connected() { return true; },
    sendAwareness: (sel) => { lastSel = sel; if (peers.size) awareAction.send(sel); },
    sendChat: (text) => {
      const t = String(text).slice(0, 500);
      handlers.onChat?.({ by: self().name, color: self().color, role: "editor", text: t, ts: Date.now() });
      if (peers.size) chatAction.send({ text: t });
    },
    sendRun: (result) => { if (peers.size) runAction.send({ lang: result.lang, ok: result.ok, summary: result.summary, segs: (result.segs || []).slice(0, 400), ts: Date.now() }); },
    setRole: unsupported, requestEdit: unsupported, respond: unsupported, settings: unsupported,
    kick: unsupported, transfer: unsupported, saveCheckpoint: unsupported, restoreCheckpoint: unsupported,
  };
}
