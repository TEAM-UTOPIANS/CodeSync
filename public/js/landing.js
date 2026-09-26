// The front page: theme chips, the language wall, the room buttons, and the scroll work.
import { LANGUAGES, LANGUAGE_IDS, GROUPS, byGroup } from "./languages.js";
import { mountThemePicker } from "./themes.js";
import { toast, langTile } from "./ui.js";
import { createDemo } from "./demo.js";

const $ = (id) => document.getElementById(id);

/* ── Opening a room ───────────────────────────────────────────── */
// Room codes people can read out loud over a call.
const WORDS = [
  "amber", "anvil", "beacon", "cinder", "compass", "delta", "ember", "falcon", "gravel", "harbor",
  "indigo", "jetty", "kernel", "lantern", "meridian", "nimbus", "onyx", "pixel", "quartz", "ripple",
  "signal", "tundra", "umbra", "vector", "willow", "xenon", "yonder", "zephyr",
];
// A fresh room code: two words and two digits, which the server accepts as an id.
const newRoomId = () => {
  const pick = () => WORDS[Math.floor(Math.random() * WORDS.length)];
  let a = pick(), b = pick();
  while (b === a) b = pick();
  return `${a}-${b}-${10 + Math.floor(Math.random() * 90)}`;
};
// Send this browser into a brand new room.
const openRoom = () => { location.href = `/r/${newRoomId()}`; };
for (const id of ["start-top", "start-hero", "start-slab"]) $(id)?.addEventListener("click", openRoom);

// Joining by code: accept a bare code or a whole pasted invite link.
$("join-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const raw = $("join-id").value.trim();
  const code = (raw.match(/\/r\/([a-z0-9-]{4,40})/i)?.[1] ?? raw).toLowerCase();
  if (!/^[a-z0-9-]{4,40}$/.test(code)) { toast("That does not look like a room code", "ph-warning"); return; }
  location.href = `/r/${code}`;
});

/* ── Ink chips and the date line ──────────────────────────────── */
mountThemePicker($("inks"));
$("issue-date").textContent = new Date().toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();

/* ── The language index line ──────────────────────────────────── */
// Every language, printed once across the black strip, in the order the editor lists them.
$("ticker").replaceChildren(...LANGUAGE_IDS.map((id) => {
  const s = document.createElement("span");
  s.textContent = LANGUAGES[id].label;
  return s;
}));

/* ── The language wall ────────────────────────────────────────── */
const wall = $("wall");
const filters = $("filters");
let group = "All";

// Where a language runs, said in two words for the corner of its cell.
const where = (l) => (l.runtime === "browser" ? "Local" : l.runtime === "preview" ? "Preview" : "Remote");

// Redraw the wall for whichever group is selected.
function drawWall() {
  const entries = group === "All" ? LANGUAGE_IDS.map((id) => LANGUAGES[id]) : (byGroup().find(([g]) => g === group)?.[1] ?? []);
  wall.replaceChildren(...entries.map((l) => {
    const cell = document.createElement("a");
    cell.className = "lang";
    cell.href = "/play";
    cell.append(langTile(l, 20), Object.assign(document.createElement("span"), { textContent: l.label }));
    cell.append(Object.assign(document.createElement("small"), { textContent: where(l) }));
    return cell;
  }));
}

for (const name of ["All", ...GROUPS]) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = name;
  b.setAttribute("aria-pressed", String(name === group));
  b.addEventListener("click", () => {
    group = name;
    filters.querySelectorAll("button").forEach((o) => o.setAttribute("aria-pressed", String(o.textContent === group)));
    drawWall();
  });
  filters.append(b);
}
drawWall();

/* ── The sample room ──────────────────────────────────────────── */
createDemo({
  tabs: $("demo-tabs"),
  code: $("demo-code"),
  note: $("demo-note"),
  stamp: $("demo-role"),
  roleBtn: $("demo-role-btn"),
  replayBtn: $("demo-replay"),
});

/* ── Scroll work ──────────────────────────────────────────────── */
// Sections rise into place once, the first time they are reached.
const reveal = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); reveal.unobserve(e.target); }
}, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
document.querySelectorAll(".reveal").forEach((n) => reveal.observe(n));

// The headline settles from noise into words, the way an old terminal draws a line of text.
const GLYPHS = "!<>-_\\/[]{}—=+*^?#________";
function scramble(node, done) {
  const target = node.textContent;
  let frame = 0;
  const ends = [...target].map((_, i) => 6 + i * 2 + Math.floor(Math.random() * 8));
  // One animation frame of the reveal: settled characters stay, the rest flicker.
  const tick = () => {
    node.textContent = [...target].map((ch, i) => (frame >= ends[i] || ch === " " ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)])).join("");
    if (frame++ > Math.max(...ends)) { node.textContent = target; done?.(); return; }
    requestAnimationFrame(tick);
  };
  tick();
}
if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const lines = [...$("headline").querySelectorAll(".ln")];
  scramble(lines[0], () => scramble(lines[1]));
}

// The masthead keeps a hard rule under it only once the page has moved.
const masthead = document.querySelector(".masthead");
const onScroll = () => masthead.style.boxShadow = window.scrollY > 8 ? "0 3px 0 var(--rule)" : "none";
addEventListener("scroll", onScroll, { passive: true });
onScroll();
