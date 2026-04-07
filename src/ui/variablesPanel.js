export function resolveVariableMap(state) {
  const vars = {
    ...state.derived.mods,
    prof: state.derived.attackBase,
    level: state.base.level,
    ac: state.derived.defense.ac,
    fortitude: state.derived.defense.fortitude,
    reflex: state.derived.defense.reflex,
    will: state.derived.defense.will,
    perception: state.derived.defense.perception,
    classdc: state.derived.classDc,
    hp: state.derived.hp.current,
  };

  const visited = new Set();
  const stack = new Set();

  function evalUserVar(key) {
    if (Object.prototype.hasOwnProperty.call(vars, key)) return vars[key];
    const source = state.variables[key];
    if (!source) return NaN;
    if (stack.has(key)) throw new Error(`Circular variable reference: ${key}`);
    if (visited.has(key)) return vars[key];
    stack.add(key);
    let resolvedExpr = source.replace(/\[([a-zA-Z_][a-zA-Z0-9_]*)\]/g, (_m, subVar) => {
      const val = evalUserVar(subVar);
      if (!Number.isFinite(val)) throw new Error(`Unknown variable: ${subVar}`);
      return String(val);
    });
    resolvedExpr = resolvedExpr.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (_m, subVar) => {
      const val = evalUserVar(subVar);
      if (!Number.isFinite(val)) throw new Error(`Unknown variable: ${subVar}`);
      return String(val);
    });
    if (!/^[0-9+\-*/().\s]+$/.test(resolvedExpr)) throw new Error(`Invalid expression in ${key}`);
    const value = Function(`"use strict"; return (${resolvedExpr});`)();
    vars[key] = Number(value);
    visited.add(key);
    stack.delete(key);
    return vars[key];
  }

  for (const key of Object.keys(state.variables)) {
    evalUserVar(key);
  }
  return vars;
}

export function renderVariablesPanel(container, state, store) {
  const entries = Object.entries(state.variables);
  container.innerHTML = `
    <form id="add-var-form" class="row">
      <label>Name <input name="name" required placeholder="rageBonus" /></label>
      <label>Expression <input name="expr" required placeholder="[str]+2" /></label>
      <button type="submit">Add / Update Variable</button>
    </form>
    <div>
      ${entries
        .map(
          ([name, expr]) => `
            <div class="formula-chip">
              <span><strong>${name}</strong> = ${expr}</span>
              <button data-del-var="${name}" type="button">Delete</button>
            </div>
          `
        )
        .join("")}
    </div>
    <p class="muted">Built-ins include: $str $dex $con $int $wis $cha $prof $level $ac $fortitude $reflex $will $perception $classdc $hp</p>
  `;

  const form = container.querySelector("#add-var-form");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim().toLowerCase();
    const expr = String(data.get("expr") || "").trim();
    if (!name || !expr) return;
    store.patch((draft) => {
      draft.variables[name] = expr;
    });
    form.reset();
  });

  container.querySelectorAll("button[data-del-var]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      const name = event.currentTarget.dataset.delVar;
      store.patch((draft) => {
        delete draft.variables[name];
      });
    });
  });
}
