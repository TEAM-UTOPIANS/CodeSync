// Runs every remote starter template through the real providers and checks the output.
// Usage: node scripts/verify-languages.mjs [id ...]     (network required)
import { LANGUAGES } from "../public/js/languages.js";
import { REMOTE, executeRemote } from "../public/js/providers.js";

const only = process.argv.slice(2);
const ids = Object.keys(REMOTE).filter((id) => !only.length || only.includes(id));
let failed = 0;

// Run one language's starter program on one provider and say whether it behaved.
async function check(id, provider) {
  const lang = LANGUAGES[id];
  try {
    const r = await executeRemote(id, lang.template, lang.stdin, { signal: AbortSignal.timeout(60_000), only: provider });
    const good = r.ok && (id === "sql" ? /Rust/.test(r.stdout) : /Hello, Ada!/.test(r.stdout) && /5 squared is 25/.test(r.stdout));
    console.log(`${good ? "ok  " : "FAIL"} ${id.padEnd(11)} ${provider.padEnd(8)} ${r.version} ${r.timeMs}ms`);
    if (!good) console.log("     ", JSON.stringify({ exit: r.exitCode, out: r.stdout.slice(0, 200), err: r.stderr.slice(0, 300), compile: r.compileOutput.slice(0, 400) }));
    return good;
  } catch (e) {
    console.log(`FAIL ${id.padEnd(11)} ${provider.padEnd(8)} ${e.message}`);
    return false;
  }
}

for (const id of ids) {
  if (!LANGUAGES[id]) { console.log(`MISSING client entry for ${id}`); failed++; continue; }
  for (const provider of ["wandbox", "godbolt"]) {
    const spec = REMOTE[id][provider];
    if (!spec) continue;
    if (!(await check(id, provider))) failed++;
  }
}
console.log(failed ? `\n${failed} check(s) failed` : "\nall templates passed");
process.exit(failed ? 1 : 0);
