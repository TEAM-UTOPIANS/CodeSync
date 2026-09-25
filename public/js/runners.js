// Execution dispatcher. Where a language runs is decided by its `runtime` in languages.js:
//   browser: Web Worker / Pyodide / the MiniLang interpreter, all on the user's machine
//   preview: rendered by the page in a sandboxed iframe (see room.js)
//   remote:  /api/execute (Vercel function), falling back to the compiler services directly
import { LANGUAGES } from "./languages.js";
import { run as runMiniLang } from "./minilang.js";
import { executeRemote } from "./providers.js";

const TIMEOUT_MS = { javascript: 8000, python: 20_000 };
const COLD_START_MS = 90_000;
const REMOTE_TIMEOUT_MS = 65_000;

/* ── Browser workers ─────────────────────────────────────────────── */

// The Python worker stays alive between runs (Pyodide is slow to load) until a run has to be killed.
let pyWorker = null;
let pyWarm = false;

// Run code in a worker and stream its output, killing the worker if it overruns.
function runInWorker(lang, code, stdin, { write, status }, files) {
  return new Promise((resolve) => {
    const isPy = lang === "python";
    let worker = isPy ? pyWorker : null;
    if (!worker) {
      worker = new Worker(`/js/workers/${isPy ? "py" : "js"}-worker.js`);
      if (isPy) { pyWorker = worker; pyWarm = false; }
    }
    const limit = isPy && !pyWarm ? COLD_START_MS : TIMEOUT_MS[lang];

    // Terminate the worker and forget it, so the next run starts clean.
    const kill = () => {
      worker.terminate();
      if (isPy) { pyWorker = null; pyWarm = false; }
    };
    // Stop listening and cancel the timeout.
    const cleanup = () => { clearTimeout(timer); worker.onmessage = worker.onerror = null; };
    const timer = setTimeout(() => {
      cleanup();
      kill();
      write(`\nTimed out after ${limit / 1000}s. Execution stopped.\n`, "stderr");
      resolve({ ok: false, timedOut: true });
    }, limit);

    worker.onmessage = ({ data }) => {
      if (data.type === "status") status?.(data.text);
      else if (data.type === "done") {
        cleanup();
        if (isPy) pyWarm = true; else worker.terminate();
        resolve({ ok: data.ok, error: data.error });
      } else write(data.text, data.type);
    };
    worker.onerror = (e) => {
      cleanup();
      kill();
      write(`${e.message || "Worker error"}\n`, "stderr");
      resolve({ ok: false });
    };
    worker.postMessage({ code, stdin, files });
  });
}

/* ── Remote compilers ────────────────────────────────────────────── */

class Rejected extends Error {}

// Ask our function to build the project, falling back to calling the services directly.
async function callRemote(id, code, stdin, files) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REMOTE_TIMEOUT_MS);
  try {
    let res = null;
    try {
      res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: id, code, stdin, files }),
        signal: ctrl.signal,
      });
    } catch (e) { if (ctrl.signal.aborted) throw e; }
    if (res?.ok) return await res.json();
    if (res && [400, 413, 429].includes(res.status)) throw new Rejected((await res.json().catch(() => ({}))).error || "The request was rejected.");
    // The function is missing (static hosting) or its upstream failed: ask the services directly.
    return await executeRemote(id, code, stdin, { signal: ctrl.signal, files });
  } finally {
    clearTimeout(timer);
  }
}

// Turn compiler diagnostics into an editor marker: gcc/javac "file:LINE:COL: error", rustc "--> file:LINE:COL", go "file.go:LINE:COL".
const DIAGNOSTIC = [
  /(?:^|\n)\S*?:(\d+):(\d+):\s*(?:fatal )?error:?\s*([^\n]*)/,
  /(?:^|\n)\S*?:(\d+):\s*error:\s*([^\n]*)/,
  /-->\s*\S+:(\d+):(\d+)/,
  /\.\w+:(\d+):(\d+):\s*([^\n]*)/,
];
// Find the first file, line and column in a compiler's message.
function diagnosticFrom(text) {
  for (const re of DIAGNOSTIC) {
    const m = re.exec(text);
    if (m) return { line: Number(m[1]), col: /^\d+$/.test(m[2] ?? "") ? Number(m[2]) : 1, message: (m[3] ?? m[2] ?? "Compilation failed").toString().trim() };
  }
  return null;
}

// Build and run on a compiler service, then report it like any other run.
async function runRemote(id, code, stdin, { write, status }, files) {
  status?.(`Building and running ${LANGUAGES[id].label}…`);
  let r;
  try {
    r = await callRemote(id, code, stdin, files);
  } catch (e) {
    const message = e instanceof Rejected ? e.message
      : e.name === "AbortError" ? "The compiler service took too long to respond."
      : "Could not reach a compiler service. Check your connection and try again.";
    write(`${message}\n`, "stderr");
    return { ok: false };
  }

  const meta = { provider: r.provider, version: r.version, timeMs: r.timeMs, exitCode: r.exitCode };
  if (r.phase === "compile" && !r.ok) {
    write(r.compileOutput.trim() ? `${r.compileOutput.trimEnd()}\n` : `${r.stderr || "Compilation failed."}\n`, "stderr");
    return { ok: false, meta, error: diagnosticFrom(r.compileOutput || r.stderr || "") };
  }
  if (r.compileOutput.trim() && r.ok) write(`${r.compileOutput.trimEnd()}\n\n`, "meta");
  if (r.stdout) write(r.stdout.endsWith("\n") ? r.stdout : `${r.stdout}\n`, "stdout");
  if (r.stderr) write(r.stderr.endsWith("\n") ? r.stderr : `${r.stderr}\n`, "stderr");
  if (!r.ok) write(`\n${r.signal ? `Stopped by ${r.signal}` : `Exited with code ${r.exitCode}`}\n`, "meta");
  return { ok: r.ok, meta };
}

/* ── Public API ──────────────────────────────────────────────────── */

/**
 * Run code. `files` are the project's other files ({name, code}). Output streams through hooks.write(text, "stdout"|"stderr"|"meta").
 * Resolves {ok, error?: {line, col, message}, meta?: {provider, version, timeMs, exitCode}, preview?: true}.
 */
export async function runCode(id, code, stdin, hooks, files = []) {
  const lang = LANGUAGES[id];
  if (lang.runtime === "preview") return { ok: true, preview: true };
  if (id === "minilang") {
    const r = runMiniLang(code, { stdin });
    if (r.stdout) hooks.write(r.stdout + "\n", "stdout");
    if (r.status === "WAITING_FOR_INPUT") {
      hooks.write(`\nThe program is waiting for input for '${r.inputVar}'. Add a line in the Input tab and run again.\n`, "stderr");
      return { ok: false, error: r.error };
    }
    if (!r.ok) hooks.write(`${r.error.message}\n`, "stderr");
    return { ok: r.ok, error: r.error };
  }
  if (lang.runtime === "browser") return runInWorker(id, code, stdin, hooks, files);
  return runRemote(id, code, stdin, hooks, files);
}
