import { selectModifierEffects } from "./modifiers.js";

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

function selectedTypedToggleEffects(widget) {
  const rows = activeToggles(widget).map((t) => ({
    enabled: true,
    target: "damage",
    type: String(t.type || "untyped"),
    effect: String(t.formula || "").trim(),
  }));
  return selectModifierEffects(rows, "damage");
}

function toggleCritTerms(widget) {
  const chosen = selectedTypedToggleEffects(widget);
  return chosen.map((expr) => {
    const text = String(expr || "").trim();
    if (!text) return "";
    const row = activeToggles(widget).find((t) => String(t.formula || "").trim() === text);
    const shouldDouble = row ? row.multiplyOnCrit !== false : true;
    if (!shouldDouble) return text;
    return `${text}+${text}`;
  });
}

function toggleHitTerms(widget) {
  return selectedTypedToggleEffects(widget).map((expr) => {
    const t = String(expr || "").trim();
    if (!t) return "";
    return t;
  });
}

export function buildWeaponHitFormula(widget, abilityMod = 0) {
  const base = String(widget.damages?.[0]?.formula ?? "1d6").trim() || "1d6";
  return mergeTerms(base, [...toggleHitTerms(widget), abilityMod ? String(abilityMod) : ""]);
}

export function buildWeaponCritFormula(widget, abilityMod = 0) {
  const base = String(widget.damages?.[0]?.formula ?? "1d6").trim() || "1d6";
  const critToggleTerms = toggleCritTerms(widget);
  const critRow = widget.damages?.[1];
  const manual = String(critRow?.formula ?? "").trim() || base;
  const critAbility = abilityMod ? abilityMod * 2 : 0;
  return mergeTerms(manual, [...critToggleTerms, critAbility ? String(critAbility) : ""]);
}
