// One terminal, the way an editor's terminal behaves: output and what you type share a single
// transcript, and the caret sits at the bottom waiting for the next line.
//
// Lines typed while nothing is running are queued and handed to the next program as its standard
// input. Lines typed while a program is waiting go straight to it.

const MAX_LINES = 600;

/**
 * Build a terminal inside `root`.
 * `onRun` is called when the visitor presses Enter on an empty prompt with nothing running.
 */
export function createTerminal(root, { onRun } = {}) {
  const view = document.createElement("div");
  view.className = "term-view";

  const promptRow = document.createElement("div");
  promptRow.className = "term-prompt";
  const caret = document.createElement("span");
  caret.className = "term-caret";
  caret.textContent = ">";
  const input = document.createElement("input");
  input.className = "term-input";
  input.setAttribute("aria-label", "Terminal input");
  input.autocomplete = "off";
  input.spellcheck = false;
  promptRow.append(caret, input);

  root.replaceChildren(view, promptRow);

  const queue = [];        // lines typed ahead of a run
  const history = [];      // lines typed this session, for the up arrow
  let historyAt = 0;
  let waiting = null;      // resolve function while a program waits for a line
  let busy = false;

  // Keep the newest output in sight unless the visitor has scrolled up to read something.
  const atBottom = () => root.scrollHeight - root.scrollTop - root.clientHeight < 40;
  const scroll = (force) => { if (force || atBottom()) root.scrollTop = root.scrollHeight; };

  // Append text to the transcript, continuing the last line when it had no newline.
  function write(text, kind = "out") {
    if (!text) return;
    const stick = atBottom();
    const parts = String(text).split("\n");
    const last = view.lastElementChild;
    parts.forEach((part, i) => {
      if (i === 0 && last && last.dataset.open === "true" && last.dataset.kind === kind) {
        last.textContent += part;
      } else {
        const line = document.createElement("div");
        line.className = `term-line ${kind}`;
        line.dataset.kind = kind;
        line.textContent = part;
        view.append(line);
      }
      const current = view.lastElementChild;
      current.dataset.open = i === parts.length - 1 ? "true" : "false";
    });
    while (view.childElementCount > MAX_LINES) view.firstElementChild.remove();
    scroll(stick);
  }

  // Show a line the visitor typed, so the transcript reads like a real session.
  function echo(text, pending) {
    const line = document.createElement("div");
    line.className = `term-line echo${pending ? " pending" : ""}`;
    line.dataset.open = "false";
    line.textContent = `> ${text}`;
    view.append(line);
    scroll(true);
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const value = input.value;
      input.value = "";
      if (value) { history.push(value); historyAt = history.length; }
      if (waiting) {
        // A program is asking for this line right now.
        echo(value, false);
        const resolve = waiting;
        waiting = null;
        promptRow.classList.remove("asking");
        resolve(value);
        return;
      }
      if (!value) { if (!busy) onRun?.(); return; }
      queue.push(value);
      echo(value, true);
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      if (!history.length) return;
      e.preventDefault();
      historyAt = Math.min(history.length, Math.max(0, historyAt + (e.key === "ArrowUp" ? -1 : 1)));
      input.value = history[historyAt] ?? "";
    }
    if (e.key === "c" && (e.ctrlKey || e.metaKey) && waiting) {
      // Ctrl+C while a program waits: stop asking and let the run finish on its own.
      e.preventDefault();
      const resolve = waiting;
      waiting = null;
      promptRow.classList.remove("asking");
      write("^C\n", "meta");
      resolve(null);
    }
  });

  // Clicking anywhere in the transcript puts the caret back, like a real terminal.
  root.addEventListener("mousedown", (e) => {
    if (e.target.closest(".term-input") || window.getSelection()?.toString()) return;
    setTimeout(() => input.focus(), 0);
  });

  return {
    /** Empty the transcript and anything typed ahead, so nothing invisible leaks into the next run. */
    clear() {
      view.replaceChildren();
      queue.length = 0;
    },
    write,
    /** Everything shown, for the copy button. */
    text: () => [...view.children].map((n) => n.textContent).join("\n"),
    /** Lines typed ahead of the run, handed over as standard input. */
    takeQueued() {
      const lines = queue.splice(0, queue.length);
      view.querySelectorAll(".term-line.pending").forEach((n) => n.classList.remove("pending"));
      return lines;
    },
    /** Put a line in the queue without the visitor typing it, used for starter samples. */
    preload(line) {
      if (queue.length || !line) return;
      queue.push(line);
      echo(line, true);
    },
    queued: () => queue.length,
    /** Wait for the running program's next line of input. Resolves null if the visitor gives up. */
    ask() {
      promptRow.classList.add("asking");
      input.focus();
      scroll(true);
      return new Promise((resolve) => { waiting = resolve; });
    },
    /** A run started or finished; the prompt shows which. */
    setBusy(state) {
      busy = state;
      promptRow.classList.toggle("busy", state);
      if (!state) promptRow.classList.remove("asking");
    },
    focus: () => input.focus(),
  };
}
