// Split-flap display: every character cell flips through a few letters before it settles.
const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+#/ ";

export function createFlapBoard(container, width = 14) {
  const cells = Array.from({ length: width }, () => {
    const c = document.createElement("span");
    c.className = "flap gap";
    container.append(c);
    return c;
  });
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const timers = new Set();

  function settle(cell, ch) {
    cell.textContent = ch.trim() ? ch : "";
    cell.classList.toggle("gap", !ch.trim());
  }
  function flipTo(cell, target, delay) {
    const t0 = setTimeout(() => {
      timers.delete(t0);
      if (reduce) return settle(cell, target);
      let steps = 4 + Math.floor(Math.random() * 4);
      const tick = () => {
        if (steps-- <= 0) { settle(cell, target); cell.classList.remove("tick"); void cell.offsetWidth; cell.classList.add("tick"); return; }
        settle(cell, CHARSET[Math.floor(Math.random() * (CHARSET.length - 1))]);
        cell.classList.remove("tick"); void cell.offsetWidth; cell.classList.add("tick");
        const t = setTimeout(() => { timers.delete(t); tick(); }, 60);
        timers.add(t);
      };
      tick();
    }, delay);
    timers.add(t0);
  }
  return {
    show(text) {
      const label = text.toUpperCase().slice(0, width).padEnd(width, " ");
      [...label].forEach((ch, i) => flipTo(cells[i], ch, i * 45));
    },
    stop() { timers.forEach(clearTimeout); timers.clear(); },
  };
}
