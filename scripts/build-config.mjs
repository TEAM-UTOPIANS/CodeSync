// Vercel build step: write public/config.js so the static frontend knows where the Socket.IO server is.
// Set SOCKET_URL (for example https://codesync-server.onrender.com) in the Vercel project settings.
import { writeFileSync } from "node:fs";

const url = (process.env.SOCKET_URL || "").trim().replace(/\/$/, "");
if (url && !/^https?:\/\//.test(url)) throw new Error("SOCKET_URL must start with http:// or https://");
writeFileSync(new URL("../public/config.js", import.meta.url), `window.CODESYNC = ${JSON.stringify({ socketUrl: url })};\n`);
console.log(url ? `Room server: ${url}` : "SOCKET_URL is not set: rooms will be unavailable until it is.");
