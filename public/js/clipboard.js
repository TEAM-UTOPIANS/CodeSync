// Copying to the clipboard fails more often than you would think: the Clipboard API rejects when
// the document is not focused, and Safari rejects it once the call is behind an await. So try the
// modern path, then the old textarea trick, and let the caller handle a flat refusal.

/** Copy text. Resolves true when it landed on the clipboard. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* not focused, not permitted, or too late after an await */ }

  try {
    const holder = document.createElement("textarea");
    holder.value = text;
    holder.setAttribute("readonly", "");
    holder.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0";
    document.body.append(holder);
    holder.select();
    const ok = document.execCommand("copy");
    holder.remove();
    return ok;
  } catch {
    return false;
  }
}
