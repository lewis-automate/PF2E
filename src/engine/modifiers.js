export const MODIFIER_TYPES = ["circumstance", "status", "item", "armor", "untyped"];

const TARGET_ALIAS = {
  atk: "attack",
  dmg: "damage",
};

function normalizeTarget(target) {
  const raw = String(target || "").toLowerCase().trim();
  return TARGET_ALIAS[raw] || raw || "all";
}

function targetList(row) {
  if (Array.isArray(row?.targets) && row.targets.length) return row.targets.map(normalizeTarget);
  return [normalizeTarget(row?.target || "all")];
}

export function normalizeModifierType(type) {
  const raw = String(type || "").toLowerCase();
  return MODIFIER_TYPES.includes(raw) ? raw : "untyped";
}

/**
 * PF2e stacking:
 * - typed bonuses: only highest bonus of each type applies
 * - typed penalties: only worst penalty of each type applies
 * - untyped: all stack
 */
export function summarizeModifiers(modifiers = [], target = "all") {
  const rows = Array.isArray(modifiers) ? modifiers : [];
  const want = normalizeTarget(target);
  const typedBestBonus = new Map();
  const typedWorstPenalty = new Map();
  let untypedTotal = 0;

  for (const row of rows) {
    if (!row || row.enabled === false) continue;
    const targets = targetList(row);
    if (!(targets.includes("all") || targets.includes(want))) continue;
    const type = normalizeModifierType(row.type);
    const effectText = String(row.effect ?? row.value ?? "").trim();
    const value = Number(effectText);
    if (!Number.isFinite(value) || value === 0) continue;

    if (type === "untyped") {
      untypedTotal += value;
      continue;
    }

    if (value > 0) {
      const prev = typedBestBonus.get(type);
      if (prev == null || value > prev) typedBestBonus.set(type, value);
    } else {
      const prev = typedWorstPenalty.get(type);
      if (prev == null || value < prev) typedWorstPenalty.set(type, value);
    }
  }

  const typedBonusTotal = [...typedBestBonus.values()].reduce((sum, n) => sum + n, 0);
  const typedPenaltyTotal = [...typedWorstPenalty.values()].reduce((sum, n) => sum + n, 0);
  const total = typedBonusTotal + typedPenaltyTotal + untypedTotal;

  return {
    typedBestBonus: Object.fromEntries(typedBestBonus.entries()),
    typedWorstPenalty: Object.fromEntries(typedWorstPenalty.entries()),
    untypedTotal,
    total,
  };
}

export function explainModifiers(modifiers = [], target = "all") {
  const rows = Array.isArray(modifiers) ? modifiers : [];
  const want = normalizeTarget(target);
  const typedBestBonus = new Map();
  const typedWorstPenalty = new Map();
  const untypedApplied = [];

  for (const row of rows) {
    if (!row || row.enabled === false) continue;
    const targets = targetList(row);
    if (!(targets.includes("all") || targets.includes(want))) continue;
    const type = normalizeModifierType(row.type);
    const effectText = String(row.effect ?? row.value ?? "").trim();
    const value = Number(effectText);
    if (!Number.isFinite(value) || value === 0) continue;

    const payload = {
      id: row.id || "",
      label: String(row.label || "Modifier"),
      effect: value,
      type,
      targets,
      hidden: row.showInOverview === false,
    };

    if (type === "untyped") {
      untypedApplied.push(payload);
      continue;
    }

    if (value > 0) {
      const prev = typedBestBonus.get(type);
      if (!prev || value > prev.effect) typedBestBonus.set(type, payload);
    } else {
      const prev = typedWorstPenalty.get(type);
      if (!prev || value < prev.effect) typedWorstPenalty.set(type, payload);
    }
  }

  const applied = [
    ...typedBestBonus.values(),
    ...typedWorstPenalty.values(),
    ...untypedApplied,
  ];
  const total = applied.reduce((sum, item) => sum + Number(item.effect || 0), 0);
  return { total, applied };
}

export function selectModifierEffects(modifiers = [], target = "all") {
  const rows = Array.isArray(modifiers) ? modifiers : [];
  const want = normalizeTarget(target);
  const typedBestBonus = new Map();
  const typedWorstPenalty = new Map();
  const untyped = [];

  for (const row of rows) {
    if (!row || row.enabled === false) continue;
    const targets = targetList(row);
    if (!(targets.includes("all") || targets.includes(want))) continue;
    const type = normalizeModifierType(row.type);
    const effectText = String(row.effect ?? row.value ?? "").trim();
    if (!effectText) continue;
    const num = Number(effectText);
    const isNumeric = Number.isFinite(num);
    const payload = { effect: effectText, numeric: isNumeric ? num : null };

    if (type === "untyped") {
      untyped.push(payload);
      continue;
    }
    if (!isNumeric) {
      // For non-numeric typed effects, keep first one as fallback.
      if (!typedBestBonus.has(`${type}:text`)) typedBestBonus.set(`${type}:text`, payload);
      continue;
    }
    if (num > 0) {
      const prev = typedBestBonus.get(type);
      if (!prev || num > prev.numeric) typedBestBonus.set(type, payload);
    } else if (num < 0) {
      const prev = typedWorstPenalty.get(type);
      if (!prev || num < prev.numeric) typedWorstPenalty.set(type, payload);
    }
  }

  const picked = [
    ...[...typedBestBonus.entries()].filter(([k]) => !k.endsWith(":text")).map(([, v]) => v.effect),
    ...[...typedWorstPenalty.values()].map((v) => v.effect),
    ...[...typedBestBonus.entries()].filter(([k]) => k.endsWith(":text")).map(([, v]) => v.effect),
    ...untyped.map((v) => v.effect),
  ].filter(Boolean);

  return picked;
}

export function flattenModifierRows(base) {
  const raw =
    base.modifierGroups && typeof base.modifierGroups === "object"
      ? Object.values(base.modifierGroups).flatMap((g) => (Array.isArray(g?.rows) ? g.rows : []))
      : base.modifiers || [];
  return raw.flatMap((row) => {
    if (Array.isArray(row?.effectsBatches) && row.effectsBatches.length) {
      return row.effectsBatches.map((b) => ({
        enabled: row.enabled !== false && b?.enabled !== false,
        targets: Array.isArray(b?.targets) ? b.targets : [b?.target || "all"],
        target: Array.isArray(b?.targets) ? b.targets[0] : b?.target || "all",
        type: b?.type || "untyped",
        effect: b?.effect || "0",
        value: Number(b?.effect || 0),
      }));
    }
    return [row];
  });
}
