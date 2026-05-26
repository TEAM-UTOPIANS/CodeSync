/* global window */
/**
 * Unified terminal: program output + stdin input line (online-compiler style).
 */
(function () {
  let outputEl = null;
  let scrollEl = null;
  let inputEl = null;
  const stdinLines = [];

  function scrollToBottom() {
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  function init() {
    outputEl = document.getElementById("terminalOutput");
    scrollEl = document.getElementById("terminalScroll");
    inputEl = document.getElementById("terminalInput");

    if (!outputEl || !inputEl) return;

    inputEl.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      commitInputLine();
    });

    const clearBtn = document.getElementById("clearTerminalBtn");
    if (clearBtn) clearBtn.addEventListener("click", clear);
  }

  function commitInputLine() {
    if (!inputEl) return "";
    const line = inputEl.value;
    inputEl.value = "";
    if (!line) return "";
    stdinLines.push(line);
    appendInputEcho(line);
    return line;
  }

  function appendInputEcho(line) {
    if (!outputEl) return;
    const row = document.createElement("div");
    row.className = "terminal-echo";
    row.textContent = `> ${line}`;
    outputEl.appendChild(row);
    scrollToBottom();
  }

  function getStdin() {
    const pending = inputEl?.value ?? "";
    const lines = [...stdinLines];
    if (pending) lines.push(pending);
    return lines.join("\n");
  }

  function setStdin(text) {
    stdinLines.length = 0;
    if (!text) return;
    const lines = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    stdinLines.push(...lines);
  }

  function clear() {
    stdinLines.length = 0;
    if (inputEl) inputEl.value = "";
    if (outputEl) outputEl.innerHTML = "";
    scrollToBottom();
  }

  function setRunOutput(text) {
    if (!outputEl) return;
    const block = document.createElement("pre");
    block.className = "terminal-run";
    block.textContent = text || "";
    outputEl.appendChild(block);
    scrollToBottom();
  }

  function formatRunResult(data) {
    if (!data || !data.ok) {
      const status = data?.status || "";
      if (status === "WAITING_FOR_INPUT") {
        const stdout = (data?.stdout || "").trimEnd();
        const v = data?.input_var ? ` (${data.input_var})` : "";
        const msg = `Waiting for input${v}. Provide a line and press Run again.`;
        return stdout ? `${stdout}\n\n${msg}` : msg;
      }
      const err = (data?.error || data?.stderr || "").trim();
      return err || "Execution failed";
    }
    const parts = [];
    const stdout = (data.stdout || "").trimEnd();
    const stderr = (data.stderr || "").trimEnd();
    const status = data.status || "";
    if (stdout) parts.push(stdout);
    if (stderr) parts.push(stderr);
    if (!stdout && !stderr && status) parts.push(`[${status}]`);
    else if (status && status !== "Accepted" && status !== "Success") {
      parts.push(`[${status}]`);
    }
    return parts.length ? parts.join("\n") : "(no output)";
  }

  function beforeRun() {
    // Commit any pending input (not yet "Enter" pressed) as a queued stdin line.
    // Then clear previous run output but keep echoed stdin lines for a cleaner transcript.
    commitInputLine();
    if (!outputEl) return;
    const echoes = Array.from(outputEl.querySelectorAll(".terminal-echo"));
    outputEl.innerHTML = "";
    for (const e of echoes) outputEl.appendChild(e);
    scrollToBottom();
  }

  window.CodeSyncTerminal = {
    init,
    getStdin,
    setStdin,
    clear,
    setRunOutput,
    formatRunResult,
    beforeRun,
  };
})();
