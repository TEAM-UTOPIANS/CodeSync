// The sample room in Fig. 1: a scripted re-enactment of two people editing one file, with the
// third one refused. Nothing here talks to the network; it is a drawing that moves.

const FILES = {
  "greet.py": [
    "from util import shout",
    "",
    "def greet(name):",
    "",
    "",
    "greet(input() or \"world\")",
  ],
  "util.py": [
    "def shout(text):",
    "    return text.upper() + \"!\"",
  ],
};

// One beat of the story: who is typing, into which file and line, and what the caption says.
const SCRIPT = [
  { note: "Mayank opened the room, so Mayank is the host. The host always has the pen.", wait: 900 },
  { who: "Mayank", file: "greet.py", line: 3, text: "    print(shout(f\"hello {name}\"))", note: "The host types. Every keystroke is a Yjs update on the wire." },
  { note: "Nitin joins from a phone. New people arrive as editors unless the host says otherwise.", wait: 1100 },
  { who: "Nitin", file: "util.py", line: 2, text: "", note: "Nitin opens the other file. Twelve files live in the same document." },
  { who: "Nitin", file: "util.py", line: 2, text: "    # louder", note: "Two people, two files, one document. Neither edit waits for the other." },
  { who: "Swarit", file: "greet.py", line: 4, text: "    # can I?", blocked: true, note: "Swarit is a viewer. The server refuses the update before it reaches the document." },
  { note: "Swarit asks for the pen. The host sees the request in the people panel.", wait: 1200 },
  { who: "Swarit", file: "greet.py", line: 4, text: "    return name", note: "Now an editor. Same keystrokes, and this time the server keeps them." },
  { note: "Run it, and the terminal asks for a name in the same pane it prints to.", wait: 1400 },
];

/**
 * Wire the demo figure up and play it on a loop.
 * Elements: { tabs, code, note, stamp, roleBtn, replayBtn }.
 */
export function createDemo(el) {
  // A fresh copy of the project, because the script types into it.
  const fresh = () => Object.fromEntries(Object.entries(FILES).map(([k, v]) => [k, [...v]]));
  let files = fresh();
  let active = "greet.py";
  let caret = null;   // { file, line, col, who } or null
  let blocked = false;
  let role = "host";  // what the reader is pretending to be
  let timer = null;
  let stop = false;

  /* ── Drawing ─────────────────────────────────────────────────── */
  const KEYWORDS = /\b(from|import|def|return|print|input|or|if|else|for|in|while|True|False|None)\b/g;
  // Escape a line, then colour keywords, strings and comments. Order matters: escape first.
  const paint = (line) => {
    const safe = line.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
    if (safe.trimStart().startsWith("#")) return `<span class="cm">${safe}</span>`;
    return safe
      .replace(/("[^"]*")/g, '<span class="st">$1</span>')
      .replace(KEYWORDS, '<span class="kw">$&</span>');
  };

  // Redraw the tab strip, marking the file the script is in.
  function drawTabs() {
    el.tabs.replaceChildren(...Object.keys(files).map((name) => {
      const b = document.createElement("button");
      b.className = "demo-tab";
      b.role = "tab";
      b.type = "button";
      b.setAttribute("aria-selected", String(name === active));
      b.textContent = name;
      b.addEventListener("click", () => { active = name; draw(); });
      return b;
    }));
  }

  // Redraw the code, putting the block caret wherever the script has reached.
  function draw() {
    const lines = files[active];
    el.code.replaceChildren();
    lines.forEach((text, i) => {
      const row = document.createElement("span");
      row.className = "ln";
      const here = caret && caret.file === active && caret.line === i;
      row.innerHTML = paint(here ? text.slice(0, caret.col) : text);
      if (here) {
        const cur = document.createElement("span");
        cur.className = "cursor";
        const who = document.createElement("span");
        who.className = "who";
        who.textContent = caret.who;
        cur.append(who);
        row.append(cur);
        if (text.length > caret.col) row.insertAdjacentHTML("beforeend", paint(text.slice(caret.col)));
      }
      el.code.append(row);
    });
    if (blocked) {
      const tag = document.createElement("div");
      tag.className = "blocked";
      tag.innerHTML = '<i class="ph ph-lock-simple"></i>Read only';
      el.code.append(tag);
    }
  }

  /* ── Playing ─────────────────────────────────────────────────── */
  // A cancellable pause.
  const pause = (ms) => new Promise((resolve) => { timer = setTimeout(resolve, ms); });

  // Type `text` into one line, a character at a time, with the caret in front of it.
  async function type(step) {
    active = step.file;
    files[step.file][step.line] = "";
    drawTabs();
    for (let i = 0; i <= step.text.length; i++) {
      if (stop) return;
      files[step.file][step.line] = step.text.slice(0, i);
      caret = { file: step.file, line: step.line, col: i, who: step.who };
      draw();
      await pause(22 + Math.random() * 45);
    }
  }

  // A refused edit: the caret gets as far as the keyboard, and the update never lands.
  async function refuse(step) {
    await type(step);
    if (stop) return;
    blocked = true;
    files[step.file][step.line] = "";
    caret = null;
    draw();
    await pause(1500);
    blocked = false;
    draw();
  }

  // Walk the script once, then start again.
  async function play() {
    files = fresh();
    active = "greet.py";
    caret = null;
    blocked = false;
    drawTabs();
    draw();
    for (const step of SCRIPT) {
      if (stop) return;
      el.note.textContent = step.note;
      // Whatever the reader set the role chip to decides whether these keystrokes are allowed.
      const refused = step.blocked || (role === "viewer" && step.who);
      if (step.who && refused) await refuse(step);
      else if (step.who) await type(step);
      else await pause(step.wait ?? 900);
      if (stop) return;
      await pause(step.who ? 850 : 200);
    }
    caret = null;
    draw();
    el.note.textContent = "That is the whole idea. Open a room and it is your names in the margin.";
    await pause(3200);
    if (!stop) play();
  }

  // Start again from the top, cancelling whatever was running.
  function restart() {
    stop = true;
    clearTimeout(timer);
    queueMicrotask(() => { stop = false; play(); });
  }

  const ROLES = ["host", "editor", "viewer"];
  el.roleBtn.addEventListener("click", () => {
    role = ROLES[(ROLES.indexOf(role) + 1) % ROLES.length];
    el.stamp.className = `stamp ${role}`;
    el.stamp.textContent = role[0].toUpperCase() + role.slice(1);
    restart();
  });
  el.replayBtn.addEventListener("click", restart);

  // Only animate while the figure is on screen, and never for a reader who asked for stillness.
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    files["greet.py"][3] = "    print(shout(f\"hello {name}\"))";
    files["greet.py"][4] = "    return name";
    drawTabs();
    draw();
    el.note.textContent = "Two people editing one file, with a third reading along.";
    return;
  }
  const io = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting && !timer) restart();
    else if (!entry.isIntersecting) { stop = true; clearTimeout(timer); timer = null; }
  }, { threshold: 0.2 });
  io.observe(el.code);
}
