import { parseFormulaBlocks, executeFormula } from "../engine/formula.js";
import { resolveVariableMap } from "./variablesPanel.js";

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderAbilitiesPanel(container, state, store, addRollLog) {
  const availableVars = Object.keys(resolveVariableMap(state)).sort();
  const variableButtons = availableVars
    .map((name) => `<button type="button" class="mini-btn var-insert" data-insert="$${name}">$${name}</button>`)
    .join("");

  container.innerHTML = `
    <form id="ability-form">
      <div class="row">
        <label>Name <input name="name" required placeholder="Power Attack" /></label>
      </div>
      <label>Description <textarea name="description" placeholder="Optional text."></textarea></label>
      <p class="section-header">Roll Builder</p>
      <div class="row">
        <button type="button" class="mini-btn tpl-insert" data-target="formulaText" data-insert="[[Attack: 1d20 + $str + $prof]]">+ Attack Template</button>
        <button type="button" class="mini-btn tpl-insert" data-target="formulaText" data-insert="[[Damage: 1d8 + $str]]">+ Damage Template</button>
        <button type="button" class="mini-btn tpl-insert" data-target="formulaText" data-insert="[[Check: 1d20 + $level]]">+ Check Template</button>
      </div>
      <div class="row"><span class="muted">Variables:</span>${variableButtons}</div>
      <label>Formulas (use <code>[[Label: expr]]</code>; supports <code>$str</code> and <code>[str]</code>)<textarea name="formulaText" placeholder="[[Attack: 1d20 + $str + $prof]]\n[[Damage: 1d8 + $str]]"></textarea></label>
      <label class="row">
        <input type="checkbox" name="toggleEnabled" />
        Toggle-linked roll formula (optional)
      </label>
      <label>Toggle Formula (single snippet)<input name="toggleFormula" placeholder="[[ExtraDamage: 1d6 + $str]]" /></label>
      <button type="submit">Add Ability</button>
    </form>
    <hr />
    <div id="ability-list"></div>
  `;

  const form = container.querySelector("#ability-form");
  let activeField = form.elements.formulaText;

  function insertText(targetName, text) {
    const el = form.elements[targetName];
    if (!el) return;
    const existing = String(el.value || "");
    const spacer = existing && !existing.endsWith("\n") ? "\n" : "";
    el.value = `${existing}${spacer}${text}`;
    el.focus();
  }

  form.querySelectorAll(".var-insert").forEach((button) => {
    button.addEventListener("click", () => {
      if (!activeField) activeField = form.elements.formulaText;
      const token = button.dataset.insert || "";
      const start = activeField.selectionStart ?? activeField.value.length;
      const end = activeField.selectionEnd ?? start;
      activeField.setRangeText(token, start, end, "end");
      activeField.focus();
    });
  });

  form.querySelectorAll(".tpl-insert").forEach((button) => {
    button.addEventListener("click", () => {
      insertText(button.dataset.target, button.dataset.insert || "");
    });
  });
  form.elements.formulaText.addEventListener("focus", () => {
    activeField = form.elements.formulaText;
  });
  form.elements.toggleFormula.addEventListener("focus", () => {
    activeField = form.elements.toggleFormula;
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const description = String(data.get("description") || "").trim();
    const formulaText = String(data.get("formulaText") || "").trim();
    const toggleEnabled = data.get("toggleEnabled") === "on";
    const toggleFormulaText = String(data.get("toggleFormula") || "").trim();
    const formulas = parseFormulaBlocks(formulaText);
    const toggles = toggleEnabled ? parseFormulaBlocks(toggleFormulaText) : [];
    if (!name || formulas.length === 0) {
      addRollLog("No valid roll blocks found. Use [[Label: expression]].", true);
      return;
    }

    store.patch((draft) => {
      draft.abilities.push({
        id: uid(),
        name,
        description,
        formulas,
        toggles,
        toggleActive: false,
      });
    });
    form.reset();
  });

  const list = container.querySelector("#ability-list");
  list.innerHTML = state.abilities
    .map((ability) => {
      const formulaRows = ability.formulas
        .map(
          (f) =>
            `<div class="formula-chip"><span>${escapeHtml(`[[${f.label}: ${f.expression}]]`)}</span><button type="button" data-roll="${ability.id}" data-label="${f.label}">Roll</button></div>`
        )
        .join("");
      const toggleRows = (ability.toggles || [])
        .map(
          (f) =>
            `<div class="formula-chip"><span>${escapeHtml(`[[${f.label}: ${f.expression}]]`)}</span><button type="button" data-roll-toggle="${ability.id}" data-label="${f.label}">Roll Toggle</button></div>`
        )
        .join("");
      return `
      <article class="ability-item">
        <h3>${escapeHtml(ability.name)}</h3>
        <p class="muted">${escapeHtml(ability.description || "")}</p>
        ${formulaRows}
        ${
          ability.toggles.length
            ? `<label class="row"><input type="checkbox" data-toggle-enable="${ability.id}" ${
                ability.toggleActive ? "checked" : ""
              } /> Enable Toggle Formula</label>${toggleRows}`
            : ""
        }
        <div class="row">
          <button type="button" data-roll-all="${ability.id}">Roll All</button>
          <button type="button" data-del-ability="${ability.id}">Delete</button>
        </div>
      </article>`;
    })
    .join("");

  function getResolver() {
    const vars = resolveVariableMap(store.getState());
    return (name) => vars[name.toLowerCase()];
  }

  function rollFormula(abilityId, label, isToggle) {
    const current = store.getState();
    const ability = current.abilities.find((a) => a.id === abilityId);
    if (!ability) return;
    const source = isToggle ? ability.toggles : ability.formulas;
    const formula = source.find((f) => f.label === label);
    if (!formula) return;
    try {
      const result = executeFormula(formula, getResolver());
      addRollLog(
        {
          name: `${ability.name}: ${result.label}`,
          message: `${result.total} (${result.breakdown.join(", ")})`,
        },
        false
      );
    } catch (err) {
      addRollLog(`${ability.name}: ${formula.label} -> ${err.message}`, true);
    }
  }

  list.querySelectorAll("button[data-roll]").forEach((btn) => {
    btn.addEventListener("click", () => {
      rollFormula(btn.dataset.roll, btn.dataset.label, false);
    });
  });

  list.querySelectorAll("button[data-roll-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      rollFormula(btn.dataset.rollToggle, btn.dataset.label, true);
    });
  });

  list.querySelectorAll("button[data-roll-all]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const abilityId = btn.dataset.rollAll;
      const current = store.getState();
      const ability = current.abilities.find((a) => a.id === abilityId);
      if (!ability) return;
      for (const formula of ability.formulas) rollFormula(abilityId, formula.label, false);
      if (ability.toggleActive) {
        for (const formula of ability.toggles) rollFormula(abilityId, formula.label, true);
      }
    });
  });

  list.querySelectorAll("button[data-del-ability]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.delAbility;
      store.patch((draft) => {
        draft.abilities = draft.abilities.filter((a) => a.id !== id);
      });
    });
  });

  list.querySelectorAll("input[data-toggle-enable]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const id = checkbox.dataset.toggleEnable;
      store.patch((draft) => {
        const ability = draft.abilities.find((a) => a.id === id);
        if (ability) ability.toggleActive = checkbox.checked;
      });
    });
  });
}
