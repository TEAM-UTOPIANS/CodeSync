// Remote code execution through free public compiler services (Wandbox, Compiler Explorer).
// This module is pure fetch code: the Vercel function in api/execute.js uses it server-side,
// and the browser uses it directly as a fallback when the function is unavailable.
// Both services send `access-control-allow-origin: *`.

const WANDBOX = "https://wandbox.org/api";
const GODBOLT = "https://godbolt.org/api";
const LIST_TTL_MS = 60 * 60 * 1000;

/**
 * Which service runs which language.
 *  wandbox.language: name in Wandbox's compiler list. wandbox.prefer: picks the newest release matching it.
 *  wandbox.raw: extra compiler flags. godbolt.lang / godbolt.prefer: same idea for Compiler Explorer.
 *  Listing both gives automatic fallback when one service is down.
 */
export const REMOTE = {
  c: { wandbox: { language: "C", prefer: /^gcc-\d+\.\d+\.\d+-c$/, raw: "-std=c17\n-O2\n-I." }, godbolt: { lang: "c", prefer: /^cg\d+$/ } },
  cpp: { wandbox: { language: "C++", prefer: /^gcc-\d+\.\d+\.\d+$/, raw: "-std=c++20\n-O2\n-I." }, godbolt: { lang: "c++", prefer: /^g\d+$/ } },
  csharp: { wandbox: { language: "C#", prefer: /^mono-\d+\.\d+\.\d+\.\d+$/ } },
  java: { wandbox: { language: "Java", prefer: /^openjdk-jdk-\d+\+\d+$/ }, godbolt: { lang: "java", prefer: /^java\d+$/ } },
  kotlin: { godbolt: { lang: "kotlin", prefer: /^kotlinc\d+$/ } },
  scala: { wandbox: { language: "Scala", prefer: /^scala-3\.\d+\.\d+$/ } },
  groovy: { wandbox: { language: "Groovy", prefer: /^groovy-\d+\.\d+\.\d+$/ } },
  rust: { wandbox: { language: "Rust", prefer: /^rust-\d+\.\d+\.\d+$/, raw: "--edition=2021" }, godbolt: { lang: "rust", prefer: /^r\d+$/ } },
  go: { wandbox: { language: "Go", prefer: /^go-\d+\.\d+\.\d+$/ }, godbolt: { lang: "go", prefer: /^gl\d+$/ } },
  zig: { wandbox: { language: "Zig", prefer: /^zig-\d+\.\d+\.\d+$/ } },
  nim: { wandbox: { language: "Nim", prefer: /^nim-\d+\.\d+\.\d+$/ } },
  crystal: { godbolt: { lang: "crystal", prefer: /^crystal\d+$/ } },
  dlang: { wandbox: { language: "D", prefer: /^ldc-\d+\.\d+\.\d+$/ }, godbolt: { lang: "d", prefer: /^ldc\d+$/ } },
  swift: { godbolt: { lang: "swift", prefer: /^swift\d+$/ } },
  dart: { godbolt: { lang: "dart", prefer: /^dart\d+$/ } },
  ruby: { wandbox: { language: "Ruby", prefer: /^ruby-\d+\.\d+\.\d+$/ }, godbolt: { lang: "ruby", prefer: /^ruby\d+$/ } },
  php: { wandbox: { language: "PHP", prefer: /^php-\d+\.\d+\.\d+$/ } },
  perl: { wandbox: { language: "Perl", prefer: /^perl-\d+\.\d+\.\d+$/ } },
  lua: { wandbox: { language: "Lua", prefer: /^lua-\d+\.\d+\.\d+$/ }, godbolt: { lang: "lua", prefer: /^lua\d+$/ } },
  r: { wandbox: { language: "R", prefer: /^r-\d+\.\d+\.\d+$/ } },
  julia: { wandbox: { language: "Julia", prefer: /^julia-\d+\.\d+\.\d+$/ }, godbolt: { lang: "julia", prefer: /^julia_\d+_\d+_\d+$/ } },
  haskell: { wandbox: { language: "Haskell", prefer: /^ghc-\d+\.\d+\.\d+$/ }, godbolt: { lang: "haskell", prefer: /^ghc\d+$/ } },
  ocaml: { godbolt: { lang: "ocaml", prefer: /^ocaml\d+$/ } },
  pascal: { wandbox: { language: "Pascal", prefer: /^fpc-\d+\.\d+\.\d+$/ }, godbolt: { lang: "pascal", prefer: /^fpc\d+$/ } },
  fortran: { godbolt: { lang: "fortran", prefer: /^gfortran\d+$/ } },
  cobol: { godbolt: { lang: "cobol", prefer: /^gnucobol\d+$/ } },
  bash: { wandbox: { language: "Bash script", prefer: /^bash$/ } },
  typescript: { wandbox: { language: "TypeScript", prefer: /^typescript-\d+\.\d+\.\d+$/ } },
  sql: { wandbox: { language: "SQL", prefer: /^sqlite-\d+\.\d+\.\d+$/ } },
};

export const REMOTE_IDS = Object.keys(REMOTE);

/* ── helpers ─────────────────────────────────────────────────────── */

// Pull the numbers out of a compiler name so versions can be compared.
const versionKey = (name) => (String(name).match(/\d+/g) || []).map(Number);
// Sort newest first, part by numeric part.
const compareVersionsDesc = (a, b) => {
  const x = versionKey(a), y = versionKey(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (y[i] ?? 0) - (x[i] ?? 0);
    if (d) return d;
  }
  return 0;
};

const cache = new Map();
// Drop the cached compiler lists. The tests call this between cases.
export const clearProviderCache = () => cache.clear();

// Remember a provider's compiler list for an hour.
async function cached(key, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < LIST_TTL_MS) return hit.value;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

// Fetch JSON and turn any non-2xx answer into a readable error.
async function getJson(url, init, { fetchImpl, signal }) {
  const res = await fetchImpl(url, { ...init, signal });
  if (!res.ok) throw new Error(`${new URL(url).hostname} responded ${res.status}`);
  return res.json();
}

const ANSI = new RegExp(String.fromCharCode(27) + "\\[[0-9;?]*[A-Za-z]", "g"); // compilers colour their diagnostics
// Compilers colour their diagnostics; the editor wants the plain text.
const plain = (s) => String(s ?? "").replace(ANSI, "");
// Flatten Compiler Explorer's line objects into one string.
const lines = (arr) => plain((arr || []).map((l) => l.text).join("\n"));

/* ── Wandbox ─────────────────────────────────────────────────────── */

// Wandbox compilers for this language, best match first.
async function wandboxCompilers(spec, ctx) {
  const list = await cached("wandbox", () => getJson(`${WANDBOX}/list.json`, {}, ctx));
  const names = list.filter((c) => c.language === spec.language).map((c) => c.name);
  const preferred = names.filter((n) => spec.prefer.test(n)).sort(compareVersionsDesc);
  const rest = names.filter((n) => !preferred.includes(n)).sort(compareVersionsDesc);
  const candidates = [...preferred, ...rest];
  if (!candidates.length) throw new Error(`No Wandbox compiler for ${spec.language}`);
  return candidates;
}

// Some Wandbox toolchains are broken on the server side (missing libraries, permissions).
// Those failures are not the user's fault, so the next candidate compiler is tried instead.
const BROKEN_TOOLCHAIN = /Permission denied|command not found|No such file or directory|error while loading shared libraries|File size limit exceeded|catatonit/i;
// Tell a broken toolchain apart from an honest compile error.
const looksBroken = (r) => r.phase === "compile" && BROKEN_TOOLCHAIN.test(r.compileOutput)
  || [126, 127, 153].includes(r.exitCode) && BROKEN_TOOLCHAIN.test(r.stderr + r.compileOutput);

// One build and run on a named Wandbox compiler.
async function runWandboxOnce(spec, compiler, code, stdin, ctx) {
  const t0 = Date.now();
  const body = { compiler, code, stdin, save: false };
  if (ctx.files?.length) body.codes = ctx.files.map((f) => ({ file: f.name, code: f.code }));
  if (spec.raw) body["compiler-option-raw"] = spec.raw;
  const r = await getJson(`${WANDBOX}/compile.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, ctx);
  const exitCode = Number.parseInt(r.status, 10);
  const stdout = plain(r.program_output);
  const stderr = plain(r.program_error);
  const compilerOutput = plain(r.compiler_error || (exitCode !== 0 && !stdout && !stderr ? r.compiler_output : ""));
  const failedToBuild = exitCode !== 0 && compilerOutput && !stdout && !stderr;
  return {
    ok: exitCode === 0 && !r.signal,
    exitCode: Number.isNaN(exitCode) ? null : exitCode,
    signal: r.signal || null,
    stdout,
    stderr,
    compileOutput: compilerOutput,
    phase: failedToBuild ? "compile" : "run",
    provider: "Wandbox",
    version: compiler,
    timeMs: Date.now() - t0,
  };
}

// Try the preferred compilers in turn, stepping over broken toolchains.
async function runWandbox(spec, code, stdin, ctx) {
  const candidates = (await wandboxCompilers(spec, ctx)).slice(0, 4);
  let last;
  for (const compiler of candidates) {
    last = await runWandboxOnce(spec, compiler, code, stdin, ctx);
    if (last.ok || !looksBroken(last)) return last;
  }
  return last;
}

/* ── Compiler Explorer ───────────────────────────────────────────── */

// The newest Compiler Explorer compiler matching this language.
async function godboltCompiler(spec, ctx) {
  const list = await cached(`godbolt:${spec.lang}`, () =>
    getJson(`${GODBOLT}/compilers/${encodeURIComponent(spec.lang)}?fields=id,name,semver`, { headers: { Accept: "application/json" } }, ctx));
  const matches = list.filter((c) => spec.prefer.test(c.id));
  if (!matches.length) throw new Error(`No Compiler Explorer compiler for ${spec.lang}`);
  // The list is not ordered by version; semver is.
  return matches.sort((a, b) => compareVersionsDesc(a.semver || a.name || "", b.semver || b.name || ""))[0];
}

// Build and run on Compiler Explorer, then normalise the answer.
async function runGodbolt(spec, code, stdin, ctx) {
  const compiler = await godboltCompiler(spec, ctx);
  const t0 = Date.now();
  const r = await getJson(`${GODBOLT}/compiler/${compiler.id}/compile`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      source: code,
      lang: spec.lang,
      options: {
        userArguments: "",
        executeParameters: { args: [], stdin },
        compilerOptions: { executorRequest: true },
        filters: { execute: true },
      },
      ...(ctx.files?.length ? { files: ctx.files.map((f) => ({ filename: f.name, contents: f.code })) } : {}),
    }),
  }, ctx);
  const build = r.buildResult;
  const buildFailed = build && build.code !== 0;
  const internal = r.code === -1 && !r.didExecute;
  return {
    ok: r.code === 0 && !r.timedOut,
    exitCode: r.code ?? null,
    signal: r.timedOut ? "TIMEOUT" : null,
    stdout: lines(r.stdout),
    stderr: buildFailed ? "" : lines(r.stderr),
    compileOutput: buildFailed ? lines(build.stderr) || lines(build.stdout) : "",
    phase: buildFailed || internal ? "compile" : "run",
    provider: "Compiler Explorer",
    version: compiler.name,
    timeMs: r.execTime ?? Date.now() - t0,
  };
}

/* ── Public API ──────────────────────────────────────────────────── */

/**
 * Run `code` in language `id`, trying each configured service in turn.
 * `files` are the other project files ({name, code}) sent alongside the main file for #include, imports and so on.
 * @returns normalized result: {ok, exitCode, signal, stdout, stderr, compileOutput, phase, provider, version, timeMs}
 */
export async function executeRemote(id, code, stdin = "", { fetchImpl = fetch, signal, only, files = [] } = {}) {
  const entry = REMOTE[id];
  if (!entry) throw new Error(`Unsupported language: ${id}`);
  const ctx = { fetchImpl, signal, files };
  // Compiler Explorer answers in milliseconds, so it goes first. With extra project files Wandbox goes first:
  // it writes them next to the main file, which makes #include and imports resolve.
  const godboltAttempt = entry.godbolt && only !== "wandbox" && ["godbolt", () => runGodbolt(entry.godbolt, code, stdin, ctx)];
  const wandboxAttempt = entry.wandbox && only !== "godbolt" && ["wandbox", () => runWandbox(entry.wandbox, code, stdin, ctx)];
  const attempts = (files.length ? [wandboxAttempt, godboltAttempt] : [godboltAttempt, wandboxAttempt]).filter(Boolean);
  if (!attempts.length) throw new Error(`No provider available for ${id}`);

  let lastError;
  for (const [, attempt] of attempts) {
    try { return await attempt(); } catch (e) { if (signal?.aborted) throw e; lastError = e; }
  }
  throw lastError;
}

/** Newest compiler/runtime name per language, for display. Resolves against live provider lists. */
export async function resolveVersions({ fetchImpl = fetch, signal } = {}) {
  const ctx = { fetchImpl, signal, files };
  const out = {};
  await Promise.all(Object.entries(REMOTE).map(async ([id, entry]) => {
    try {
      out[id] = entry.wandbox ? { provider: "Wandbox", version: (await wandboxCompilers(entry.wandbox, ctx))[0] }
        : { provider: "Compiler Explorer", version: (await godboltCompiler(entry.godbolt, ctx)).name };
    } catch { out[id] = null; }
  }));
  return out;
}
