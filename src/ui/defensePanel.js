import { ARMOR_TYPES } from "../engine/calc.js";

const PROF_OPTIONS = ["untrained", "trained", "expert", "master", "legendary"];

function profSelect(base, key, label) {
  const options = PROF_OPTIONS.map((o) => {
    const selected = (base.proficiencies[key] || "untrained") === o ? "selected" : "";
    return `<option value="${o}" ${selected}>${o}</option>`;
  }).join("");
  return `<label>${label}<select data-type="prof" data-key="${key}">${options}</select></label>`;
}

export function renderDefensePanel(container, state, store) {
  const base = state.base;
  const health = base.health || {};

  container.innerHTML = `
    <article>
      <div class="prof-box">
      <p class="section-header">Health (HP Max)</p>
      <div class="row">
        <label>Ancestry HP <input data-type="health" data-key="ancestryBase" type="number" value="${Number(health.ancestryBase || 0)}" /></label>
        <label>Class HP <input data-type="health" data-key="classPerLevel" type="number" value="${Number(health.classPerLevel || 0)}" /></label>
        <label>Per Level <input data-type="health" data-key="perLevelModifier" type="number" value="${Number(health.perLevelModifier || 0)}" /></label>
        <label>Flat Bonus <input data-type="health" data-key="flatBonus" type="number" value="${Number(health.flatBonus || 0)}" /></label>
      </div>
      </div>
      <div class="prof-box">
      <p class="section-header">Saves</p>
      <div class="row">
        ${profSelect(base, "fortitude", "fortitude")} ${profSelect(base, "reflex", "reflex")} ${profSelect(base, "will", "will")}
      </div>
      </div>
      <div class="prof-box">
      <p class="section-header">Armor Proficiency</p>
      <div class="row">
        ${ARMOR_TYPES.map((type) => profSelect(base, `armor_${type}`, type)).join("")}
      </div>
      </div>
    </article>
  `;

  container.querySelectorAll("input,select").forEach((el) => {
    el.addEventListener("change", (event) => {
      const target = event.currentTarget;
      store.patch((draft) => {
        if (target.dataset.type === "health") {
          draft.base.health = draft.base.health || {};
          draft.base.health[target.dataset.key] = Number(target.value || 0);
        } else if (target.dataset.type === "prof") {
          draft.base.proficiencies[target.dataset.key] = target.value;
        }
      });
    });
  });
}
