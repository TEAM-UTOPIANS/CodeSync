// Small shared UI pieces: toast, language logo tile, anchored menus and the command palette.
import { iconUrl } from "./languages.js";

let toastTimer;
// Flash a short message at the bottom of the screen.
export function toast(message, icon = "ph-check-circle") {
  const el = document.getElementById("toast");
  el.replaceChildren(Object.assign(document.createElement("i"), { className: `ph ${icon}` }), document.createTextNode(message));
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2000);
}

/** Language logo: a Devicon SVG on a light tile, or a two-letter monogram when there is none. */
export function langTile(lang, size = 22) {
  const tile = document.createElement("span");
  tile.className = "lang-tile";
  tile.style.cssText = `width:${size}px;height:${size}px`;
  // No logo for this language, so fall back to its initials.
  const mono = () => { tile.classList.add("mono"); tile.textContent = lang.label.replace(/[^A-Za-z#+]/g, "").slice(0, 2); };
  const url = iconUrl(lang.icon);
  if (!url) { mono(); return tile; }
  const img = new Image();
  img.alt = "";
  img.src = url;
  img.style.cssText = `width:${Math.round(size * 0.68)}px;height:${Math.round(size * 0.68)}px`;
  img.onerror = () => { img.remove(); mono(); };
  tile.append(img);
  return tile;
}

/** Show `menu` under `button`; closes on outside click or Escape. */
export function anchorMenu(button, menu) {
  // Hide the menu and tell the button it is closed.
  const close = () => { menu.hidden = true; button.setAttribute("aria-expanded", "false"); };
  // Close any other menu, then place this one under its button.
  const open = () => {
    for (const other of document.querySelectorAll(".menu")) other.hidden = true;
    const r = button.getBoundingClientRect();
    menu.hidden = false;
    menu.style.top = `${r.bottom + 6}px`;
    menu.style.left = `${Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, r.right - menu.offsetWidth))}px`;
    button.setAttribute("aria-expanded", "true");
  };
  button.addEventListener("click", (e) => { e.stopPropagation(); menu.hidden ? open() : close(); });
  document.addEventListener("click", (e) => { if (!menu.hidden && !menu.contains(e.target)) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !menu.hidden) close(); });
  menu.addEventListener("click", (e) => { if (e.target.closest("button:not(.stepper button)")) close(); });
  return { close };
}

/**
 * Command palette. Items: {title, group?, keywords?, icon?: "ph-…", tile?: () => Element, hint?, run()}.
 * Pass a function to open() so the list is rebuilt from live state each time.
 */
export function createPalette(dialog) {
  const input = dialog.querySelector("input");
  const list = dialog.querySelector(".pal-list");
  let all = [], shown = [], index = 0;

  // Rank one item against the typed words. -1 means it does not match at all.
  const score = (item, terms) => {
    const hay = `${item.title} ${item.group ?? ""} ${item.keywords ?? ""}`.toLowerCase();
    if (!terms.every((t) => hay.includes(t))) return -1;
    const title = item.title.toLowerCase();
    return title === terms.join(" ") ? 3 : title.startsWith(terms[0] ?? "") ? 2 : 1;
  };

  // Redraw the list for the current query, grouped and with the first item selected.
  function render() {
    const terms = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    shown = all.map((item) => [item, score(item, terms)]).filter(([, s]) => s >= 0).sort((a, b) => (terms.length ? b[1] - a[1] : 0)).map(([i]) => i);
    index = Math.min(index, Math.max(0, shown.length - 1));
    list.replaceChildren();
    if (!shown.length) { list.append(Object.assign(document.createElement("li"), { className: "pal-empty", textContent: "Nothing matches that." })); return; }
    let group;
    shown.forEach((item, i) => {
      if (item.group !== group) {
        group = item.group;
        if (group) list.append(Object.assign(document.createElement("li"), { className: "pal-group", role: "presentation", textContent: group }));
      }
      const li = document.createElement("li");
      li.className = "pal-item";
      li.role = "option";
      li.id = `pal-${i}`;
      li.setAttribute("aria-selected", String(i === index));
      const ico = document.createElement("span");
      ico.className = "ico";
      if (item.tile) ico.append(item.tile());
      else if (item.icon) ico.append(Object.assign(document.createElement("i"), { className: `ph ${item.icon}` }));
      const label = Object.assign(document.createElement("span"), { textContent: item.title });
      li.append(ico, label);
      if (item.hint) li.append(Object.assign(document.createElement("span"), { className: "hint", textContent: item.hint }));
      li.addEventListener("mousemove", () => { if (index !== i) { index = i; mark(); } });
      li.addEventListener("click", () => choose(i));
      list.append(li);
    });
    mark();
  }

  // Move the selection highlight without rebuilding the list.
  function mark() {
    list.querySelectorAll(".pal-item").forEach((el, i) => el.setAttribute("aria-selected", String(i === index)));
    input.setAttribute("aria-activedescendant", `pal-${index}`);
    list.querySelector(`#pal-${index}`)?.scrollIntoView({ block: "nearest" });
  }

  // Close the palette first, then run the item, so the action sees a clean page.
  function choose(i) {
    const item = shown[i];
    if (!item) return;
    dialog.close();
    queueMicrotask(() => item.run());
  }

  input.addEventListener("input", () => { index = 0; render(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); index = Math.min(shown.length - 1, index + 1); mark(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); index = Math.max(0, index - 1); mark(); }
    else if (e.key === "Enter") { e.preventDefault(); choose(index); }
  });
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });

  return {
    // Open the palette, building the item list fresh each time.
    open(build, placeholder = "Type a command or a language") {
      all = build();
      input.value = "";
      input.placeholder = placeholder;
      index = 0;
      render();
      if (!dialog.open) dialog.showModal();
      input.focus();
    },
  };
}
