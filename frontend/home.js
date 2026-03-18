const $ = (id) => document.getElementById(id);

function toast(kind, message, ttl = 2600) {
  const el = document.createElement("div");
  el.className =
    "max-w-sm rounded-2xl px-3 py-2 text-sm border shadow-xl " +
    (document.body.classList.contains("dark")
      ? "bg-white/10 border-white/10 text-slate-100"
      : "bg-white/80 border-black/10 text-slate-950");
  el.textContent = message;
  $("toasts").appendChild(el);
  setTimeout(() => el.remove(), ttl);
}

function setTheme(next) {
  document.body.classList.toggle("dark", next === "dark");
  document.body.classList.toggle("bg-slate-950", next === "dark");
  document.body.classList.toggle("text-slate-100", next === "dark");
  document.body.classList.toggle("bg-slate-50", next !== "dark");
  document.body.classList.toggle("text-slate-950", next !== "dark");
  document.body.classList.toggle("light", next !== "dark");
  localStorage.setItem("codesync:theme", next);
}

function pickTheme() {
  return localStorage.getItem("codesync:theme") || "dark";
}

function randomName() {
  const adj = ["Swift", "Curious", "Brave", "Neon", "Quantum", "Silent", "Electric", "Pixel", "Cosmic", "Clever"];
  const noun = ["Tiger", "Falcon", "Otter", "Panda", "Koala", "Wolf", "Eagle", "Fox", "Turtle", "Dolphin"];
  const a = adj[Math.floor(Math.random() * adj.length)];
  const n = noun[Math.floor(Math.random() * noun.length)];
  const num = Math.floor(10 + Math.random() * 89);
  return `${a}${n}${num}`;
}

function persistProfile() {
  const p = {
    name: $("homeName").value.trim(),
    role: $("homeRole").value,
  };
  localStorage.setItem("codesync:profile", JSON.stringify(p));
}

function loadProfile() {
  try {
    const raw = localStorage.getItem("codesync:profile");
    if (!raw) return;
    const p = JSON.parse(raw);
    if (p.name) $("homeName").value = p.name;
    if (p.role) $("homeRole").value = p.role;
  } catch {
    // ignore
  }
}

function toRoomUrl(roomId) {
  const name = encodeURIComponent($("homeName").value.trim() || "Anonymous");
  const role = encodeURIComponent($("homeRole").value || "editor");
  return `/room/${encodeURIComponent(roomId)}?name=${name}&role=${role}`;
}

async function createRoom() {
  const name = $("homeName").value.trim();
  if (!name) {
    $("homeName").value = randomName();
  }
  persistProfile();
  try {
    const res = await fetch("/api/rooms", { method: "POST" });
    const data = await res.json();
    if (!data.roomId) throw new Error("Failed to create room");
    window.location.href = toRoomUrl(data.roomId);
  } catch (e) {
    toast("error", String(e));
  }
}

function joinRoom() {
  const rid = $("homeRoom").value.trim();
  if (!rid) return toast("error", "Enter a room id");
  const name = $("homeName").value.trim();
  if (!name) $("homeName").value = randomName();
  persistProfile();
  window.location.href = toRoomUrl(rid);
}

function boot() {
  setTheme(pickTheme());
  loadProfile();
  if (!$("homeName").value) $("homeName").value = randomName();

  $("randomNameBtn").onclick = () => {
    $("homeName").value = randomName();
    persistProfile();
  };
  $("createRoomBtn").onclick = createRoom;
  $("joinRoomBtn").onclick = joinRoom;
  $("homeRoom").addEventListener("keydown", (e) => {
    if (e.key === "Enter") joinRoom();
  });
  $("themeBtn").onclick = () => setTheme(document.body.classList.contains("dark") ? "light" : "dark");
}

boot();

