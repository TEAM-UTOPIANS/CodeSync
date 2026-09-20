// Runs Python via Pyodide (CPython compiled to WebAssembly). Loaded lazily on first use;
// the interpreter is reused across runs. The host terminates this worker on timeout.
importScripts("https://cdn.jsdelivr.net/pyodide/v0.29.0/full/pyodide.js");

const post = (type, text) => self.postMessage({ type, text });
let pyodide = null;

// Drop Pyodide's internal frames so tracebacks start at the user's code.
const cleanTraceback = (msg) => {
  const i = msg.indexOf('File "<exec>"');
  return i === -1 ? msg : "Traceback (most recent call last):\n  " + msg.slice(i);
};

let written = new Set();

self.onmessage = async ({ data: { code, stdin, files = [] } }) => {
  try {
    if (!pyodide) {
      post("status", "Loading Python runtime (first run only)…");
      pyodide = await loadPyodide();
    }
    const lines = stdin ? stdin.replace(/\r\n?/g, "\n").split("\n") : [];
    let idx = 0;
    pyodide.setStdin({ stdin: () => (idx < lines.length ? lines[idx++] : undefined) });
    pyodide.setStdout({ batched: (s) => post("stdout", s + "\n") });
    pyodide.setStderr({ batched: (s) => post("stderr", s + "\n") });

    // Other project files become importable modules in the working directory.
    for (const name of written) if (!files.some((f) => f.name === name)) { try { pyodide.FS.unlink(name); } catch { /* already gone */ } }
    for (const f of files) pyodide.FS.writeFile(f.name, f.code);
    written = new Set(files.map((f) => f.name));
    pyodide.runPython("import importlib, sys; importlib.invalidate_caches(); [sys.modules.pop(m) for m in list(sys.modules) if getattr(sys.modules[m], '__file__', '') and str(sys.modules[m].__file__).startswith('/home/pyodide/')]");

    const globals = pyodide.globals.get("dict")();
    try {
      await pyodide.runPythonAsync(code, { globals });
      self.postMessage({ type: "done", ok: true });
    } catch (e) {
      const message = String(e.message || e).trimEnd();
      post("stderr", cleanTraceback(message) + "\n");
      const lines = [...message.matchAll(/File "<exec>", line (\d+)/g)];
      const last = lines.at(-1);
      self.postMessage({ type: "done", ok: false, error: last ? { line: Number(last[1]), col: 1, message: message.split("\n").at(-1) } : null });
    } finally {
      globals.destroy();
    }
  } catch (e) {
    post("stderr", `Could not load the Python runtime: ${e.message || e}\n`);
    self.postMessage({ type: "done", ok: false });
  }
};
