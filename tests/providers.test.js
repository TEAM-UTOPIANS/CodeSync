import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { executeRemote, clearProviderCache, REMOTE } from "../public/js/providers.js";
import { LANGUAGES } from "../public/js/languages.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const ESC = String.fromCharCode(27);
beforeEach(clearProviderCache);

test("catalog and provider mapping agree", () => {
  const remoteInCatalog = Object.values(LANGUAGES).filter((l) => l.runtime === "remote").map((l) => l.id).sort();
  assert.deepEqual(Object.keys(REMOTE).sort(), remoteInCatalog);
});

test("every language has a template, editor mode, label and group", () => {
  for (const l of Object.values(LANGUAGES)) {
    assert.ok(l.template.trim(), `${l.id} template`);
    assert.ok(l.monaco && l.label && l.group, l.id);
  }
});

test("wandbox: picks the newest matching compiler and normalizes a run", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([String(url), init?.body && JSON.parse(init.body)]);
    if (String(url).endsWith("list.json")) {
      return json([
        { name: "gcc-12.3.0", language: "C++" }, { name: "gcc-13.2.0", language: "C++" },
        { name: "gcc-head", language: "C++" }, { name: "clang-14.0.6", language: "C++" },
      ]);
    }
    return json({ status: "0", program_output: "hi\n", program_error: "", compiler_error: "" });
  };
  const r = await executeRemote("cpp", "int main(){}", "", { fetchImpl, only: "wandbox" });
  assert.equal(r.ok, true);
  assert.equal(r.stdout, "hi\n");
  assert.equal(r.provider, "Wandbox");
  assert.equal(r.version, "gcc-13.2.0");
  assert.equal(calls.at(-1)[1].compiler, "gcc-13.2.0");
});

test("wandbox: reports compile errors", async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith("list.json")) return json([{ name: "ghc-9.10.1", language: "Haskell" }]);
    return json({ status: "1", compiler_error: "prog.hs:1:1: error: parse error", program_output: "", program_error: "" });
  };
  const r = await executeRemote("haskell", "x", "", { fetchImpl, only: "wandbox" });
  assert.equal(r.ok, false);
  assert.equal(r.phase, "compile");
  assert.match(r.compileOutput, /parse error/);
});

test("wandbox: skips a broken toolchain and uses the next compiler", async () => {
  const used = [];
  const fetchImpl = async (url, init) => {
    if (String(url).endsWith("list.json")) return json([{ name: "zig-0.13.0", language: "Zig" }, { name: "zig-0.9.1", language: "Zig" }]);
    const { compiler } = JSON.parse(init.body);
    used.push(compiler);
    if (compiler === "zig-0.13.0") return json({ status: "127", compiler_error: "/opt/zig: error while loading shared libraries: libx.so\n", program_output: "", program_error: "" });
    return json({ status: "0", program_output: "ok\n" });
  };
  const r = await executeRemote("zig", "x", "", { fetchImpl });
  assert.deepEqual(used, ["zig-0.13.0", "zig-0.9.1"]);
  assert.equal(r.ok, true);
});

test("compiler explorer: newest by semver, ANSI colours stripped", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("/compilers/")) {
      return json([{ id: "cg95", name: "gcc 9.5", semver: "9.5" }, { id: "cg1610", name: "gcc 16.10", semver: "16.10" }, { id: "cg162", name: "gcc 16.2", semver: "16.2" }]);
    }
    return json({ code: 1, stdout: [], stderr: [], didExecute: false, buildResult: { code: 1, stdout: [], stderr: [{ text: `${ESC}[01mfile.c:1:1: ${ESC}[31merror${ESC}[m: bad` }] } });
  };
  const r = await executeRemote("c", "x", "", { fetchImpl, only: "godbolt" });
  assert.equal(r.version, "gcc 16.10");
  assert.equal(r.phase, "compile");
  assert.equal(r.compileOutput, "file.c:1:1: error: bad");
});

test("falls back to the other provider when the first fails", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("godbolt.org")) throw new Error("network down");
    if (String(url).endsWith("list.json")) return json([{ name: "gcc-13.2.0-c", language: "C" }]);
    return json({ status: "0", program_output: "ok" });
  };
  const r = await executeRemote("c", "int main(){}", "", { fetchImpl });
  assert.equal(r.provider, "Wandbox");
});

test("rejects unknown languages", async () => {
  await assert.rejects(() => executeRemote("brainfudge", "+", "", { fetchImpl: async () => json({}) }), /Unsupported/);
});

test("extra project files are sent to Wandbox as codes", async () => {
  let body;
  const fetchImpl = async (url, init) => {
    if (String(url).endsWith("list.json")) return json([{ name: "gcc-13.2.0-c", language: "C" }]);
    body = JSON.parse(init.body);
    return json({ status: "0", program_output: "ok" });
  };
  await executeRemote("c", "int main(){}", "", { fetchImpl, files: [{ name: "util.h", code: "#define X 1" }] });
  assert.deepEqual(body.codes, [{ file: "util.h", code: "#define X 1" }]);
  assert.match(body["compiler-option-raw"], /-I\./);
});
