// POST /api/execute  {language, code, stdin?}  ->  normalized run result.
// Thin, validated proxy in front of the free compiler services. Running it server-side gives
// input limits, per-IP throttling and one stable response shape for the client.
import { executeRemote, REMOTE } from "../public/js/providers.js";

const MAX_CODE = 64 * 1024;
const MAX_STDIN = 16 * 1024;
const MAX_OUTPUT = 100 * 1024;
const TIMEOUT_MS = 55_000;

// Best-effort token bucket. Serverless instances do not share memory, so this only
// blunts bursts from a single client. The upstream services enforce their own limits.
const buckets = new Map();
// A token bucket per client. Serverless instances do not share memory, so this only blunts bursts.
function allow(ip, { rate = 0.5, burst = 6 } = {}) {
  const now = Date.now();
  const b = buckets.get(ip) ?? { tokens: burst, at: now };
  b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 1000) * rate);
  b.at = now;
  if (buckets.size > 5000) buckets.clear();
  if (b.tokens < 1) { buckets.set(ip, b); return false; }
  b.tokens -= 1;
  buckets.set(ip, b);
  return true;
}

// Keep a response small enough to be worth sending.
const clip = (s) => (s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + "\n... output truncated" : s);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body;
  const { language, code, stdin = "", files = [] } = body ?? {};
  if (typeof language !== "string" || !(language in REMOTE)) return res.status(400).json({ error: "Unsupported language." });
  if (typeof code !== "string" || !code.trim()) return res.status(400).json({ error: "No code to run." });
  if (code.length > MAX_CODE) return res.status(413).json({ error: `Code is larger than ${MAX_CODE / 1024} KB.` });
  if (typeof stdin !== "string" || stdin.length > MAX_STDIN) return res.status(413).json({ error: `Input is larger than ${MAX_STDIN / 1024} KB.` });

  if (!Array.isArray(files) || files.length > 12
    || files.some((f) => typeof f?.name !== "string" || !/^[\w][\w .-]{0,59}$/.test(f.name) || typeof f.code !== "string")
    || files.reduce((n, f) => n + f.code.length, 0) > MAX_CODE * 2) {
    return res.status(400).json({ error: "Invalid project files." });
  }

  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  if (!allow(ip)) {
    res.setHeader("Retry-After", "5");
    return res.status(429).json({ error: "Too many runs. Wait a few seconds." });
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const result = await executeRemote(language, code, stdin, { signal: ctrl.signal, files });
    return res.status(200).json({ ...result, stdout: clip(result.stdout), stderr: clip(result.stderr), compileOutput: clip(result.compileOutput) });
  } catch (e) {
    const timedOut = ctrl.signal.aborted;
    return res.status(timedOut ? 504 : 502).json({ error: timedOut ? "The compiler service took too long." : "The compiler services are unavailable right now. Try again shortly." });
  } finally {
    clearTimeout(timer);
  }
}

// Parse a JSON body without throwing on rubbish.
function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
