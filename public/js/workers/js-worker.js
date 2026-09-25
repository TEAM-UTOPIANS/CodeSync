// Runs user JavaScript in an isolated Web Worker. The host terminates this worker on timeout.
const post = (type, text) => self.postMessage({ type, text });

// Render any value the way a console would.
const format = (v) => {
  if (typeof v === "string") return v;
  if (v instanceof Error) return v.stack || `${v.name}: ${v.message}`;
  if (typeof v === "function" || typeof v === "symbol" || typeof v === "undefined") return String(v);
  try { return JSON.stringify(v, (k, x) => (typeof x === "bigint" ? `${x}n` : x), 2); } catch { return String(v); }
};
// Join console arguments into one printable line.
const line = (args) => args.map(format).join(" ") + "\n";

self.onmessage = async ({ data: { code, stdin, files = [] } }) => {
  const inputLines = stdin ? stdin.replace(/\r\n?/g, "\n").split("\n") : [];
  let inputIdx = 0;

  for (const [name, stream] of [["log", "stdout"], ["info", "stdout"], ["debug", "stdout"], ["warn", "stderr"], ["error", "stderr"]]) {
    console[name] = (...args) => post(stream, line(args));
  }
  // Other project files are available through require('./name.js').
  const sources = new Map(files.map((f) => [f.name, f.code]));
  const cache = new Map();
  self.require = (spec) => {
    const key = String(spec).replace(/^\.\//, "");
    const name = [key, `${key}.js`].find((n) => sources.has(n));
    if (!name) throw new Error(`Cannot find module '${spec}'`);
    if (!cache.has(name)) {
      const module = { exports: {} };
      cache.set(name, module);
      new Function("module", "exports", "require", sources.get(name))(module, module.exports, self.require);
    }
    return cache.get(name).exports;
  };
  // Reading past the end of the supplied input is not an error: the page asks the visitor for
  // another line and runs the program again with it.
  const NEED_INPUT = { needInput: true };
  self.input = self.prompt = () => {
    if (inputIdx < inputLines.length) return inputLines[inputIdx++];
    throw NEED_INPUT;
  };

  // `done` fires once the main body settled AND no timers are pending, so setTimeout demos work.
  const timers = new Set();
  let mainSettled = false, finished = false;
  // Report the result once, however we got here.
  const finish = (ok) => {
    if (finished) return;
    finished = true;
    self.postMessage({ type: "done", ok, error: errorInfo, needInput });
  };
  // Done only when the main body settled and no timers are still pending.
  const maybeFinish = () => { if (mainSettled && timers.size === 0) finish(!failed); };
  let failed = false, errorInfo = null, needInput = false;
  // Print an error and remember where in the user's code it came from.
  const fail = (e) => {
    if (e === NEED_INPUT) { needInput = true; return; }
    failed = true;
    if (e instanceof Error) {
      post("stderr", `${e.name}: ${e.message}\n`);
      // The wrapper adds two header lines before user code, hence `- 2`.
      const m = /<anonymous>:(\d+):(\d+)/.exec(e.stack || "");
      if (m && !errorInfo) errorInfo = { line: Number(m[1]) - 2, col: Number(m[2]), message: `${e.name}: ${e.message}` };
    } else post("stderr", `Uncaught ${format(e)}\n`);
  };

  // Track timers so a pending setTimeout keeps the run alive.
  const wrapTimer = (native, repeat) => (fn, ms, ...rest) => {
    const id = native(() => {
      if (!repeat) timers.delete(id);
      try { typeof fn === "function" ? fn(...rest) : (0, eval)(String(fn)); } catch (e) { fail(e); }
      maybeFinish();
    }, ms);
    timers.add(id);
    return id;
  };
  const nativeSetTimeout = self.setTimeout.bind(self), nativeSetInterval = self.setInterval.bind(self);
  const nativeClearTimeout = self.clearTimeout.bind(self), nativeClearInterval = self.clearInterval.bind(self);
  self.setTimeout = wrapTimer(nativeSetTimeout, false);
  self.setInterval = wrapTimer(nativeSetInterval, true);
  self.clearTimeout = (id) => { timers.delete(id); nativeClearTimeout(id); maybeFinish(); };
  self.clearInterval = (id) => { timers.delete(id); nativeClearInterval(id); maybeFinish(); };
  self.addEventListener("unhandledrejection", (ev) => { ev.preventDefault(); fail(ev.reason); });

  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await new AsyncFunction(code)();
  } catch (e) {
    fail(e);
  }
  mainSettled = true;
  maybeFinish();
};
