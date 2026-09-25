// Share a snippet without a database: the code is compressed into the URL fragment,
// so the link is self-contained and the fragment is never sent to any server.
const toB64Url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
// Base64url back to bytes.
const fromB64Url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

// Run bytes through a compression stream and collect the result.
async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** Snapshot of a whole project: {files: [{name, code}], active}. */
export async function encodeSnapshot({ files, active }) {
  const json = new TextEncoder().encode(JSON.stringify({ f: files.map((f) => [f.name, f.code]), a: active }));
  return toB64Url(await pipe(json, new CompressionStream("deflate-raw")));
}

// Read a snapshot fragment back into files. Returns null if it is damaged or not ours.
export async function decodeSnapshot(fragment) {
  try {
    const bytes = await pipe(fromB64Url(fragment), new DecompressionStream("deflate-raw"));
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (Array.isArray(data.f)) {
      const files = data.f.filter((x) => typeof x?.[0] === "string" && typeof x?.[1] === "string").map(([name, code]) => ({ name, code }));
      return files.length ? { files, active: typeof data.a === "string" ? data.a : files[0].name } : null;
    }
    // Links made before projects existed: one file and a language id.
    return typeof data.c === "string" ? { files: [{ name: `main.${data.l === "python" ? "py" : data.l === "javascript" ? "js" : "txt"}`, code: data.c }], active: null } : null;
  } catch {
    return null;
  }
}
