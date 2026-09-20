// Zero-dependency dev server that mirrors vercel.json: static files, rewrites and api/*.js functions.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../public/", import.meta.url));
const apiDir = fileURLToPath(new URL("../api/", import.meta.url));
const port = Number(process.env.PORT) || 3000;
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png" };

// Give Node's req/res the small subset of the Vercel helpers the functions use.
async function callFunction(name, req, res) {
  let handler;
  try { handler = (await import(`${pathToFileURL(join(apiDir, `${name}.js`)).href}?t=${Date.now()}`)).default; }
  catch { res.writeHead(404).end("Not found"); return; }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString();
  req.body = raw && (req.headers["content-type"] || "").includes("json") ? JSON.parse(raw) : raw;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(data)); return res; };
  await handler(req, res);
}

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const api = path.match(/^\/api\/([a-z-]+)$/);
  if (api) return callFunction(api[1], req, res);
  if (/^\/r\/[^/]+\/?$/.test(path) || path === "/play") path = "/room.html";
  if (path === "/") path = "/index.html";
  const file = normalize(join(root, path));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" }).end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  }
}).listen(port, () => console.log(`CodeSync dev server: http://localhost:${port}`));

// Also start the Socket.IO room server on :3001 so rooms work locally (needs `npm run setup` once).
try {
  const { createApp } = await import("../server/index.js");
  const roomPort = Number(process.env.ROOM_PORT) || 3001;
  createApp().http.listen(roomPort, () => console.log(`Room server: http://localhost:${roomPort}`));
} catch {
  console.log("Room server not started. Run `npm run setup` once to install its dependencies.");
}
