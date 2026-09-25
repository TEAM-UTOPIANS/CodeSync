// Four grounds, one meaning. Role hues never swap places: host is warm, editor is mint, viewer is
// periwinkle, in every theme. Only the paper and the accent change.
export const THEMES = [
  { id: "cream", label: "Daylight", dark: false, swatch: ["#f6f7f5", "#2ed3ab"] },
  { id: "midnight", label: "Midnight", dark: true, swatch: ["#1c1e26", "#2ed3ab"] },
  { id: "bubblegum", label: "Bubblegum", dark: false, swatch: ["#fdf7fb", "#ff9ecd"] },
  { id: "ocean", label: "Ocean", dark: true, swatch: ["#132735", "#6fe3ff"] },
];

// Names from older versions of the site, so saved settings survive an update.
const LEGACY = {
  dark: "midnight", light: "cream", signal: "midnight", enamel: "cream",
  graphite: "midnight", paper: "cream", nightmail: "ocean", cobalt: "ocean",
  filament: "midnight", loco: "midnight",
};
const KEY = "codesync:theme";
const isKnown = (id) => THEMES.some((t) => t.id === id);

export function savedPreference() {
  try { return localStorage.getItem(KEY) || "system"; } catch { return "system"; }
}

export function resolveTheme(pref = savedPreference()) {
  const id = LEGACY[pref] ?? pref;
  if (isKnown(id)) return id;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "midnight" : "cream";
}

export function setTheme(pref) {
  try { localStorage.setItem(KEY, pref); } catch { /* storage unavailable */ }
  const id = resolveTheme(pref);
  document.documentElement.dataset.theme = id;
  document.dispatchEvent(new CustomEvent("themechange", { detail: id }));
  return id;
}

export function currentTheme() { return document.documentElement.dataset.theme || "cream"; }

/** One round swatch per theme. */
export function mountThemePicker(container) {
  const paint = () => container.querySelectorAll(".swatch").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.id === currentTheme())));
  for (const t of THEMES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch";
    b.dataset.id = t.id;
    b.title = `${t.label} theme`;
    b.setAttribute("aria-label", `${t.label} theme`);
    b.style.cssText = `--a:${t.swatch[0]};--b:${t.swatch[1]}`;
    b.addEventListener("click", () => setTheme(t.id));
    container.append(b);
  }
  paint();
  document.addEventListener("themechange", paint);
}

/** Build the Monaco theme out of whatever the active theme's CSS variables say. */
export function defineMonacoTheme(monaco) {
  const cs = getComputedStyle(document.documentElement);
  const v = (name) => cs.getPropertyValue(name).trim();
  const hex = (c) => c.replace("#", "");
  const dark = THEMES.find((t) => t.id === currentTheme())?.dark ?? false;
  monaco.editor.defineTheme("codesync", {
    base: dark ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: hex(v("--ink-3")), fontStyle: "italic" },
      { token: "keyword", foreground: hex(v("--accent-text")) },
      { token: "string", foreground: hex(v("--host")) },
      { token: "number", foreground: hex(v("--viewer")) },
      { token: "type", foreground: hex(v("--viewer")) },
      { token: "operator", foreground: hex(v("--ink-2")) },
    ],
    colors: {
      "editor.background": v("--code-bg"),
      "editor.foreground": v("--ink"),
      "editorLineNumber.foreground": v("--ink-3"),
      "editorLineNumber.activeForeground": v("--ink"),
      "editor.lineHighlightBackground": dark ? "#ffffff08" : "#00000005",
      "editor.selectionBackground": `${v("--accent")}44`,
      "editorCursor.foreground": v("--accent-text"),
      "editorIndentGuide.background1": v("--line"),
      "editorWidget.background": v("--card"),
      "editorWidget.border": v("--line"),
      "editorSuggestWidget.background": v("--card"),
      "editorHoverWidget.background": v("--card"),
      "scrollbarSlider.background": dark ? "#ffffff12" : "#00000012",
      "scrollbarSlider.hoverBackground": dark ? "#ffffff1f" : "#0000001f",
    },
  });
  monaco.editor.setTheme("codesync");
}
