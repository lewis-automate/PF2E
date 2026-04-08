/** PF2e-oriented helpers for weapon hit/crit damage strings (dice + flat). */

function mergeTerms(base, extras) {
  const parts = [];
  const b = String(base ?? "").trim().replace(/^\+/, "");
  if (b) parts.push(b);
  for (const e of extras) {
    const t = String(e ?? "").trim().replace(/^\+/, "");
    if (t) parts.push(t);
  }
  return parts.join("+") || "0";
}

function activeToggles(widget) {
  return (widget.damageToggles || []).filter((t) => t.alwaysOn || t.on);
}

function toggleCritTerms(widget) {
  return activeToggles(widget).map((t) => {
    const expr = String(t.formula || "").trim();
    if (!expr) return "";
    return t.multiplyOnCrit === false ? expr : `${expr}+${expr}`;
  });
}

export function buildWeaponHitFormula(widget, abilityMod = 0) {
  const base = String(widget.damages?.[0]?.formula ?? "1d6").trim() || "1d6";
  return mergeTerms(
    base,
    [...activeToggles(widget).map((t) => t.formula), abilityMod ? String(abilityMod) : ""]
  );
}

export function buildWeaponCritFormula(widget, abilityMod = 0) {
  const base = String(widget.damages?.[0]?.formula ?? "1d6").trim() || "1d6";
  const critToggleTerms = toggleCritTerms(widget);
  const critRow = widget.damages?.[1];
  const manual = String(critRow?.formula ?? "").trim() || base;
  const critAbility = abilityMod ? abilityMod * 2 : 0;
  return mergeTerms(manual, [...critToggleTerms, critAbility ? String(critAbility) : ""]);
}
