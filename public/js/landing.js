import { LANGUAGES, LANGUAGE_IDS, GROUPS } from "./languages.js";
import { langTile } from "./ui.js";
import { THEMES, mountThemePicker, setTheme, currentTheme } from "./themes.js";
import { createDemo } from "./demo.js";

const $ = (id) => document.getElementById(id);
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
// Small DOM helper: tag, class, text.
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
// A Phosphor icon element.
const icon = (name) => el("i", `ph ${name}`);

// Browsers that can drive animations from the scroll position do the work in CSS.
// The rest get an IntersectionObserver that adds a class once.
const scrollDriven = CSS.supports("animation-timeline: view()") && !reduce;
if (scrollDriven) document.documentElement.classList.add("scrolldriven");

document.querySelectorAll("[data-count]").forEach((n) => (n.textContent = String(LANGUAGE_IDS.length)));
mountThemePicker($("themes"));
// Narrow screens get one button that steps through the themes instead of the swatch row.
$("theme-cycle").addEventListener("click", () => {
  const ids = THEMES.map((t) => t.id);
  setTheme(ids[(ids.indexOf(currentTheme()) + 1) % ids.length]);
});

/* ── Sample room in the hero ────────────────────────────────────── */
createDemo({
  root: $("demo"), tabs: $("demo-tabs"), code: $("demo-code"), crew: $("demo-crew"),
  note: $("demo-note"), controls: $("demo-controls"), state: $("demo-state"),
});

/* ── Who can do what ────────────────────────────────────────────── */
const YES = ["yes", "ph-check", "Yes"];
const NO = ["no", "ph-x", "No"];
const NA = ["no", "ph-minus", "Not applicable"];
const ASK = ["ask", "ph-hand-waving", "Can ask the host"];
const ROWS = [
  ["Edit, rename and delete files", YES, YES, NO],
  ["Run the project for yourself", YES, YES, YES],
  ["Show the output to the room", YES, YES, NO],
  ["Send chat messages", YES, YES, YES],
  ["Save and restore checkpoints", YES, YES, NO],
  ["Ask for a pen", NA, NA, ASK],
  ["Change somebody else's role", YES, NO, NO],
  ["Set the default role, lock, passcode", YES, NO, NO],
  ["Remove somebody from the room", YES, NO, NO],
  ["Hand the host role to somebody else", YES, NO, NO],
];
for (const [action, ...cells] of ROWS) {
  const tr = el("tr");
  const th = el("th", "", action);
  th.scope = "row";
  tr.append(th);
  for (const [cls, ico, label] of cells) {
    const td = el("td", cls);
    td.append(icon(ico), el("span", "sr-only", label));
    tr.append(td);
  }
  $("matrix-body").append(tr);
}

/* ── Example project ────────────────────────────────────────────── */
const EXAMPLE = {
  "main.py": 'from shapes import area\n\nprint("area:", area(3, 4))',
  "shapes.py": "def area(w, h):\n    return w * h",
};
const KEYWORDS = /^(from|import|def|return|print)$/;
// Colour the example project the same way the hero card does.
function highlight(source) {
  const out = document.createDocumentFragment();
  for (const line of source.split("\n")) {
    for (const piece of line.split(/("[^"]*")/)) {
      if (!piece) continue;
      if (piece.startsWith('"')) { out.append(el("span", "st", piece)); continue; }
      for (const word of piece.split(/(\w+)/)) {
        if (!word) continue;
        out.append(KEYWORDS.test(word) ? el("span", "kw", word) : document.createTextNode(word));
      }
    }
    out.append(document.createTextNode("\n"));
  }
  return out;
}
// Switch the example between its two files.
function showExample(name) {
  $("mini-tabs").querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.name === name)));
  $("mini-code").replaceChildren(highlight(EXAMPLE[name]));
}
for (const name of Object.keys(EXAMPLE)) {
  const b = el("button", "", name);
  b.type = "button";
  b.dataset.name = name;
  b.setAttribute("role", "tab");
  b.addEventListener("click", () => showExample(name));
  $("mini-tabs").append(b);
}
showExample("main.py");
$("mini-out").textContent = "python main.py  ->  area: 12";

/* ── Language wall ──────────────────────────────────────────────── */
const cards = LANGUAGE_IDS.map((id) => {
  const l = LANGUAGES[id];
  const local = l.runtime !== "remote";
  const card = el("div", `lang${local ? " local" : ""}`);
  card.dataset.group = l.group;
  card.append(langTile(l, 24), el("span", "", l.label), el("small", "", local ? "Local" : "Remote"));
  card.title = local ? `${l.label} runs inside your browser` : `${l.label} is built by a public compiler service`;
  $("wall").append(card);
  return card;
});
let filter = "All";
// Show only the languages in the chosen group.
const applyFilter = () => cards.forEach((c) => (c.hidden = filter !== "All" && c.dataset.group !== filter));
for (const name of ["All", ...GROUPS]) {
  const b = el("button", "", name === "In your browser" ? "In the browser" : name);
  b.type = "button";
  b.setAttribute("aria-pressed", String(name === filter));
  b.addEventListener("click", () => {
    filter = name;
    $("filters").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    applyFilter();
  });
  $("filters").append(b);
}

/* ── The people who made it ─────────────────────────────────────── */
const TEAM = [
  { name: "Mayank Karki", color: "#ffb3a0" },
  { name: "Nitin Kandpal", color: "#9ceccd" },
  { name: "Swarit Kumar", color: "#b9ccff" },
];
for (const person of TEAM) {
  const card = el("article", "crew-card reveal");
  const avatar = el("div", "avatar", person.name[0]);
  avatar.style.background = person.color;
  card.append(avatar, el("h3", "", person.name), el("p", "", "Team Utopians"));
  $("crew-cards").append(card);
}

/* ── Headings that arrive a word at a time ──────────────────────── */
for (const heading of document.querySelectorAll(".rise")) {
  const pieces = [...heading.childNodes];
  heading.replaceChildren();
  let n = 0;
  for (const piece of pieces) {
    if (piece.nodeType !== Node.TEXT_NODE) {
      if (piece.tagName === "BR") heading.append(piece);
      else {
        const wrap = el("span", "w");
        wrap.style.setProperty("--n", n++);
        const inner = el("span");
        inner.append(piece);
        wrap.append(inner);
        heading.append(wrap, document.createTextNode(" "));
      }
      continue;
    }
    for (const word of piece.textContent.split(/\s+/).filter(Boolean)) {
      const wrap = el("span", "w");
      wrap.style.setProperty("--n", n++);
      wrap.append(el("span", "", word));
      heading.append(wrap, document.createTextNode(" "));
    }
  }
}

/* ── Reveal, sticky nav, scroll progress ────────────────────────── */
const seen = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); seen.unobserve(e.target); }
}, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });

document.querySelectorAll(".rise").forEach((n) => (reduce ? n.classList.add("in") : seen.observe(n)));
if (!scrollDriven) {
  document.querySelectorAll(".reveal").forEach((n, i) => {
    n.style.transitionDelay = `${(i % 4) * 60}ms`;
    if (reduce) n.classList.add("in"); else seen.observe(n);
  });
  // Scroll progress without a scroll listener: a tiny rAF loop only while the page is moving.
  const bar = document.querySelector(".scroll-bar i");
  let ticking = false;
  // Mark the swatch that matches the active theme.
  const paint = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.width = `${max > 0 ? Math.min(100, (scrollY / max) * 100) : 0}%`;
    ticking = false;
  };
  addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(paint); } }, { passive: true });
  paint();
}

const sentinel = el("div");
sentinel.style.cssText = "position:absolute;top:0;height:6px;width:1px";
document.body.prepend(sentinel);
new IntersectionObserver(([e]) => $("nav").classList.toggle("stuck", !e.isIntersecting)).observe(sentinel);

/* ── How it works: the card keeps up with the steps ─────────────── */
const scenes = [...document.querySelectorAll(".how-scene")];
const steps = [...document.querySelectorAll(".how-step")];
let activeStep = -1;
// Light up one step and bring its matching card to the front.
function showStep(i) {
  if (i === activeStep) return;
  activeStep = i;
  steps.forEach((s, n) => s.classList.toggle("active", n === i));
  scenes.forEach((s, n) => s.classList.toggle("on", n === i));
}
showStep(0);
const stepWatcher = new IntersectionObserver((entries) => {
  const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
  if (visible) showStep(Number(visible.target.dataset.step));
}, { rootMargin: "-42% 0px -42% 0px", threshold: [0, 0.25, 0.6] });
steps.forEach((s) => stepWatcher.observe(s));

/* ── Start and join ─────────────────────────────────────────────── */
const rand = (n, alphabet) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => alphabet[b % alphabet.length]).join("");
// Mint a room id and a host token, then go there.
function startRoom() {
  const s = rand(12, "abcdefghjkmnpqrstuvwxyz23456789");
  const id = `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
  // Whoever holds this token hosts that room. It stays in this browser; the server keeps only a hash.
  try { localStorage.setItem(`codesync:host:${id}`, rand(28, "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789")); } catch { /* storage unavailable */ }
  location.href = `/r/${id}`;
}
document.querySelectorAll("[data-start]").forEach((b) => b.addEventListener("click", startRoom));

const dialog = $("join-dialog");
$("join-open").addEventListener("click", () => { $("join-err").textContent = ""; dialog.showModal(); $("join-code").focus(); });
dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
$("join-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const id = $("join-code").value.trim().split("#")[0].split("/r/").pop().split("?")[0].replace(/\/$/, "").toLowerCase();
  if (!/^[a-z0-9-]{4,40}$/.test(id)) {
    $("join-err").textContent = "That does not look like a room code or an invite link.";
    dialog.showModal();
    return;
  }
  location.href = `/r/${id}`;
});
