// Four inks on four grounds. Each theme is two colours doing all the work: an ink for everything
// readable and a spot for everything that wants attention. Roles are never told apart by hue, so a
// theme swap can never make a role unreadable.
export const THEMES = [
  { id: "newsprint", label: "Newsprint", dark: false, swatch: ["#e9e8e3", "#e8542f"] },
  { id: "phosphor", label: "Phosphor", dark: true, swatch: ["#07100a", "#35ff9b"] },
  { id: "amber", label: "Amber", dark: true, swatch: ["#120c05", "#ffab1a"] },
  { id: "ink", label: "Ink", dark: true, swatch: ["#0a0a0a", "#ff4b2b"] },
];

// Names from older versions of the site, so a saved setting survives an update.
const LEGACY = {
  cream: "newsprint", light: "newsprint", paper: "newsprint", enamel: "newsprint", bubblegum: "newsprint",
  dark: "ink", midnight: "ink", graphite: "ink", filament: "ink", loco: "ink", signal: "ink",
  ocean: "phosphor", nightmail: "phosphor", cobalt: "phosphor",
};
const KEY = "codesync:theme";
// Is this one of the themes we ship?
const isKnown = (id) => THEMES.some((t) => t.id === id);

// The stored choice: a theme id, or "system" when the visitor never picked one.
export function savedPreference() {
  try { return localStorage.getItem(KEY) || "system"; } catch { return "system"; }
}

// Turn a stored preference into a real theme id, following the system when asked.
export function resolveTheme(pref = savedPreference()) {
  const id = LEGACY[pref] ?? pref;
  if (isKnown(id)) return id;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "ink" : "newsprint";
}

// Save a preference, apply it to the page, and tell the rest of the app.
export function setTheme(pref) {
  try { localStorage.setItem(KEY, pref); } catch { /* storage unavailable */ }
  const id = resolveTheme(pref);
  document.documentElement.dataset.theme = id;
  document.dispatchEvent(new CustomEvent("themechange", { detail: id }));
  return id;
}

// The theme the page is wearing right now.
export function currentTheme() { return document.documentElement.dataset.theme || "newsprint"; }

/** One two-ink chip per theme, in a row. */
export function mountThemePicker(container) {
  // Mark whichever chip matches the active theme.
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
  // Read one CSS custom property off the root element.
  const v = (name) => cs.getPropertyValue(name).trim();
  // Monaco wants colours without the leading hash.
  const hex = (c) => c.replace("#", "");
  const dark = THEMES.find((t) => t.id === currentTheme())?.dark ?? false;
  monaco.editor.defineTheme("codesync", {
    base: dark ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: hex(v("--ink-3")), fontStyle: "italic" },
      { token: "keyword", foreground: hex(v("--spot")) },
      { token: "string", foreground: hex(v("--ink")) },
      { token: "number", foreground: hex(v("--spot")) },
      { token: "type", foreground: hex(v("--ink-2")) },
      { token: "operator", foreground: hex(v("--ink-2")) },
    ],
    colors: {
      "editor.background": v("--code-bg"),
      "editor.foreground": v("--ink"),
      "editorLineNumber.foreground": v("--ink-3"),
      "editorLineNumber.activeForeground": v("--spot"),
      "editor.lineHighlightBackground": dark ? "#ffffff08" : "#00000005",
      "editor.selectionBackground": `${v("--spot")}33`,
      "editorCursor.foreground": v("--spot"),
      "editorIndentGuide.background1": v("--rule-soft"),
      "editorWidget.background": v("--card"),
      "editorWidget.border": v("--rule"),
      "editorSuggestWidget.background": v("--card"),
      "editorHoverWidget.background": v("--card"),
      "scrollbarSlider.background": dark ? "#ffffff12" : "#00000012",
      "scrollbarSlider.hoverBackground": dark ? "#ffffff1f" : "#0000001f",
    },
  });
  monaco.editor.setTheme("codesync");
}
