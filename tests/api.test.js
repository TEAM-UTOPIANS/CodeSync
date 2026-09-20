import { test } from "node:test";
import assert from "node:assert/strict";
import handler from "../api/execute.js";

async function call({ method = "POST", body, ip = "203.0.113.7" } = {}) {
  const res = {
    headers: {}, statusCode: 200, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  await handler({ method, body, headers: { "x-forwarded-for": ip }, socket: {} }, res);
  return res;
}

test("only POST is allowed", async () => {
  assert.equal((await call({ method: "GET" })).statusCode, 405);
});

test("validates language, code and sizes", async () => {
  assert.equal((await call({ body: { language: "nope", code: "x" } })).statusCode, 400);
  assert.equal((await call({ body: { language: "c", code: "  " } })).statusCode, 400);
  assert.equal((await call({ body: { language: "c", code: "x".repeat(70_000) } })).statusCode, 413);
  assert.equal((await call({ body: { language: "c", code: "x", stdin: "y".repeat(20_000) } })).statusCode, 413);
  assert.equal((await call({ body: "not json" })).statusCode, 400);
});

test("throttles a client that bursts, and reports upstream failure as 502", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("offline"); };
  try {
    const statuses = [];
    for (let i = 0; i < 12; i++) statuses.push((await call({ body: { language: "bash", code: "echo hi" }, ip: "198.51.100.10" })).statusCode);
    assert.ok(statuses.includes(502), `expected a 502 in ${statuses}`);
    assert.ok(statuses.includes(429), `expected a 429 in ${statuses}`);
  } finally {
    globalThis.fetch = original;
  }
});
