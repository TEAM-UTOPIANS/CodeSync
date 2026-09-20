// Share a snippet without a database: the code is compressed into the URL fragment,
// so the link is self-contained and the fragment is never sent to any server.
const toB64Url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64Url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function encodeSnapshot({ lang, code }) {
  const json = new TextEncoder().encode(JSON.stringify({ l: lang, c: code }));
  return toB64Url(await pipe(json, new CompressionStream("deflate-raw")));
}

export async function decodeSnapshot(fragment) {
  try {
    const bytes = await pipe(fromB64Url(fragment), new DecompressionStream("deflate-raw"));
    const { l, c } = JSON.parse(new TextDecoder().decode(bytes));
    return typeof c === "string" ? { lang: String(l), code: c } : null;
  } catch {
    return null;
  }
}
