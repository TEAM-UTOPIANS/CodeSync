import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../public/js/minilang.js";

const ok = (src, stdin = "") => {
  const r = run(src, { stdin });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  return r.stdout;
};
const fails = (src, type, opts) => {
  const r = run(src, opts);
  assert.equal(r.ok, false);
  assert.equal(r.error.type, type, r.error.message);
  return r;
};

test("arithmetic and string concatenation", () => {
  assert.equal(ok('START\nLET x = 10\nLET y = 20\nPRINT "Sum: " + (x + y)\nSTOP'), "Sum: 30");
  assert.equal(ok("START\nPRINT 2 + 3 * 4\nPRINT (2 + 3) * 4\nPRINT -5 + 2\nSTOP"), "14\n20\n-3");
});

test("string escapes", () => {
  assert.equal(ok('START\nPRINT "a\\tb\\n\\"c\\"\\\\"\nSTOP'), 'a\tb\n"c"\\');
});

test("if / else and comparisons", () => {
  const src = (a, b) => `START\nLET a = ${a}\nLET b = ${b}\nIF a < b THEN\nPRINT "lt"\nELSE\nPRINT "ge"\nEND\nSTOP`;
  assert.equal(ok(src(1, 2)), "lt");
  assert.equal(ok(src(2, 2)), "ge");
  assert.equal(ok('START\nIF "a" == "a" THEN PRINT "eq" END\nSTOP'), "eq");
  assert.equal(ok("START\nIF 1 != 2 THEN PRINT \"ne\" END\nSTOP"), "ne");
});

test("keywords are case-insensitive, comments ignored", () => {
  assert.equal(ok("start\n# hi\nlet x = 1 # trailing\nprint x\nstop"), "1");
});

test("INPUT parses numbers, keeps strings", () => {
  assert.equal(ok("START\nINPUT a\nINPUT b\nPRINT a + b\nSTOP", "3\n4"), "7");
  assert.equal(ok('START\nINPUT a\nPRINT "hi " + a\nSTOP', "bob"), "hi bob");
});

test("INPUT with no stdin reports waiting, keeps partial output", () => {
  const r = run('START\nPRINT "n?"\nINPUT n\nPRINT n\nSTOP');
  assert.equal(r.status, "WAITING_FOR_INPUT");
  assert.equal(r.inputVar, "n");
  assert.equal(r.stdout, "n?");
});

test("runtime errors carry position", () => {
  const r = fails("START\nLET x = 10\nLET y = 0\nLET z = x / y\nSTOP", "RuntimeError");
  assert.equal(r.error.line, 4);
  assert.match(r.error.message, /Division by zero/);
});

test("step limit stops runaway programs", () => {
  const src = "START\n" + "PRINT 1\n".repeat(200) + "STOP";
  fails(src, "RuntimeError", { stepLimit: 100 });
});

test("semantic errors", () => {
  fails("START\nPRINT nope\nSTOP", "SemanticError");
  fails('START\nLET x = "a" * 2\nSTOP', "SemanticError");
  fails('START\nIF "a" < 1 THEN PRINT 1 END\nSTOP', "SemanticError");
  fails('START\nIF "a" == 1 THEN PRINT 1 END\nSTOP', "SemanticError");
});

test("parse and lex errors", () => {
  fails("PRINT 1", "ParseError");
  fails("START\nPRINT 1", "ParseError");
  fails("START\nSTOP\nPRINT 1", "ParseError");
  fails("START\nLET = 1\nSTOP", "ParseError");
  fails("START\nIF 1 THEN PRINT 1 END\nSTOP", "ParseError");
  fails('START\nPRINT "oops\nSTOP', "LexError");
  fails("START\nPRINT 1 @ 2\nSTOP", "LexError");
  fails("START\nPRINT 1.\nSTOP", "LexError");
});

test("deeply nested input does not crash the host", () => {
  const r = run("START\nPRINT " + "(".repeat(50000) + "1" + ")".repeat(50000) + "\nSTOP");
  assert.equal(r.ok, false);
});
