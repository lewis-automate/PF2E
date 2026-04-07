function randInt(max) {
  return Math.floor(Math.random() * max) + 1;
}

export function rollDiceExpression(expression) {
  const cleaned = expression.replace(/\s+/g, "");
  const parts = cleaned.match(/[+-]?[^+-]+/g) || [];
  let total = 0;
  const breakdown = [];

  for (const part of parts) {
    const sign = part.startsWith("-") ? -1 : 1;
    const token = part.replace(/^[+-]/, "");
    const diceMatch = token.match(/^(\d*)d(\d+)$/i);

    if (diceMatch) {
      const count = Number(diceMatch[1] || 1);
      const sides = Number(diceMatch[2]);
      if (count <= 0 || sides <= 0) {
        throw new Error(`Invalid dice token: ${part}`);
      }
      const rolls = Array.from({ length: count }, () => randInt(sides));
      const subtotal = rolls.reduce((sum, value) => sum + value, 0) * sign;
      total += subtotal;
      breakdown.push(`${part} => [${rolls.join(",")}]`);
    } else {
      const num = Number(token);
      if (!Number.isFinite(num)) {
        throw new Error(`Invalid numeric token: ${part}`);
      }
      total += sign * num;
      breakdown.push(part);
    }
  }

  return { total, breakdown };
}
