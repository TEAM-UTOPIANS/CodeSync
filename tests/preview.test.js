import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPreview, previewEntry } from "../public/js/preview.js";

const files = [
  { name: "index.html", code: '<link rel="stylesheet" href="style.css"><body><script src="./app.js"></script><script src="https://cdn/x.js"></script></body>' },
  { name: "style.css", code: "body{color:red}" },
  { name: "app.js", code: "console.log('</script>')" },
];

test("inlines linked stylesheets and scripts, leaves external ones", () => {
  const html = buildPreview(files, "index.html");
  assert.match(html, /<style>body\{color:red\}<\/style>/);
  assert.match(html, /<script>console\.log\('<\\\/script>'\)<\/script>/);
  assert.match(html, /src="https:\/\/cdn\/x\.js"/);
});

test("picks the preview entry", () => {
  assert.equal(previewEntry(files, "style.css"), "index.html");
  assert.equal(previewEntry([{ name: "about.html", code: "" }], "app.js"), "about.html");
  assert.equal(previewEntry(files, "about.html"), "about.html");
  assert.equal(previewEntry([{ name: "a.py", code: "" }], "a.py"), null);
});

// Asking a local program for another line means replaying it, so the transcript must not repeat
// what the visitor already saw.
import { visiblePart } from "../public/js/runners.js";

test("replayed output only shows the part that is new", () => {
  // Nothing shown yet: everything is new.
  assert.equal(visiblePart(0, 0, "name? "), "name? ");
  // Six characters already on screen, and this attempt reprints them first.
  assert.equal(visiblePart(6, 0, "name? age? "), "age? ");
  // A chunk entirely inside what was already shown prints nothing.
  assert.equal(visiblePart(11, 0, "name? "), "");
  // A chunk that starts after the shown prefix prints in full.
  assert.equal(visiblePart(6, 6, "age? "), "age? ");
  // Partial overlap across two chunks.
  assert.equal(visiblePart(8, 6, "age? "), "e? ");
});
