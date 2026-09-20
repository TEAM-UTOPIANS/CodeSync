// Themes: one set of roles (red host, amber editor, green go, blue viewer) on four kinds of enamel.
export const THEMES = [
  { id: "signal", label: "Signal Box", dark: true, swatch: ["#121518", "#f5b83c", "#ef6248"] },
  { id: "enamel", label: "Enamel", dark: false, swatch: ["#e6e9ec", "#8a5a00", "#b8321d"] },
  { id: "nightmail", label: "Night Mail", dark: true, swatch: ["#0a1122", "#ffc45a", "#7db4ff"] },
  { id: "loco", label: "Locomotive", dark: true, swatch: ["#0b1f16", "#f2c14e", "#ff6c4f"] },
];
const LEGACY = { dark: "signal", light: "enamel" };
const key = "codesync:theme";

export function savedPreference() {
  try { return localStorage.getItem(key) || "system"; } catch { return "system"; }
}
export function resolveTheme(pref = savedPreference()) {
  const id = LEGACY[pref] ?? pref;
  if (THEMES.some((t) => t.id === id)) return id;
  return matchMedia("(prefers-color-scheme: light)").matches ? "enamel" : "signal";
}
export function setTheme(pref) {
  try { localStorage.setItem(key, pref); } catch { /* storage unavailable */ }
  const id = resolveTheme(pref);
  document.documentElement.dataset.theme = id;
  document.dispatchEvent(new CustomEvent("themechange", { detail: id }));
  return id;
}

/** Render swatch buttons into `container`. */
export function mountThemePicker(container) {
  const paint = () => container.querySelectorAll(".swatch").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.id === document.documentElement.dataset.theme)));
  for (const t of THEMES) {
    const b = document.createElement("button");
    b.className = "swatch";
    b.dataset.id = t.id;
    b.title = t.label;
    b.setAttribute("aria-label", `${t.label} theme`);
    b.style.cssText = `--a:${t.swatch[0]};--b:${t.swatch[1]};--c:${t.swatch[2]}`;
    b.addEventListener("click", () => { setTheme(t.id); paint(); });
    container.append(b);
  }
  paint();
  document.addEventListener("themechange", paint);
}

/** Build a Monaco theme from the CSS variables of the active enamel. */
export function defineMonacoTheme(monaco) {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  const hex = (c) => c.replace("#", "");
  const dark = THEMES.find((t) => t.id === document.documentElement.dataset.theme)?.dark ?? true;
  monaco.editor.defineTheme("cs-live", {
    base: dark ? "vs-dark" : "vs", inherit: true,
    rules: [
      { token: "comment", foreground: hex(v("--ink-3")), fontStyle: "italic" },
      { token: "keyword", foreground: hex(v("--amber")) },
      { token: "string", foreground: hex(v("--green")) },
      { token: "number", foreground: hex(v("--blue")) },
      { token: "type", foreground: hex(v("--red")) },
      { token: "operator", foreground: hex(v("--ink-2")) },
    ],
    colors: {
      "editor.background": v("--editor-bg"), "editor.foreground": v("--ink"),
      "editorLineNumber.foreground": v("--ink-3"), "editorLineNumber.activeForeground": v("--ink"),
      "editor.lineHighlightBackground": dark ? "#ffffff08" : "#00000006",
      "editor.selectionBackground": v("--amber") + "38", "editorCursor.foreground": v("--amber"),
      "editorIndentGuide.background1": v("--rule-soft"), "editorWidget.background": v("--plate"),
      "scrollbarSlider.background": dark ? "#ffffff14" : "#00000018",
    },
  });
  monaco.editor.setTheme("cs-live");
}
