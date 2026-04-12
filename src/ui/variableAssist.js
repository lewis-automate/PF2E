function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export { escapeHtml };

export function renderVariableAssist(listId, tokens, targetSelector = "") {
  const options = tokens.map((token) => `<option value="${escapeHtml(token)}"></option>`).join("");
  const shown = tokens.slice(0, 18);
  const chips = shown
    .map(
      (token) =>
        `<button type="button" class="mini-btn variable-chip-btn" data-var-token="${escapeHtml(token)}" data-var-target="${escapeHtml(targetSelector)}">${escapeHtml(token)}</button>`
    )
    .join(" ");
  return {
    listAttr: `list="${escapeHtml(listId)}"`,
    datalistHtml: `<datalist id="${escapeHtml(listId)}">${options}</datalist>`,
    hintHtml: `<div class="muted variable-hint"><span class="variable-help">Click a variable to insert at cursor, or type <code>$</code> then letters. Typed bonus syntax: <code>[circumstance:1]</code>.</span><br />Variables: ${chips || `<code>$level</code>`}${tokens.length > shown.length ? " ..." : ""} <span class="muted">(@ also works)</span></div>`,
  };
}
