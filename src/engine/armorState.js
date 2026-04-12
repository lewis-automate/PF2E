import { MODIFIER_TYPES } from "./modifiers.js";

export function coerceArmorState(armor) {
  const base = armor && typeof armor === "object" ? armor : {};
  const legacyPotency = Number(base.potencyRune || 0);
  const existingBonuses = Array.isArray(base.bonuses) ? base.bonuses : [];
  const bonuses = existingBonuses.map((b) => ({
    id: String(b?.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`),
    label: String(b?.label || "Armor bonus"),
    bonus: Number(b?.bonus || 0),
    type: MODIFIER_TYPES.includes(String(b?.type || "").toLowerCase()) ? String(b.type).toLowerCase() : "item",
  }));
  if (legacyPotency !== 0 && !bonuses.length) {
    bonuses.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      label: "Potency",
      bonus: legacyPotency,
      type: "item",
    });
  }
  return {
    name: String(base.name || ""),
    group: String(base.group || ""),
    bulk: String(base.bulk || ""),
    acBonus: Number(base.acBonus || 0),
    dexCap: Number.isFinite(Number(base.dexCap)) ? Number(base.dexCap) : 5,
    checkPenalty: Number(base.checkPenalty || 0),
    speedPenalty: Number(base.speedPenalty || 0),
    strengthRequirement: Number(base.strengthRequirement || 0),
    bonuses,
    enchantments: String(base.enchantments || ""),
    modifiers: String(base.modifiers || ""),
    modifierValue: Number(base.modifierValue || 0),
  };
}
