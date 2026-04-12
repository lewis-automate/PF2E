import { SKILL_TO_ABILITY, WEAPON_TYPES, ARMOR_TYPES, CLASS_DC_KEY_OPTIONS } from "../engine/calc.js";
import { MODIFIER_TYPES, flattenModifierRows, summarizeModifiers } from "../engine/modifiers.js";
import { coerceArmorState } from "../engine/armorState.js";
import { evaluateExpression } from "../engine/formula.js";
import { resolveVariableMap, listAvailableVariableTokens } from "./variablesPanel.js";
import { renderVariableAssist, escapeHtml } from "./variableAssist.js";

const PROF_OPTIONS = ["untrained", "trained", "expert", "master", "legendary"];
const SKILL_KEYS = Object.keys(SKILL_TO_ABILITY);
const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const WEAPON_KEYS = WEAPON_TYPES.map((type) => `weapon_${type}`);
const ARMOR_KEYS = ARMOR_TYPES.map((type) => `armor_${type}`);

function renderProfSelect(base, key, label) {
  const options = PROF_OPTIONS.map((o) => {
    const selected = (base.proficiencies[key] || "untrained") === o ? "selected" : "";
    return `<option value="${o}" ${selected}>${o}</option>`;
  }).join("");
  return `<label>${label}<select data-type="prof" data-key="${key}">${options}</select></label>`;
}

function renderAbilitySelect(value, attrs = "") {
  const selected = ABILITIES.includes(value) ? value : "str";
  return `<select ${attrs}>${ABILITIES.map(
    (a) => `<option value="${a}" ${selected === a ? "selected" : ""}>${a.toUpperCase()}</option>`
  ).join("")}</select>`;
}

export function renderBasePanel(container, state, store) {
  const { base } = state;
  const custom = base.customProficiencies || { core: [], skill: [] };
  const health = base.health || {};
  const speedChanges = Array.isArray(base.speedChanges) ? base.speedChanges : [];

  const statsInputs = ABILITIES.map(
    (k) =>
      `<label>${k.toUpperCase()} <input class="ability-score-input" data-type="stat" data-key="${k}" type="number" value="${base.stats[k]}" /></label>`
  ).join("");

  const weaponInputs = WEAPON_KEYS.map((k) =>
    renderProfSelect(base, k, k.replace("weapon_", ""))
  ).join("");
  const armorInputs = ARMOR_KEYS.map((k) => renderProfSelect(base, k, k.replace("armor_", ""))).join("");
  const armor = coerceArmorState(base.armor);
  const variableTokens = listAvailableVariableTokens(state);
  const armorVarAssist = renderVariableAssist("armor-variable-options-base", variableTokens, '#base-panel input[data-armor-field="modifiers"]');
  const armorBonusRows = (armor.bonuses || [])
    .map(
      (b) => `
        <div class="weapon-bonus-row">
          <label>Label <input data-armor-bonus-id="${b.id}" data-armor-bonus-field="label" value="${escapeHtml(b.label)}" /></label>
          <label>Bonus <input data-armor-bonus-id="${b.id}" data-armor-bonus-field="bonus" type="number" value="${Number(b.bonus || 0)}" /></label>
          <label>Type
            <select data-armor-bonus-id="${b.id}" data-armor-bonus-field="type">
              ${MODIFIER_TYPES.map((type) => `<option value="${type}" ${String(b.type || "item") === type ? "selected" : ""}>${type}</option>`).join("")}
            </select>
          </label>
          <button type="button" class="weapon-del-toggle-btn" data-armor-del-bonus="${escapeHtml(b.id)}">Remove</button>
        </div>
      `
    )
    .join("");
  const favList = Array.isArray(base.favoriteSkills) ? base.favoriteSkills : [];
  const isSkillFavorite = (ref) => favList.includes(ref);
  const skillProfInputs = SKILL_KEYS.map((k) => {
    const ability = base.skillAbilityOverrides?.[k] || SKILL_TO_ABILITY[k] || "str";
    const fav = isSkillFavorite(k);
    return `<div class="row custom-prof-row">
      <button type="button" class="skill-favorite-btn" data-type="skill-favorite-toggle" data-skill-ref="${k}" aria-pressed="${fav ? "true" : "false"}" title="Favorite">${fav ? "★" : "☆"}</button>
      ${renderProfSelect(base, k, k)}
      <label>ability ${renderAbilitySelect(ability, `data-type="skill-ability" data-key="${k}"`)}</label>
    </div>`;
  }).join("");
  const customCoreRows = (custom.core || [])
    .map(
      (entry) => `
      <div class="row custom-prof-row">
        <input data-type="custom-prof-name" data-category="core" data-id="${entry.id}" value="${entry.name || ""}" placeholder="name" />
        <select data-type="custom-prof-rank" data-category="core" data-id="${entry.id}">
          ${PROF_OPTIONS.map((o) => `<option value="${o}" ${(entry.rank || "untrained") === o ? "selected" : ""}>${o}</option>`).join("")}
        </select>
        <button type="button" data-type="custom-prof-del" data-category="core" data-id="${entry.id}">X</button>
      </div>
    `
    )
    .join("");
  const classDcKey = base.classDcKey || "maxStrDexIntWis";
  const classDcKeySelect = `<label>Class DC ability
    <select data-type="class-dc-key">
      ${CLASS_DC_KEY_OPTIONS.map(
        (o) => `<option value="${o.value}" ${classDcKey === o.value ? "selected" : ""}>${o.label}</option>`
      ).join("")}
    </select>
  </label>`;

  const customSkillRows = (custom.skill || [])
    .map(
      (entry) => {
        const ref = `custom:${entry.id}`;
        const fav = isSkillFavorite(ref);
        return `
      <div class="row custom-prof-row">
        <button type="button" class="skill-favorite-btn" data-type="skill-favorite-toggle" data-skill-ref="${ref}" aria-pressed="${fav ? "true" : "false"}" title="Favorite">${fav ? "★" : "☆"}</button>
        <input data-type="custom-prof-name" data-category="skill" data-id="${entry.id}" value="${entry.name || ""}" placeholder="name" />
        <select data-type="custom-prof-rank" data-category="skill" data-id="${entry.id}">
          ${PROF_OPTIONS.map((o) => `<option value="${o}" ${(entry.rank || "untrained") === o ? "selected" : ""}>${o}</option>`).join("")}
        </select>
        <label>ability ${renderAbilitySelect(base.customSkillAbilities?.[entry.id] || "str", `data-type="custom-skill-ability" data-id="${entry.id}"`)}</label>
        <button type="button" data-type="custom-prof-del" data-category="skill" data-id="${entry.id}">X</button>
      </div>
    `;
      }
    )
    .join("");

  container.innerHTML = `
    <article>
      <div class="prof-box">
      <p class="section-header">Level</p>
      <div class="row">
        <label>Name <input data-type="character-name" value="${base.characterName || ""}" /></label>
        <label>Level <input data-type="level" type="number" value="${base.level}" /></label>
      </div>
      <div class="row">
        <p class="muted">Save slot metadata is hidden from the UI.</p>
      </div>
      </div>
      <div class="prof-box">
      <p class="section-header">Ability Scores</p>
      <div class="row">${statsInputs}</div>
      </div>
      <div class="prof-box">
      <p class="section-header">Health</p>
      <div class="row">
        <label>Ancestry HP <input data-type="health" data-key="ancestryBase" type="number" value="${Number(health.ancestryBase || 0)}" /></label>
        <label>Class HP <input data-type="health" data-key="classPerLevel" type="number" value="${Number(health.classPerLevel || 0)}" /></label>
        <label>Per Level <input data-type="health" data-key="perLevelModifier" type="number" value="${Number(health.perLevelModifier || 0)}" /></label>
        <label>Flat Bonus <input data-type="health" data-key="flatBonus" type="number" value="${Number(health.flatBonus || 0)}" /></label>
      </div>
      </div>
      <div class="prof-box">
      <p class="section-header">Speed</p>
      <div class="row">
        <label>Base Speed <input data-type="base-speed" type="number" min="0" step="5" value="${Number(base.baseSpeed || 0)}" /></label>
      </div>
      <div>
        ${
          speedChanges.length
            ? speedChanges
                .map(
                  (row) => `
          <div class="weapon-bonus-row">
            <label>Name <input data-type="speed-name" data-id="${row.id}" value="${row.label || ""}" /></label>
            <label>Number <input data-type="speed-value" data-id="${row.id}" type="number" value="${Number(row.value || 0)}" /></label>
            <label>Type
              <select data-type="speed-type" data-id="${row.id}">
                ${MODIFIER_TYPES.map((t) => `<option value="${t}" ${String(row.type || "item") === t ? "selected" : ""}>${t}</option>`).join("")}
              </select>
            </label>
            <button type="button" data-type="speed-del" data-id="${row.id}">X</button>
          </div>
        `
                )
                .join("")
            : `<p class="muted">No speed changes yet.</p>`
        }
      </div>
      <div class="row">
        <button type="button" data-type="speed-add">Add speed change</button>
      </div>
      </div>
      <div class="prof-box">
      <p class="section-header">Weapon Proficiencies</p>
      <div class="row">${weaponInputs}</div>
      </div>
      <div class="prof-box">
      <p class="section-header">Armor</p>
      <p class="muted">Proficiencies</p>
      <div class="row">${armorInputs}</div>
      <hr class="section-divider" />
      <p class="section-header">Equipped armor</p>
      <div class="weapon-editor-grid">
        <label>Name <input data-armor-field="name" value="${escapeHtml(armor.name)}" /></label>
        <label>Category (proficiency)
          <select data-armor-field="armorType">
            <option value="unarmored" ${String(base.armorType || "unarmored") === "unarmored" ? "selected" : ""}>Unarmored</option>
            <option value="light" ${base.armorType === "light" ? "selected" : ""}>Light Armor</option>
            <option value="medium" ${base.armorType === "medium" ? "selected" : ""}>Medium Armor</option>
            <option value="heavy" ${base.armorType === "heavy" ? "selected" : ""}>Heavy Armor</option>
          </select>
        </label>
        <label>Group <input data-armor-field="group" value="${escapeHtml(armor.group)}" /></label>
        <label>Bulk <input data-armor-field="bulk" value="${escapeHtml(armor.bulk)}" /></label>
        <label>AC bonus <input data-armor-field="acBonus" type="number" step="1" value="${armor.acBonus}" /></label>
        <label>Dex cap <input data-armor-field="dexCap" type="number" step="1" value="${armor.dexCap}" /></label>
        <label>Check penalty <input data-armor-field="checkPenalty" type="number" step="1" value="${armor.checkPenalty}" /></label>
        <label>Speed penalty <input data-armor-field="speedPenalty" type="number" step="1" value="${armor.speedPenalty}" /></label>
      </div>
      <div class="row">
        <label>Strength requirement <input data-armor-field="strengthRequirement" type="number" step="1" value="${armor.strengthRequirement}" /></label>
      </div>
      <hr class="section-divider" />
      <p class="section-header">Always-on armor bonuses</p>
      ${armorBonusRows || `<p class="muted">No armor bonuses yet.</p>`}
      <div class="row"><button type="button" data-armor-add-bonus>Add armor bonus</button></div>
      <div class="row">
        <label>Enchantments <input data-armor-field="enchantments" value="${escapeHtml(armor.enchantments)}" /></label>
      </div>
      <div class="row">
        <label>Modifiers (supports $variables)
          <input data-armor-field="modifiers" ${armorVarAssist.listAttr} value="${escapeHtml(armor.modifiers)}" placeholder="$level-1" />
        </label>
      </div>
      ${armorVarAssist.hintHtml}
      ${armorVarAssist.datalistHtml}
      <p class="muted">Resolved modifier: ${Number(armor.modifierValue || 0) >= 0 ? "+" : ""}${Number(armor.modifierValue || 0)}</p>
      </div>
      <div class="prof-box">
      <p class="section-header">Saves</p>
      <div class="row">
        ${renderProfSelect(base, "fortitude", "fortitude")}
        ${renderProfSelect(base, "reflex", "reflex")}
        ${renderProfSelect(base, "will", "will")}
      </div>
      </div>
      <div class="prof-box">
      <p class="section-header">Core Proficiencies</p>
      <div class="row">${renderProfSelect(base, "perception", "perception")} ${renderProfSelect(base, "classDc", "class dc")}</div>
      <div class="row">${classDcKeySelect}</div>
      <p class="muted">Class DC = 10 + level + proficiency + chosen ability (same bundle for Class DC − 10).</p>
      <div>${customCoreRows}</div>
      <div class="row">
        <button type="button" data-type="custom-prof-add" data-category="core">Add</button>
      </div>
      </div>
      <div class="prof-box">
      <p class="section-header">Skill Proficiencies</p>
      <div class="skill-prof-list">${skillProfInputs}</div>
      <div>${customSkillRows}</div>
      <div class="row">
        <button type="button" data-type="custom-prof-add" data-category="skill">Add</button>
      </div>
      </div>
    </article>
  `;

  container.querySelectorAll("input,select").forEach((el) => {
    el.addEventListener("change", (event) => {
      const target = event.currentTarget;
      store.patch((draft) => {
        if (target.dataset.type === "stat") {
          draft.base.stats[target.dataset.key] = Number(target.value || 10);
        } else if (target.dataset.type === "prof") {
          draft.base.proficiencies[target.dataset.key] = target.value;
        } else if (target.dataset.type === "class-dc-key") {
          draft.base.classDcKey = target.value;
        } else if (target.dataset.type === "skill-ability") {
          draft.base.skillAbilityOverrides = draft.base.skillAbilityOverrides || {};
          draft.base.skillAbilityOverrides[target.dataset.key] = target.value;
        } else if (target.dataset.type === "custom-skill-ability") {
          draft.base.customSkillAbilities = draft.base.customSkillAbilities || {};
          draft.base.customSkillAbilities[target.dataset.id] = target.value;
        } else if (target.dataset.type === "character-name") {
          draft.base.characterName = target.value;
          draft.saveMeta = draft.saveMeta || {};
          draft.saveMeta.saveName = target.value;
        } else if (target.dataset.type === "level") {
          draft.base.level = Number(target.value || 1);
        } else if (target.dataset.type === "base-speed") {
          draft.base.baseSpeed = Number(target.value || 0);
        } else if (target.dataset.type === "save-name") {
          draft.saveMeta = draft.saveMeta || {};
          draft.saveMeta.saveName = target.value;
        } else if (target.dataset.type === "health") {
          draft.base.health = draft.base.health || {};
          draft.base.health[target.dataset.key] = Number(target.value || 0);
        } else if (target.dataset.type === "custom-prof-name") {
          const category = target.dataset.category;
          const id = target.dataset.id;
          draft.base.customProficiencies = draft.base.customProficiencies || { core: [], skill: [] };
          const row = draft.base.customProficiencies[category].find((r) => r.id === id);
          if (row) row.name = target.value;
        } else if (target.dataset.type === "custom-prof-rank") {
          const category = target.dataset.category;
          const id = target.dataset.id;
          draft.base.customProficiencies = draft.base.customProficiencies || { core: [], skill: [] };
          const row = draft.base.customProficiencies[category].find((r) => r.id === id);
          if (row) row.rank = target.value;
        } else if (target.dataset.type === "speed-name") {
          const row = (draft.base.speedChanges || []).find((r) => r.id === target.dataset.id);
          if (row) row.label = String(target.value || "");
        } else if (target.dataset.type === "speed-value") {
          const row = (draft.base.speedChanges || []).find((r) => r.id === target.dataset.id);
          if (row) row.value = Number(target.value || 0);
        } else if (target.dataset.type === "speed-type") {
          const row = (draft.base.speedChanges || []).find((r) => r.id === target.dataset.id);
          if (row) row.type = MODIFIER_TYPES.includes(String(target.value || "").toLowerCase()) ? String(target.value || "").toLowerCase() : "item";
        }
      });
    });
  });

  container.querySelectorAll("button[data-type='custom-prof-add'],button[data-type='custom-prof-del'],button[data-type='speed-add'],button[data-type='speed-del'],button[data-type='skill-favorite-toggle']").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      const target = event.currentTarget;
      store.patch((draft) => {
        if (target.dataset.type === "skill-favorite-toggle") {
          const ref = String(target.dataset.skillRef || "");
          if (!ref) return;
          draft.base.favoriteSkills = Array.isArray(draft.base.favoriteSkills) ? [...draft.base.favoriteSkills] : [];
          const idx = draft.base.favoriteSkills.indexOf(ref);
          if (idx >= 0) draft.base.favoriteSkills.splice(idx, 1);
          else draft.base.favoriteSkills.push(ref);
        } else if (target.dataset.type === "custom-prof-add") {
          const category = target.dataset.category;
          draft.base.customProficiencies = draft.base.customProficiencies || { core: [], skill: [] };
          draft.base.customProficiencies[category].push({
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            name: "",
            rank: "untrained",
          });
        } else if (target.dataset.type === "custom-prof-del") {
          const category = target.dataset.category;
          const id = target.dataset.id;
          draft.base.customProficiencies = draft.base.customProficiencies || { core: [], skill: [] };
          draft.base.customProficiencies[category] = draft.base.customProficiencies[category].filter(
            (row) => row.id !== id
          );
        } else if (target.dataset.type === "speed-add") {
          draft.base.speedChanges = draft.base.speedChanges || [];
          draft.base.speedChanges.push({
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            label: "",
            value: 0,
            type: "item",
          });
        } else if (target.dataset.type === "speed-del") {
          const id = target.dataset.id;
          draft.base.speedChanges = (draft.base.speedChanges || []).filter((row) => row.id !== id);
        }
      });
    });
  });

  container.querySelectorAll("input[data-armor-field],select[data-armor-field]").forEach((el) => {
    el.addEventListener("change", (event) => {
      const target = event.currentTarget;
      const field = target.dataset.armorField;
      store.patch((draft) => {
        draft.base.armor = coerceArmorState(draft.base.armor);
        if (field === "armorType") {
          draft.base.armorType = String(target.value || "unarmored");
          return;
        }
        if (field === "acBonus" || field === "dexCap" || field === "checkPenalty" || field === "speedPenalty" || field === "strengthRequirement") {
          draft.base.armor[field] = Number(target.value || 0);
          return;
        }
        if (field === "modifiers") {
          const formula = String(target.value || "").trim();
          draft.base.armor.modifiers = formula;
          if (!formula) {
            draft.base.armor.modifierValue = 0;
            return;
          }
          try {
            const vars = resolveVariableMap(store.getState());
            const resolver = (name) => vars[String(name || "").toLowerCase().replace(/-/g, "_")];
            const modifierRowsFlat = flattenModifierRows(draft.base);
            const resolved = evaluateExpression(formula, resolver, {
              resolveTypedSummary: (t) => summarizeModifiers(modifierRowsFlat, t),
            });
            const value = Number(Function(`"use strict"; return (${resolved});`)());
            draft.base.armor.modifierValue = Number.isFinite(value) ? value : 0;
          } catch (_err) {
            draft.base.armor.modifierValue = 0;
          }
          return;
        }
        draft.base.armor[field] = String(target.value || "");
      });
    });
  });
  container.querySelector("[data-armor-add-bonus]")?.addEventListener("click", () => {
    store.patch((draft) => {
      draft.base.armor = coerceArmorState(draft.base.armor);
      draft.base.armor.bonuses = draft.base.armor.bonuses || [];
      draft.base.armor.bonuses.push({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        label: "Armor bonus",
        bonus: 1,
        type: "item",
      });
    });
  });
  container.querySelectorAll("input[data-armor-bonus-id],select[data-armor-bonus-id]").forEach((el) => {
    el.addEventListener("change", (event) => {
      const id = el.dataset.armorBonusId;
      const field = el.dataset.armorBonusField;
      const target = event.currentTarget;
      store.patch((draft) => {
        draft.base.armor = coerceArmorState(draft.base.armor);
        const row = (draft.base.armor.bonuses || []).find((b) => b.id === id);
        if (!row) return;
        if (field === "bonus") {
          row.bonus = Number(target.value || 0);
        } else if (field === "type") {
          const type = String(target.value || "item").toLowerCase();
          row.type = MODIFIER_TYPES.includes(type) ? type : "item";
        } else {
          row[field] = String(target.value || "");
        }
      });
    });
  });
  container.querySelectorAll("[data-armor-del-bonus]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.armorDelBonus;
      store.patch((draft) => {
        draft.base.armor = coerceArmorState(draft.base.armor);
        draft.base.armor.bonuses = (draft.base.armor.bonuses || []).filter((b) => b.id !== id);
      });
    });
  });
}
