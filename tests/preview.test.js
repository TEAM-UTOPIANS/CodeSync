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
