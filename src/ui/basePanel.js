import { SKILL_TO_ABILITY, WEAPON_TYPES, ARMOR_TYPES, CLASS_DC_KEY_OPTIONS } from "../engine/calc.js";

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

  const statsInputs = ABILITIES.map(
    (k) =>
      `<label>${k.toUpperCase()} <input class="ability-score-input" data-type="stat" data-key="${k}" type="number" value="${base.stats[k]}" /></label>`
  ).join("");

  const weaponInputs = WEAPON_KEYS.map((k) =>
    renderProfSelect(base, k, k.replace("weapon_", ""))
  ).join("");
  const armorInputs = ARMOR_KEYS.map((k) => renderProfSelect(base, k, k.replace("armor_", ""))).join("");
  const skillProfInputs = SKILL_KEYS.map((k) => {
    const ability = base.skillAbilityOverrides?.[k] || SKILL_TO_ABILITY[k] || "str";
    return `<div class="row custom-prof-row">
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
      (entry) => `
      <div class="row custom-prof-row">
        <input data-type="custom-prof-name" data-category="skill" data-id="${entry.id}" value="${entry.name || ""}" placeholder="name" />
        <select data-type="custom-prof-rank" data-category="skill" data-id="${entry.id}">
          ${PROF_OPTIONS.map((o) => `<option value="${o}" ${(entry.rank || "untrained") === o ? "selected" : ""}>${o}</option>`).join("")}
        </select>
        <label>ability ${renderAbilitySelect(base.customSkillAbilities?.[entry.id] || "str", `data-type="custom-skill-ability" data-id="${entry.id}"`)}</label>
        <button type="button" data-type="custom-prof-del" data-category="skill" data-id="${entry.id}">X</button>
      </div>
    `
    )
    .join("");

  container.innerHTML = `
    <article>
      <div class="prof-box">
      <p class="section-header">Level</p>
      <div class="row">
        <label>Name <input data-type="character-name" value="${base.characterName || ""}" /></label>
        <label>Level <input data-type="level" type="number" value="${base.level}" /></label>
        <label>Base Speed <input data-type="base-speed" type="number" min="0" step="5" value="${Number(base.baseSpeed || 0)}" /></label>
      </div>
      <div class="row">
        <label>Save Name <input data-type="save-name" value="${state.saveMeta?.saveName || "New Save"}" /></label>
        <label>Save ID <input type="text" value="${state.saveMeta?.saveId || ""}" readonly /></label>
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
      <p class="section-header">Weapon Proficiencies</p>
      <div class="row">${weaponInputs}</div>
      </div>
      <div class="prof-box">
      <p class="section-header">Armor Proficiencies</p>
      <div class="row">${armorInputs}</div>
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
        }
      });
    });
  });

  container.querySelectorAll("button[data-type='custom-prof-add'],button[data-type='custom-prof-del']").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      const target = event.currentTarget;
      store.patch((draft) => {
        if (target.dataset.type === "custom-prof-add") {
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
        }
      });
    });
  });
}
