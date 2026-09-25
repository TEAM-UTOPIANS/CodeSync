// The sample room in the hero. It plays a short scene on its own, then hands the controls over:
// flip the viewer into an editor and watch the very same keystroke be accepted.
// Everything in here is authored sample content, and the card says so.

const CREW = [
  { name: "Mayank", color: "#ffb3a0", role: "host" },
  { name: "Nitin", color: "#9ceccd", role: "editor" },
  { name: "Swarit", color: "#b9ccff", role: "viewer" },
];
const KEYWORDS = /^(from|import|def|return|print|if|else|for|in|not|None|True|False)$/;
const FACE = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="6" cy="7" r="1.4" fill="currentColor"/><circle cx="11" cy="7" r="1.4" fill="currentColor"/><path d="M6 10.5c1.2.9 2.6.9 3.8 0" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>';

export function createDemo({ root, tabs, code, crew, note, controls, state }) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const people = CREW.map((p) => ({ ...p }));
  const files = { "util.py": [""], "main.py": [""] };
  let active = "util.py";
  let caret = null;
  let blockedBy = null;
  let generation = 0;
  let auto = true;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const person = (name) => people.find((p) => p.name === name);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function paintLine(line) {
    const out = el("span", "ln");
    if (!line) return out;
    if (line.trimStart().startsWith("#")) { out.append(el("span", "cm", line)); return out; }
    for (const piece of line.split(/("[^"]*")/)) {
      if (!piece) continue;
      if (piece.startsWith('"')) { out.append(el("span", "st", piece)); continue; }
      for (const word of piece.split(/(\w+)/)) {
        if (!word) continue;
        out.append(KEYWORDS.test(word) ? el("span", "kw", word) : document.createTextNode(word));
      }
    }
    return out;
  }

  function render() {
    tabs.replaceChildren();
    for (const name of Object.keys(files)) {
      const t = el("button", "demo-tab");
      t.type = "button";
      t.setAttribute("role", "tab");
      t.setAttribute("aria-selected", String(name === active));
      t.append(el("i", "ph ph-file-py"), el("span", "", name));
      t.addEventListener("click", () => { stopAuto(); active = name; render(); });
      tabs.append(t);
    }

    code.replaceChildren();
    const lines = files[active];
    lines.forEach((text, i) => {
      const line = paintLine(text);
      if (caret && caret.file === active && i === lines.length - 1) {
        const c = el("span", "cursor");
        c.style.setProperty("--c", caret.color);
        const tag = el("span", "tag");
        tag.innerHTML = FACE;
        tag.append(document.createTextNode(caret.who));
        c.append(tag);
        line.append(c);
      }
      code.append(line, document.createTextNode("\n"));
    });
    if (blockedBy) {
      const flag = el("div", "blocked");
      flag.append(el("i", "ph ph-hand-palm"), el("span", "", `${blockedBy} is a viewer`));
      code.append(flag);
    }

    crew.replaceChildren();
    for (const p of people) {
      const chip = el("span", `chip${caret?.who === p.name ? " speaking" : ""}`, p.name[0]);
      chip.style.background = p.color;
      chip.title = `${p.name} (${p.role})`;
      crew.append(chip);
    }
    renderControls();
  }

  function renderControls() {
    controls.replaceChildren();
    const swarit = person("Swarit");
    const flip = el("button", "btn sm", swarit.role === "viewer" ? "Give Swarit a pen" : "Take the pen back");
    flip.type = "button";
    flip.addEventListener("click", () => {
      stopAuto();
      swarit.role = swarit.role === "viewer" ? "editor" : "viewer";
      blockedBy = null;
      say(swarit.role === "editor"
        ? "Mayank handed Swarit a pen. The server applies that instantly, for everyone."
        : "Swarit is back to watching. The next keystroke will bounce.");
      render();
    });

    const tryType = el("button", "btn sm primary", "Type as Swarit");
    tryType.type = "button";
    tryType.addEventListener("click", () => { stopAuto(); attempt(swarit); });
    controls.append(flip, tryType);
  }

  const say = (text) => { note.textContent = text; };
  function setState(label, kind) {
    state.textContent = label;
    state.className = `stamp ${kind}`;
  }

  async function attempt(p) {
    if (p.role === "viewer") {
      blockedBy = p.name;
      caret = null;
      setState("Bounced", "bad");
      say(`${p.name} tried to type. The room server turned the edit away, so nobody else saw a thing.`);
      render();
      await sleep(2300);
      if (blockedBy === p.name) { blockedBy = null; setState("Sample", "ok"); render(); }
      return;
    }
    blockedBy = null;
    setState("Accepted", "ok");
    say(`${p.name} has a pen now, so the keystroke lands and everyone in the room sees it.`);
    await typeInto("main.py", `\nprint(greet("${p.name}"))`, p, 0);
    caret = null;
    render();
  }

  async function typeInto(file, text, p, speed = 32) {
    const mine = ++generation;
    active = file;
    caret = { file, who: p.name, color: p.color };
    for (const ch of text) {
      if (mine !== generation) return false;
      const lines = files[file];
      if (ch === "\n") lines.push(""); else lines[lines.length - 1] += ch;
      render();
      if (speed) await sleep(speed);
    }
    render();
    return mine === generation;
  }

  function stopAuto() { auto = false; generation += 1; }

  function reset() {
    files["util.py"] = [""];
    files["main.py"] = [""];
    active = "util.py";
    caret = null;
    blockedBy = null;
    person("Swarit").role = "viewer";
  }

  async function play() {
    const mine = ++generation;
    const alive = () => auto && mine === generation;

    reset();
    setState("Sample", "ok");
    say("Three people, one project. Watch for a moment, then take over below.");
    render();
    await sleep(1300);
    if (!alive()) return;

    say("Nitin has a pen. He writes a little helper in util.py.");
    if (!(await typeInto("util.py", 'def greet(name):\n    return "hi " + name', person("Nitin")))) return;
    await sleep(850);
    if (!alive()) return;

    say("Mayank hosts the room, and calls it from main.py.");
    if (!(await typeInto("main.py", 'from util import greet\n\nprint(greet("Nitin"))', person("Mayank")))) return;
    caret = null;
    render();
    await sleep(1000);
    if (!alive()) return;

    say("Swarit joined as a viewer, and starts typing anyway.");
    render();
    await sleep(950);
    if (!alive()) return;
    await attempt(person("Swarit"));
    if (!alive()) return;

    say("Your turn: hand Swarit a pen, then try that keystroke again.");
    auto = false;
  }

  function showFinalState() {
    files["util.py"] = ["def greet(name):", '    return "hi " + name'];
    files["main.py"] = ["from util import greet", "", 'print(greet("Nitin"))'];
    active = "main.py";
    setState("Sample", "ok");
    say("A sample room: Mayank hosts, Nitin edits, Swarit watches until the host says otherwise.");
    render();
  }

  // Start only once the card is actually on screen, and stand down when it scrolls away.
  const observer = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) { if (auto) generation += 1; return; }
    observer.disconnect();
    if (reduce) showFinalState(); else play();
  }, { threshold: 0.3 });

  render();
  say("Warming up the sample room.");
  observer.observe(root);

  return { replay: () => { auto = true; play(); } };
}
