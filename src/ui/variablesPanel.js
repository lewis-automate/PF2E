export function resolveVariableMap(state) {
  const vars = {};
  const put = (key, value) => {
    const normalized = String(key || "").trim().toLowerCase();
    if (!normalized) return;
    vars[normalized] = value;
    if (normalized.includes("_")) vars[normalized.replace(/_/g, "-")] = value;
    if (normalized.includes("-")) vars[normalized.replace(/-/g, "_")] = value;
  };

  for (const [k, v] of Object.entries(state.derived.mods || {})) put(k, Number(v || 0));
  put("prof", Number(state.derived.attackBase || 0));
  put("level", Number(state.base.level || 1));
  put("ac", Number(state.derived.defense.ac || 0));
  put("fortitude", Number(state.derived.defense.fortitude || 0));
  put("reflex", Number(state.derived.defense.reflex || 0));
  put("will", Number(state.derived.defense.will || 0));
  put("perception", Number(state.derived.defense.perception || 0));
  put("initiative", Number(state.derived.initiative || 0));
  put("classdc", Number(state.derived.classDc || 0));
  put("speed", Number(state.derived.speed || state.base.baseSpeed || 0));
  put("hp", Number(state.derived.hp.current || 0));
  put("hp_current", Number(state.base.hp?.current || 0));
  put("hp_temp", Number(state.base.hp?.temp || 0));
  put("hp_max", Number(state.derived.hp.max || 0));
  for (const [skill, bonus] of Object.entries(state.derived.skills || {})) put(skill, Number(bonus || 0));

  const primaryAttackWidgetName = String(
    state.weaponWidgets?.["weapon-widget"]?.name ||
      state.weaponWidget?.name ||
      "Attack"
  );
  put("attack_widget_header_name", primaryAttackWidgetName);

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
    resolvedExpr = resolvedExpr.replace(/[$@]([a-zA-Z_][a-zA-Z0-9_-]*)/g, (_m, subVar) => {
      const val = evalUserVar(String(subVar || "").replace(/-/g, "_"));
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
  const builtIns = Object.keys(resolveVariableMap(state) || {})
    .map((k) => String(k || "").toLowerCase().replace(/-/g, "_"))
    .filter(Boolean);
  const suggestions = [...new Set(builtIns)].sort((a, b) => a.localeCompare(b));
  const chips = suggestions
    .slice(0, 18)
    .map((k) => `<button type="button" class="mini-btn variable-chip-btn" data-vp-token="$${k}">$${k}</button>`)
    .join(" ");
  container.innerHTML = `
    <form id="add-var-form" class="row">
      <label>Name <input name="name" required placeholder="rageBonus" /></label>
      <label>Expression <input name="expr" required list="variables-panel-options" placeholder="[str]+2 or $level+2" /></label>
      <button type="submit">Add / Update Variable</button>
    </form>
    <datalist id="variables-panel-options">
      ${suggestions.map((k) => `<option value="$${k}"></option>`).join("")}
    </datalist>
    <div class="muted variable-hint"><span class="variable-help">Click a variable to insert, or type <code>$</code> then letters. Typed bonus syntax: <code>[circumstance:1]</code>.</span><br />Try: ${chips || "<code>$level</code>"}${suggestions.length > 18 ? " ..." : ""}</div>
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
    <p class="muted">Built-ins include stats, saves, all skills (for example: $acrobatics), plus aliases like @attack-widget-header-name.</p>
  `;

  const form = container.querySelector("#add-var-form");
  const exprInput = container.querySelector('input[name="expr"]');
  container.querySelectorAll("button[data-vp-token]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!exprInput) return;
      const token = String(btn.dataset.vpToken || "");
      const value = String(exprInput.value || "");
      const start = Number.isFinite(exprInput.selectionStart) ? exprInput.selectionStart : value.length;
      const end = Number.isFinite(exprInput.selectionEnd) ? exprInput.selectionEnd : start;
      const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
      exprInput.value = next;
      const caret = start + token.length;
      if (typeof exprInput.setSelectionRange === "function") exprInput.setSelectionRange(caret, caret);
      exprInput.focus();
    });
  });
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
