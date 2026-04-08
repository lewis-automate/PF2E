import { rollDiceExpression } from "./roller.js";

export function parseFormulaBlocks(rawText) {
  const matches = [...rawText.matchAll(/\[\[\s*([^:\]]+?)\s*:\s*([\s\S]*?)\]\]/g)];
  return matches.map((m) => ({
    label: m[1].trim(),
    expression: m[2].trim(),
    raw: m[0],
  }));
}

export function evaluateExpression(expression, resolveVar) {
  let replaced = expression.replace(/\[([a-zA-Z_][a-zA-Z0-9_]*)\]/g, (_, varName) => {
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

  if (!/^[0-9dD+\-*/().\s]+$/.test(replaced)) {
    throw new Error("Expression contains unsupported characters.");
  }
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
