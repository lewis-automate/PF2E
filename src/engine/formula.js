import { rollDiceExpression } from "./roller.js";
import { MODIFIER_TYPES, summarizeModifiers } from "./modifiers.js";

export function parseFormulaBlocks(rawText) {
  const matches = [...rawText.matchAll(/\[\[\s*([^:\]]+?)\s*:\s*([\s\S]*?)\]\]/g)];
  return matches.map((m) => ({
    label: m[1].trim(),
    expression: m[2].trim(),
    raw: m[0],
  }));
}

function resolveNumericInlineTerm(term, resolveVar) {
  let replaced = String(term || "");
  replaced = replaced.replace(/\[([a-zA-Z_][a-zA-Z0-9_]*)\]/g, (_, varName) => {
    const value = resolveVar(varName);
    if (!Number.isFinite(value)) throw new Error(`Unknown or invalid variable: ${varName}`);
    return String(value);
  });
  replaced = replaced.replace(/[$@]([a-zA-Z_][a-zA-Z0-9_-]*)/g, (_, varName) => {
    const value = resolveVar(varName);
    if (!Number.isFinite(value)) throw new Error(`Unknown or invalid variable: ${varName}`);
    return String(value);
  });
  if (!/^[0-9+\-*/().\s]+$/.test(replaced)) {
    throw new Error("Inline typed bonus must be numeric.");
  }
  const value = Number(Function(`"use strict"; return (${replaced || "0"});`)());
  if (!Number.isFinite(value)) throw new Error("Inline typed bonus is invalid.");
  return value;
}

function detectClearTargetFromExpression(expression) {
  const TARGET_BY_VAR = {
    ac: "ac",
    classdc: "classDc",
    class_dc: "classDc",
    fortitude: "fortitude",
    reflex: "reflex",
    will: "will",
    perception: "perception",
    initiative: "initiative",
    speed: "speed",
    attack: "attack",
    atk: "attack",
    damage: "damage",
    dmg: "damage",
    acrobatics: "skill:acrobatics",
    arcana: "skill:arcana",
    athletics: "skill:athletics",
    crafting: "skill:crafting",
    deception: "skill:deception",
    diplomacy: "skill:diplomacy",
    intimidation: "skill:intimidation",
    medicine: "skill:medicine",
    nature: "skill:nature",
    occultism: "skill:occultism",
    performance: "skill:performance",
    religion: "skill:religion",
    society: "skill:society",
    stealth: "skill:stealth",
    survival: "skill:survival",
    thievery: "skill:thievery",
  };
  const tokens = [...String(expression || "").matchAll(/[$@]([a-zA-Z_][a-zA-Z0-9_-]*)/g)]
    .map((m) => String(m[1] || "").toLowerCase().replace(/-/g, "_"));
  const targets = new Set(tokens.map((t) => TARGET_BY_VAR[t]).filter(Boolean));
  if (targets.size !== 1) return null;
  return [...targets][0] || null;
}

function extractInlineTypedBonusTotal(expression, resolveVar, resolveTypedSummary) {
  const rows = [];
  let stripped = String(expression || "").replace(
    /\[\s*([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*([^\]]+?)\s*\]/g,
    (_full, rawType, rawExpr) => {
      const normType = String(rawType || "").toLowerCase();
      const type = MODIFIER_TYPES.includes(normType) ? normType : "untyped";
      const value = resolveNumericInlineTerm(rawExpr, resolveVar);
      rows.push({
        enabled: true,
        target: "all",
        type,
        effect: String(value),
      });
      return "";
    }
  );
  // Also support postfix typed bonuses, e.g. "+1[circumstance]" or "($level+1)[status]".
  stripped = stripped.replace(
    /((?:\([^)\]]+\)|[+\-]?\s*(?:\d+(?:\.\d+)?|[$@][a-zA-Z_][a-zA-Z0-9_-]*)))\s*\[\s*([a-zA-Z_][a-zA-Z0-9_-]*)\s*\]/g,
    (_full, rawExpr, rawType) => {
      const normType = String(rawType || "").toLowerCase();
      const type = MODIFIER_TYPES.includes(normType) ? normType : "untyped";
      const value = resolveNumericInlineTerm(rawExpr, resolveVar);
      rows.push({
        enabled: true,
        target: "all",
        type,
        effect: String(value),
      });
      return "";
    }
  );
  const clearTarget = detectClearTargetFromExpression(stripped);
  if (clearTarget && typeof resolveTypedSummary === "function") {
    const external = resolveTypedSummary(clearTarget) || {};
    for (const [type, value] of Object.entries(external.typedBestBonus || {})) {
      rows.push({ enabled: true, target: "all", type, effect: String(Number(value || 0)) });
    }
    for (const [type, value] of Object.entries(external.typedWorstPenalty || {})) {
      rows.push({ enabled: true, target: "all", type, effect: String(Number(value || 0)) });
    }
    const untyped = Number(external.untypedTotal || 0);
    if (untyped !== 0) rows.push({ enabled: true, target: "all", type: "untyped", effect: String(untyped) });
  }
  const total = summarizeModifiers(rows, "all").total;
  return { stripped, total };
}

export function evaluateExpression(expression, resolveVar, options = {}) {
  const withTyped = extractInlineTypedBonusTotal(
    expression,
    resolveVar,
    options && typeof options.resolveTypedSummary === "function" ? options.resolveTypedSummary : null
  );
  let replaced = withTyped.stripped.replace(/\[([a-zA-Z_][a-zA-Z0-9_]*)\]/g, (_, varName) => {
    const value = resolveVar(varName);
    if (!Number.isFinite(value)) {
      throw new Error(`Unknown or invalid variable: ${varName}`);
    }
    return String(value);
  });
  replaced = replaced.replace(/[$@]([a-zA-Z_][a-zA-Z0-9_-]*)/g, (_, varName) => {
    const value = resolveVar(varName);
    if (!Number.isFinite(value)) {
      throw new Error(`Unknown or invalid variable: ${varName}`);
    }
    return String(value);
  });
  // Support PF2-style damage annotations on numeric terms, e.g. "1[fire]" or "2d6[cold]".
  // These tags are descriptive; they are not part of numeric evaluation.
  replaced = replaced.replace(
    /(\b(?:\d+d\d+|\d+)\b)\s*\[[a-zA-Z][a-zA-Z0-9_\- ,/]*\]/gi,
    "$1"
  );

  if (!/^[0-9dD+\-*/().\s]+$/.test(replaced)) {
    throw new Error("Expression contains unsupported characters.");
  }
  if (withTyped.total) replaced = `${replaced}+${withTyped.total}`;
  return replaced;
}

export function expandTemplate(text, resolveVar) {
  return String(text || "").replace(/[$@]([a-zA-Z_][a-zA-Z0-9_-]*)/g, (full, varName) => {
    const value = resolveVar(varName);
    return value == null ? full : String(value);
  });
}

export function executeFormula(formula, resolveVar) {
  const replaced = evaluateExpression(formula.expression, resolveVar);
  const rollResult = rollDiceExpression(replaced.replace(/[*/()]/g, ""));
  return {
    label: formula.label,
    original: formula.expression,
    resolved: replaced,
    total: rollResult.total,
    breakdown: rollResult.breakdown,
  };
}
