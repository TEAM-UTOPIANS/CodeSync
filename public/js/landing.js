import { LANGUAGES, LANGUAGE_IDS } from "./languages.js";
import { langTile } from "./ui.js";

const $ = (id) => document.getElementById(id);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

document.querySelectorAll("[data-lang-count]").forEach((el) => (el.textContent = String(LANGUAGE_IDS.length)));

/* ── Role panel: the hero demonstration ─────────────────────────── */
const people = [
  { name: "Mira", color: "#f28b82", role: "host" },
  { name: "Tomás", color: "#7bc47f", role: "editor" },
  { name: "Lena", color: "#7fb7f5", role: "viewer" },
];
const ROLE_ICON = { host: "ph-crown-simple", editor: "ph-pencil-simple", viewer: "ph-eye" };
let attempted = null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderLanes() {
  const lanes = $("lanes");
  lanes.replaceChildren();
  people.forEach((p, i) => {
    const row = el("div", `lane ${p.role}`);
    const who = el("div", "lane-who");
    const dot = el("span", "dot", p.name[0]);
    dot.style.background = p.color;
    who.append(dot, el("b", "", p.name));

    const track = el("div", "lane-track");
    const rail = el("span", `rail ${p.role}`);
    const station = el("span", "station");
    station.append(Object.assign(document.createElement("i"), { className: `ph ${p.role === "viewer" ? "ph-lock-simple" : "ph-file-code"}` }));
    track.append(rail, station);

    const roleBox = el("div", "lane-role");
    roleBox.append(el("span", `role-plate ${p.role}`, p.role));
    const lever = el("button", "lever");
    lever.setAttribute("aria-label", p.role === "host" ? `${p.name} is the host` : `Toggle ${p.name} between editor and viewer`);
    lever.setAttribute("aria-pressed", String(p.role === "viewer"));
    lever.style.setProperty("--c", p.role === "viewer" ? "var(--blue)" : p.role === "host" ? "var(--red)" : "var(--amber)");
    lever.append(document.createElement("span"));
    lever.disabled = p.role === "host";
    lever.title = p.role === "host" ? "The host always keeps the signals" : "Pull the lever";
    lever.addEventListener("click", () => {
      p.role = p.role === "viewer" ? "editor" : "viewer";
      attempted = null;
      setVerdict(`${p.name} is now ${p.role === "viewer" ? "a viewer" : "an editor"}. The server applies this at once.`, p.role === "viewer" ? "amber" : "green");
      renderLanes();
    });
    roleBox.append(lever);
    row.append(who, track, roleBox);
    lanes.append(row);
  });

  const tries = $("tries");
  tries.replaceChildren();
  people.filter((p) => p.role !== "host").forEach((p) => {
    const b = el("button", "btn sm", `Type as ${p.name}`);
    b.addEventListener("click", () => tryEdit(p));
    tries.append(b);
  });
}

function setVerdict(text, lamp) {
  const v = $("verdict");
  v.classList.toggle("blocked", lamp === "red");
  v.replaceChildren(el("i", `lamp ${lamp}`), el("span", "", text));
}

function tryEdit(p) {
  if (p.role === "viewer") {
    setVerdict(`Blocked by the server: ${p.name} is a viewer.`, "red");
  } else {
    attempted = p.name;
    $("doc-line").textContent = `print("hello, ${p.name.toLowerCase()}")`;
    setVerdict(`Accepted: ${p.name} is an editor.`, "green");
  }
}

renderLanes();

/* ── Language board ─────────────────────────────────────────────── */
const columns = [
  ["Your browser", ["In your browser"]],
  ["Compiled", ["Compiled", "JVM and .NET"]],
  ["Scripting and data", ["Scripting", "Functional and data"]],
];
const board = $("board");
for (const [title, groups] of columns) {
  const col = el("div", "board-col");
  col.append(el("h3", "", title));
  const ul = el("ul");
  for (const l of Object.values(LANGUAGES).filter((x) => groups.includes(x.group))) {
    const li = el("li");
    li.append(langTile(l, 24), document.createTextNode(l.label));
    ul.append(li);
  }
  col.append(ul);
  board.append(col);
}

/* ── Reveal, nav border ─────────────────────────────────────────── */
const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
}, { threshold: 0.12, rootMargin: "0px 0px -5% 0px" });
document.querySelectorAll(".reveal").forEach((n) => (reduceMotion ? n.classList.add("in") : io.observe(n)));

const sentinel = Object.assign(document.createElement("div"), {});
sentinel.style.cssText = "position:absolute;top:0;height:8px;width:1px";
document.body.prepend(sentinel);
new IntersectionObserver(([e]) => $("nav").classList.toggle("scrolled", !e.isIntersecting)).observe(sentinel);

/* ── Start, join, theme ─────────────────────────────────────────── */
const rand = (n, alphabet) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => alphabet[b % alphabet.length]).join("");
function createRoom() {
  const s = rand(12, "abcdefghjkmnpqrstuvwxyz23456789");
  const id = `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
  // Whoever holds this token is the host. It stays in this browser and only its hash reaches the server.
  try { localStorage.setItem(`codesync:host:${id}`, rand(28, "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789")); } catch { /* storage unavailable */ }
  location.href = `/r/${id}`;
}
document.querySelectorAll("[data-create]").forEach((b) => b.addEventListener("click", createRoom));

const dialog = $("join-dialog");
$("join-open").addEventListener("click", () => { $("join-error").textContent = ""; dialog.showModal(); $("join-code").focus(); });
dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
$("join-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const id = $("join-code").value.trim().split("#")[0].split("/r/").pop().split("?")[0].replace(/\/$/, "").toLowerCase();
  if (!/^[a-z0-9-]{4,40}$/.test(id)) { $("join-error").textContent = "That is not a room code or invite link."; dialog.showModal(); return; }
  location.href = `/r/${id}`;
});
$("theme").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("codesync:theme", next); } catch { /* storage unavailable */ }
});
