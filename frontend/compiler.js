/* global require, monaco */

const $ = (id) => document.getElementById(id);

let editor = null;
let model = null;
let theme = localStorage.getItem("codesync:theme") || "dark";

function toast(message, ttl = 2400) {
  const el = document.createElement("div");
  el.className =
    "max-w-sm rounded-2xl px-3 py-2 text-sm border shadow-xl " +
    (theme === "dark" ? "bg-white/10 border-white/10 text-slate-100" : "bg-white/80 border-black/10 text-slate-950");
  el.textContent = message;
  $("toasts").appendChild(el);
  setTimeout(() => el.remove(), ttl);
}

function setTheme(next) {
  theme = next;
  document.body.classList.toggle("dark", next === "dark");
  document.body.classList.toggle("bg-slate-950", next === "dark");
  document.body.classList.toggle("text-slate-100", next === "dark");
  document.body.classList.toggle("bg-slate-50", next !== "dark");
  document.body.classList.toggle("text-slate-950", next !== "dark");
  localStorage.setItem("codesync:theme", next);
  if (editor) monaco.editor.setTheme(next === "dark" ? "codesync-dark" : "vs");
}

function registerMiniLang() {
  monaco.languages.register({ id: "minilang" });
  monaco.languages.setMonarchTokensProvider("minilang", {
    tokenizer: {
      root: [
        [/#.*$/, "comment"],
        [/"/, { token: "string.quote", bracket: "@open", next: "@string" }],
        [/\b(START|STOP|LET|PRINT|IF|THEN|ELSE|END|INPUT)\b/, "keyword"],
        [/[a-zA-Z_]\w*/, "identifier"],
        [/\d+(\.\d+)?/, "number"],
        [/!=|==|<=|>=|[+\-*/<>=()]/, "operator"],
      ],
      string: [
        [/[^\\"]+/, "string"],
        [/\\./, "string.escape"],
        [/"/, { token: "string.quote", bracket: "@close", next: "@pop" }],
      ],
    },
  });
}

function initMonaco() {
  require.config({ paths: { vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs" } });
  require(["vs/editor/editor.main"], () => {
    registerMiniLang();
    monaco.editor.defineTheme("codesync-dark", { base: "vs-dark", inherit: true, rules: [], colors: { "editor.background": "#0b1220" } });
    model = monaco.editor.createModel(
      "START\nLET x = 10\nLET y = 20\nPRINT x + y\nSTOP\n",
      "minilang",
    );
    editor = monaco.editor.create($("editor"), { model, theme: "codesync-dark", automaticLayout: true, minimap: { enabled: true } });
    setTheme(theme);
  });
}

async function run() {
  const btn = $("runBtn");
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Running...";
  btn.classList.add("opacity-70");
  const language = $("languageSelect").value;
  const code = model?.getValue() || "";
  const stdin = $("stdin").value || "";
  $("output").textContent = "";
  try {
    const res = await fetch("/api/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language, code, stdin }),
    });
    const data = await res.json();
    if (!data.ok) {
      $("output").textContent = data.error || "Execution failed";
      toast(data.error || "Execution failed");
      return;
    }
    const out =
      (data.status ? `Status: ${data.status}\n\n` : "") +
      (data.stdout ? `stdout:\n${data.stdout}\n\n` : "") +
      (data.stderr ? `stderr:\n${data.stderr}\n` : "");
    $("output").textContent = out.trim() + "\n";
    toast("Done");
  } catch (e) {
    $("output").textContent = String(e);
    toast(String(e));
  } finally {
    btn.disabled = false;
    btn.textContent = old;
    btn.classList.remove("opacity-70");
  }
}

function boot() {
  setTheme(theme);
  initMonaco();
  $("runBtn").onclick = run;
  $("clearOutputBtn").onclick = () => ($("output").textContent = "");
  $("themeBtn").onclick = () => setTheme(theme === "dark" ? "light" : "dark");
  $("languageSelect").onchange = () => {
    const lang = $("languageSelect").value;
    if (!model) return;
    monaco.editor.setModelLanguage(model, lang === "minilang" ? "minilang" : lang === "cpp" ? "cpp" : lang === "java" ? "java" : "python");
  };
}

boot();

