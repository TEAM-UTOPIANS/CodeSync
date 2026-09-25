// Turns a set of project files into one HTML document for the live preview, by inlining the
// stylesheets and scripts the page links to (the preview iframe has no file system).
const clean = (href) => href.replace(/^\.?\//, "").split(/[?#]/)[0];
// Stop an inlined script from closing the tag it sits in.
const escapeScript = (s) => s.replace(/<\/script/gi, "<\\/script");

// Inline the CSS and JS files an HTML file links to, so the preview needs no file system.
export function buildPreview(files, entryName) {
  const map = new Map(files.map((f) => [f.name, f.code]));
  let html = map.get(entryName) ?? "";
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
    return href && /stylesheet/i.test(tag) && map.has(clean(href)) ? `<style>${map.get(clean(href))}</style>` : tag;
  });
  html = html.replace(/<script\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (tag, before, src, after) =>
    map.has(clean(src)) ? `<script${`${before}${after}`.trimEnd()}>${escapeScript(map.get(clean(src)))}</script>` : tag);
  return html;
}

/** Which file drives the preview: the open file if it is HTML, else index.html, else the first HTML file. */
export function previewEntry(files, activeName) {
  // Only .html and .htm files can drive a preview.
  const isHtml = (n) => /\.html?$/i.test(n);
  if (isHtml(activeName)) return activeName;
  return files.find((f) => f.name === "index.html")?.name ?? files.find((f) => isHtml(f.name))?.name ?? null;
}
