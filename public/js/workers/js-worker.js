// Runs user JavaScript in an isolated Web Worker. The host terminates this worker on timeout.
const post = (type, text) => self.postMessage({ type, text });

const format = (v) => {
  if (typeof v === "string") return v;
  if (v instanceof Error) return v.stack || `${v.name}: ${v.message}`;
  if (typeof v === "function" || typeof v === "symbol" || typeof v === "undefined") return String(v);
  try { return JSON.stringify(v, (k, x) => (typeof x === "bigint" ? `${x}n` : x), 2); } catch { return String(v); }
};
const line = (args) => args.map(format).join(" ") + "\n";

self.onmessage = async ({ data: { code, stdin } }) => {
  const inputLines = stdin ? stdin.replace(/\r\n?/g, "\n").split("\n") : [];
  let inputIdx = 0;

  for (const [name, stream] of [["log", "stdout"], ["info", "stdout"], ["debug", "stdout"], ["warn", "stderr"], ["error", "stderr"]]) {
    console[name] = (...args) => post(stream, line(args));
  }
  self.input = self.prompt = () => (inputIdx < inputLines.length ? inputLines[inputIdx++] : null);

  // `done` fires once the main body settled AND no timers are pending, so setTimeout demos work.
  const timers = new Set();
  let mainSettled = false, finished = false;
  const finish = (ok) => {
    if (finished) return;
    finished = true;
    self.postMessage({ type: "done", ok, error: errorInfo });
  };
  const maybeFinish = () => { if (mainSettled && timers.size === 0) finish(!failed); };
  let failed = false, errorInfo = null;
  const fail = (e) => {
    failed = true;
    if (e instanceof Error) {
      post("stderr", `${e.name}: ${e.message}\n`);
      // The wrapper adds two header lines before user code, hence `- 2`.
      const m = /<anonymous>:(\d+):(\d+)/.exec(e.stack || "");
      if (m && !errorInfo) errorInfo = { line: Number(m[1]) - 2, col: Number(m[2]), message: `${e.name}: ${e.message}` };
    } else post("stderr", `Uncaught ${format(e)}\n`);
  };

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
