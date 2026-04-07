import { createStore, createInitialState } from "./state/store.js";
import { loadState, saveState, listCharacterSaves, loadCharacterById } from "./state/persist.js";
import { profRankToBonus, SKILL_TO_ABILITY } from "./engine/calc.js";
import { MODIFIER_TYPES, summarizeModifiers, selectModifierEffects } from "./engine/modifiers.js";
import { rollDiceExpression } from "./engine/roller.js";
import { buildWeaponHitFormula, buildWeaponCritFormula } from "./engine/weaponDamage.js";
import { evaluateExpression } from "./engine/formula.js";
import { renderBasePanel } from "./ui/basePanel.js";
import { resolveVariableMap } from "./ui/variablesPanel.js";

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const root = {
  base: document.querySelector("#base-panel"),
  characterHeaderName: document.querySelector("#character-header-name"),
  overviewEditBtn: document.querySelector("#overview-edit-btn"),
  charactersBtn: document.querySelector("#characters-btn"),
  importBtn: document.querySelector("#import-btn"),
  newCharacterBtn: document.querySelector("#new-character-btn"),
  exportBtn: document.querySelector("#export-btn"),
  rollLog: document.querySelector("#roll-log"),
  rollLogPopup: document.querySelector("#roll-log-popup"),
  rollLogToggle: document.querySelector("#roll-log-toggle"),
  rollLogClose: document.querySelector("#roll-log-close"),
  charactersPopup: document.querySelector("#characters-popup"),
  charactersList: document.querySelector("#characters-list"),
  charactersClose: document.querySelector("#characters-close"),
  overviewWorkspace: document.querySelector("#overview-workspace"),
  mainCombatStrip: document.querySelector("#main-combat-strip"),
  mainInitiativeStrip: document.querySelector("#main-initiative-strip"),
  mainSkillsStrip: document.querySelector("#main-skills-strip"),
  modifierWidget: document.querySelector("#modifier-widget"),
  weaponWidget: document.querySelector("#weapon-widget"),
  mainWidgets: document.querySelector("#main-widgets"),
};

const OVERVIEW_BLOCKS = [
  "base-strip",
  "initiative-strip",
  "skills-strip",
  "weapon-widget",
  "main-widgets",
  "modifier-widget",
];
const REQUIRED_OVERVIEW_BLOCKS = ["base-strip", "initiative-strip", "skills-strip"];
const baseBlockType = (id) => String(id || "").split(":")[0];
const isBlockType = (id, type) => baseBlockType(id) === type;

const seeded = loadState() || createInitialState();
if (!seeded.saveMeta || typeof seeded.saveMeta !== "object") {
  seeded.saveMeta = {};
}
if (typeof seeded.saveMeta.saveId !== "string" || !seeded.saveMeta.saveId.trim()) {
  seeded.saveMeta.saveId = uid();
}
if (typeof seeded.saveMeta.saveName !== "string" || !seeded.saveMeta.saveName.trim()) {
  seeded.saveMeta.saveName = "New Save";
}
if (seeded.base && seeded.base.classDcKey == null) {
  seeded.base.classDcKey = "maxStrDexIntWis";
}
if (seeded.base && typeof seeded.base.characterName !== "string") {
  seeded.base.characterName = "Character";
}
if (seeded.base && !seeded.base.skillAbilityOverrides) {
  seeded.base.skillAbilityOverrides = {};
}
if (seeded.base && !seeded.base.customSkillAbilities) {
  seeded.base.customSkillAbilities = {};
}
if (seeded.base && !Array.isArray(seeded.base.modifiers)) {
  seeded.base.modifiers = [];
}
if (seeded.base && (!seeded.base.modifierGroups || typeof seeded.base.modifierGroups !== "object")) {
  seeded.base.modifierGroups = {
    "modifier-widget": {
      title: "Modifier Widget",
      rows: structuredClone(seeded.base.modifiers || []),
    },
  };
}
for (const [gid, group] of Object.entries(seeded.base?.modifierGroups || {})) {
  if (!group || typeof group !== "object") {
    seeded.base.modifierGroups[gid] = { title: "Modifier Widget", rows: [] };
    continue;
  }
  if (typeof group.title !== "string" || !group.title.trim()) group.title = "Modifier Widget";
  if (!Array.isArray(group.rows)) group.rows = [];
  group.rows = group.rows.map((row) => {
    const normalized = { ...(row || {}) };
    if (!Array.isArray(normalized.effectsBatches)) {
      if (Array.isArray(normalized.effects) && normalized.effects.length) {
        normalized.effectsBatches = normalized.effects.map((fx) => ({
          target: String(normalized.target || "all"),
          type: String(normalized.type || "untyped"),
          effect: String(fx || ""),
          enabled: true,
        }));
      } else {
        const single = String(normalized.effect ?? normalized.value ?? "").trim();
        normalized.effectsBatches = [
          {
            target: String(normalized.target || "all"),
            type: String(normalized.type || "untyped"),
            effect: single || "0",
            enabled: true,
          },
        ];
      }
    }
    return normalized;
  });
}
if (seeded.base && !Number.isFinite(Number(seeded.base.baseSpeed))) {
  seeded.base.baseSpeed = 25;
}
if (seeded.ui && typeof seeded.ui.rollLogOpen !== "boolean") {
  seeded.ui.rollLogOpen = false;
}
if (seeded.ui && typeof seeded.ui.weaponWidgetEditorOpen !== "boolean") {
  seeded.ui.weaponWidgetEditorOpen = false;
}
if (seeded.ui && typeof seeded.ui.modifierWidgetEditorOpen !== "boolean") {
  seeded.ui.modifierWidgetEditorOpen = false;
}
if (seeded.ui && seeded.ui.modifierWidgetEditingId == null) {
  seeded.ui.modifierWidgetEditingId = null;
}
if (seeded.ui && typeof seeded.ui.modifierWidgetGroupId !== "string") {
  seeded.ui.modifierWidgetGroupId = "modifier-widget";
}
if (seeded.ui && typeof seeded.ui.customWidgetEditorOpen !== "boolean") {
  seeded.ui.customWidgetEditorOpen = false;
}
if (seeded.ui && seeded.ui.customWidgetEditingId == null) {
  seeded.ui.customWidgetEditingId = null;
}
if (seeded.ui && !seeded.ui.groupNames) {
  seeded.ui.groupNames = { attack: "Attack Widget", abilities: "Flex Widget" };
}
if (seeded.ui && typeof seeded.ui.overviewLayoutEdit !== "boolean") {
  seeded.ui.overviewLayoutEdit = false;
}
if (seeded.ui && typeof seeded.ui.characterManagerOpen !== "boolean") {
  seeded.ui.characterManagerOpen = false;
}
if (!Array.isArray(seeded.customWidgets)) {
  seeded.customWidgets = [];
} else {
  seeded.customWidgets = seeded.customWidgets.map((w) => {
    const bracketRolls = parseBracketRolls(w.content || "");
    return {
      id: w.id || uid(),
      title: String(w.title || ""),
      content: String(w.content || ""),
      roll1: String(w.roll1 || bracketRolls[0]?.formula || ""),
      roll2: String(w.roll2 || bracketRolls[1]?.formula || ""),
      toggleCount: Number.isFinite(Number(w.toggleCount))
        ? Math.min(5, Math.max(0, Number(w.toggleCount)))
        : Boolean(w.activateToggle ?? w.togglesEnabled)
          ? 1
          : 0,
      toggleStates: Array.isArray(w.toggleStates) ? w.toggleStates.map((v) => Boolean(v)) : [],
      active: Boolean(w.active),
      collapsed: Boolean(w.collapsed),
    };
  });
}
if (!seeded.weaponWidgets || typeof seeded.weaponWidgets !== "object") {
  seeded.weaponWidgets = {};
}
if (!seeded.widgetGroups || typeof seeded.widgetGroups !== "object") {
  seeded.widgetGroups = {};
}
if (!seeded.overviewLayout) {
  seeded.overviewLayout = structuredClone(createInitialState().overviewLayout);
} else if (Array.isArray(seeded.overviewLayout.columns) && !Array.isArray(seeded.overviewLayout.rows)) {
  seeded.overviewLayout = { rows: [seeded.overviewLayout.columns] };
} else if (!Array.isArray(seeded.overviewLayout.rows)) {
  seeded.overviewLayout = structuredClone(createInitialState().overviewLayout);
}
if (!seeded.weaponWidget) {
  seeded.weaponWidget = createInitialState().weaponWidget;
} else {
  const ww = seeded.weaponWidget;
  if (Array.isArray(ww.attacks)) {
    let inferred = 5;
    const attacks = ww.attacks;
    if (attacks.length >= 2) {
      const a = Number(attacks[0]?.map ?? 0);
      const b = Number(attacks[1]?.map ?? 0);
      const diff = Math.abs(b - a);
      if (diff > 0) inferred = diff;
    }
    if (typeof ww.mapPenalty !== "number") ww.mapPenalty = inferred;
    delete ww.attacks;
  }
  if (typeof ww.mapPenalty !== "number" || Number.isNaN(ww.mapPenalty)) {
    ww.mapPenalty = 5;
  }
  if (ww.diceCount != null || ww.diceSides != null) {
    const dc = Number(ww.diceCount || 1);
    const ds = Number(ww.diceSides || 6);
    const fromDice = `${dc}d${ds}`;
    if (!Array.isArray(ww.damages)) ww.damages = [];
    if (ww.damages.length === 0) {
      ww.damages.push({ id: `d1-${Date.now()}`, label: "Damage", formula: fromDice });
    } else if (!String(ww.damages[0]?.formula || "").trim()) {
      ww.damages[0].formula = fromDice;
    }
    delete ww.diceCount;
    delete ww.diceSides;
  }
  if (!Array.isArray(ww.damages)) {
    ww.damages = structuredClone(createInitialState().weaponWidget.damages);
  }
  if (ww.damages.length === 0) {
    ww.damages.push({ id: `d1-${Date.now()}`, label: "Damage", formula: "1d6" });
  }
  if (ww.damages.length === 1) {
    ww.damages.push({
      id: `d2-${Date.now()}`,
      label: "Critical",
      formula: ww.damages[0].formula,
    });
  }
  if (!Array.isArray(ww.damageToggles)) ww.damageToggles = [];
  ww.damageToggles = ww.damageToggles.map((t) => ({
    ...t,
    multiplyOnCrit: t.multiplyOnCrit !== false,
  }));
  delete ww.critMode;
  delete ww.deadlyDie;
  delete ww.fatalDie;
  const ATTACK_ABILITIES = new Set(["maxStrDex", "str", "dex", "con", "int", "wis", "cha"]);
  const ATTACK_PROF = new Set(["weapon", "classDcRank", "classDcMinus10"]);
  if (!ATTACK_ABILITIES.has(ww.attackAbility)) ww.attackAbility = "maxStrDex";
  if (!ATTACK_PROF.has(ww.attackProficiency)) ww.attackProficiency = "weapon";
  const DAMAGE_ABILITIES = new Set(["none", ...ATTACK_ABILITIES]);
  if (!DAMAGE_ABILITIES.has(ww.damageAbility)) ww.damageAbility = "none";
  if (!Array.isArray(ww.attackBonuses)) ww.attackBonuses = [];
  if (typeof ww.attackBonusFlat === "number" && ww.attackBonusFlat !== 0 && ww.attackBonuses.length === 0) {
    ww.attackBonuses.push({
      id: `ab-${Date.now()}`,
      label: "Legacy bonus",
      bonus: Number(ww.attackBonusFlat || 0),
      on: true,
    });
  }
  delete ww.attackBonusFlat;
  if (typeof ww.subtitle !== "string") ww.subtitle = "";
  if (typeof ww.groupName !== "string" || !ww.groupName.trim()) ww.groupName = "Attack Widget";
}
if (!seeded.weaponWidgets["weapon-widget"]) {
  seeded.weaponWidgets["weapon-widget"] = structuredClone(seeded.weaponWidget || createInitialState().weaponWidget);
}
if (!seeded.widgetGroups["main-widgets"]) {
  seeded.widgetGroups["main-widgets"] = {
    title: String(seeded.ui?.groupNames?.abilities || "Flex Widget"),
    widgets: structuredClone(seeded.customWidgets || []),
  };
}
if (seeded.ui && typeof seeded.ui.weaponWidgetEditingId !== "string") {
  seeded.ui.weaponWidgetEditingId = "weapon-widget";
}
if (seeded.ui && typeof seeded.ui.customWidgetGroupId !== "string") {
  seeded.ui.customWidgetGroupId = "main-widgets";
}
const store = createStore(seeded);
let isHydrating = true;
const DAMAGE_TYPES = [
  "bludgeoning",
  "piercing",
  "slashing",
  "fire",
  "cold",
  "electricity",
  "acid",
  "sonic",
  "poison",
  "mental",
  "force",
  "void",
  "vitality",
  "precision",
  "bleed",
];
const WEAPON_PROF_TYPES = ["unarmed", "simple", "martial", "advanced"];
const ATTACK_ABILITY_SELECT = [
  { value: "maxStrDex", label: "Higher STR / DEX" },
  { value: "str", label: "STR" },
  { value: "dex", label: "DEX" },
  { value: "con", label: "CON" },
  { value: "int", label: "INT" },
  { value: "wis", label: "WIS" },
  { value: "cha", label: "CHA" },
];
const DAMAGE_ABILITY_SELECT = [
  { value: "none", label: "None" },
  ...ATTACK_ABILITY_SELECT,
];

function weaponAttackAbilityMod(widget, mods) {
  const key = widget.attackAbility || "maxStrDex";
  if (key === "maxStrDex") {
    return Math.max(Number(mods.str ?? 0), Number(mods.dex ?? 0));
  }
  return Number(mods[key] ?? 0);
}

function weaponStrikeBase(state, widget) {
  const level = Number(state.base.level || 1);
  const mode = widget.attackProficiency || "weapon";
  if (mode === "classDcMinus10") {
    return Number(state.derived.classDc) - 10;
  }
  const ability = weaponAttackAbilityMod(widget, state.derived.mods);
  let profBonus;
  if (mode === "classDcRank") {
    profBonus = state.derived.rankBonus.classDc;
  } else {
    const wkey = `weapon_${widget.proficiencyType}`;
    profBonus = profRankToBonus(state.base.proficiencies[wkey] || "untrained");
  }
  return level + profBonus + ability;
}

function weaponDamageAbilityMod(state, widget) {
  const key = widget.damageAbility || "none";
  if (key === "none") return 0;
  if (key === "maxStrDex") {
    return Math.max(Number(state.derived.mods.str ?? 0), Number(state.derived.mods.dex ?? 0));
  }
  return Number(state.derived.mods[key] ?? 0);
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseBracketRolls(content) {
  return [...String(content || "").matchAll(/\[roll\s*:\s*([^\]]+)\]/gi)].map((m, i) => ({
    id: `r${i}`,
    formula: String(m[1] || "").trim(),
    label: `Roll ${i + 1}`,
  }));
}

function parseRollField(raw, fallbackLabel) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const m = text.match(/^([^:]+):\s*(.+)$/);
  if (m) return { label: m[1].trim(), formula: m[2].trim() };
  return { label: fallbackLabel, formula: text };
}

function flattenModifierRows(base) {
  const raw = base.modifierGroups && typeof base.modifierGroups === "object"
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

function normalizeOverviewRows(rowsInput) {
  const rowSpec = {
    half: 1,
    halves: 2,
    thirds: 3,
    oneThirdTwoThird: 2,
    twoThirdOneThird: 2,
  };
  const rows = Array.isArray(rowsInput)
    ? rowsInput.map((r) => {
        const colsRaw = Array.isArray(r)
          ? r
          : Array.isArray(r?.cols)
            ? r.cols
            : [];
        const cols = colsRaw.map((c) =>
          (Array.isArray(c) ? c : [])
            .map((id) => (id === "main-strip" ? ["base-strip", "skills-strip"] : [id]))
            .flat()
            .filter((id) => OVERVIEW_BLOCKS.includes(baseBlockType(id)))
        );
        let layout = typeof r?.layout === "string" ? r.layout : "";
        if (!rowSpec[layout]) {
          if (cols.length >= 3) layout = "thirds";
          else if (cols.length === 2) layout = "halves";
          else layout = "half";
        }
        while (cols.length < rowSpec[layout]) cols.push([]);
        if (cols.length > rowSpec[layout]) cols.length = rowSpec[layout];
        return { layout, cols };
      })
    : [];
  if (!rows.length) rows.push({ layout: "halves", cols: [[], []] });
  for (const r of rows) {
    if (!r.cols.length) r.cols.push([]);
  }
  const seenRequired = new Set();
  for (const r of rows) {
    for (const c of r.cols) {
      for (let i = c.length - 1; i >= 0; i -= 1) {
        const id = c[i];
        const type = baseBlockType(id);
        if (REQUIRED_OVERVIEW_BLOCKS.includes(type)) {
          if (seenRequired.has(type)) c.splice(i, 1);
          else seenRequired.add(type);
        }
      }
    }
  }
  for (const id of REQUIRED_OVERVIEW_BLOCKS) {
    if (!seenRequired.has(id)) rows[0].cols[0].push(id);
  }
  return rows;
}

function compactOverviewRows(rowsInput) {
  const rowSpec = {
    half: 1,
    halves: 2,
    thirds: 3,
    oneThirdTwoThird: 2,
    twoThirdOneThird: 2,
  };
  const cleaned = normalizeOverviewRows(rowsInput)
    .map((r) => ({ ...r, cols: r.cols.filter((c) => c.length > 0) }))
    .filter((r) => r.cols.length > 0)
    .map((r) => {
      if (r.cols.length >= 3) return { ...r, layout: "thirds" };
      if (r.cols.length === 2) {
        if (r.layout === "oneThirdTwoThird" || r.layout === "twoThirdOneThird" || r.layout === "halves") {
          return r;
        }
        return { ...r, layout: "halves" };
      }
      return { ...r, layout: "half" };
    });
  if (!cleaned.length) {
    cleaned.push({ layout: "halves", cols: [[], []] });
  }
  for (const row of cleaned) {
    const expected = rowSpec[row.layout] || 1;
    while (row.cols.length < expected) row.cols.push([]);
    if (row.cols.length > expected) row.cols.length = expected;
  }
  return normalizeOverviewRows(cleaned);
}

function renderOverviewWorkspace(state) {
  const editMode = Boolean(state.ui.overviewLayoutEdit);
  const rows = editMode
    ? normalizeOverviewRows(state.overviewLayout?.rows)
    : compactOverviewRows(state.overviewLayout?.rows);
  if (root.overviewEditBtn) {
    root.overviewEditBtn.textContent = editMode ? "Done Layout" : "Edit Layout";
  }
  root.overviewWorkspace.innerHTML = `
    ${editMode ? `<div class="overview-layout-tools">
      <label>Add row
        <select id="ov-add-row-size">
          <option value="half">1</option>
          <option value="halves">1/2 1/2</option>
          <option value="thirds">1/3 1/3 1/3</option>
          <option value="oneThirdTwoThird">1/3 2/3</option>
          <option value="twoThirdOneThird">2/3 1/3</option>
        </select>
      </label>
      <button type="button" id="ov-add-row-btn">Add</button>
      <button type="button" id="ov-add-attack-btn">Add Attack Widget</button>
      <button type="button" id="ov-add-widgets-btn">Add Flex Widget</button>
      <button type="button" id="ov-add-modifier-btn">Add Modifier Widget</button>
    </div>` : ""}
    <div class="overview-layout ${editMode ? "edit-mode" : ""}">
      ${rows
        .map(
          (row, rowIdx) => `
        <div class="overview-row-wrap">
          ${
            editMode
              ? `<div class="overview-row-controls">
                  <button type="button" class="mini-btn" data-ov-row-up="${rowIdx}">↑</button>
                  <button type="button" class="mini-btn" data-ov-row-down="${rowIdx}">↓</button>
                </div>`
              : ""
          }
        <div class="overview-row overview-row-${row.layout}">
          ${row.cols
            .map(
              (col, colIdx) => `
            <section class="overview-column" data-ov-row="${rowIdx}" data-ov-col="${colIdx}" data-drop-target="true">
              ${col
                .map(
                  (id, idx) => `
                <article class="overview-block" draggable="${editMode ? "true" : "false"}" data-ov-block="${id}" data-ov-row="${rowIdx}" data-ov-col="${colIdx}" data-ov-idx="${idx}">
                  <div class="overview-block-topline">
                    <div class="overview-block-grip" title="Drag block">::</div>
                    ${
                      editMode &&
                      (isBlockType(id, "weapon-widget") || isBlockType(id, "main-widgets") || isBlockType(id, "modifier-widget"))
                        ? `<button type="button" class="mini-btn" data-ov-remove-block="${id}">Remove</button>`
                        : ""
                    }
                  </div>
                  ${
                    isBlockType(id, "base-strip")
                      ? `<article class="main-strip">
                          <p class="section-header">Base</p>
                          <div id="main-combat-strip"></div>
                        </article>`
                      : isBlockType(id, "initiative-strip")
                        ? `<article class="main-initiative-box">
                            <p class="section-header">Initiative</p>
                            <div id="main-initiative-strip" class="main-initiative-strip"></div>
                          </article>`
                      : isBlockType(id, "skills-strip")
                        ? `<article class="main-skills-box">
                            <p class="section-header">Skills</p>
                            <div id="main-skills-strip" class="main-skills-strip"></div>
                          </article>`
                      : isBlockType(id, "weapon-widget")
                        ? `<article class="weapon-widget" data-weapon-widget-id="${escapeHtml(id)}"></article>`
                      : isBlockType(id, "modifier-widget")
                        ? `<article class="modifier-widget" data-modifier-widget-id="${escapeHtml(id)}"></article>`
                        : `<article class="custom-widgets" data-main-widgets-id="${escapeHtml(id)}"></article>`
                  }
                </article>`
                )
                .join("")}
            </section>`
            )
            .join("")}
        </div>
        </div>`
        )
        .join("")}
    </div>
  `;
  root.mainCombatStrip = document.querySelector("#main-combat-strip");
  root.mainInitiativeStrip = document.querySelector("#main-initiative-strip");
  root.mainSkillsStrip = document.querySelector("#main-skills-strip");
  root.modifierWidget = document.querySelector("[data-modifier-widget-id]");
  root.weaponWidget = document.querySelector("[data-weapon-widget-id]");
  root.mainWidgets = document.querySelector("[data-main-widgets-id]");

  root.overviewWorkspace.querySelectorAll("[data-ov-block]").forEach((el) => {
    el.addEventListener("dragstart", (event) => {
      if (!editMode) {
        event.preventDefault();
        return;
      }
      const fromInteractive = event.target?.closest?.("button,input,select,textarea,label,a");
      if (fromInteractive) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.setData("text/plain", el.dataset.ovBlock);
      event.dataTransfer.effectAllowed = "move";
    });
  });
  root.overviewWorkspace.querySelectorAll("[data-ov-col]").forEach((colEl) => {
    colEl.addEventListener("dragleave", () => {
      colEl.classList.remove("drag-over");
    });
    colEl.addEventListener("dragover", (event) => {
      if (!editMode) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      colEl.classList.add("drag-over");
    });
    colEl.addEventListener("drop", (event) => {
      if (!editMode) return;
      event.preventDefault();
      colEl.classList.remove("drag-over");
      const blockId = event.dataTransfer.getData("text/plain");
      const toRow = Number(colEl.dataset.ovRow);
      const toCol = Number(colEl.dataset.ovCol);
      const targetBlock = event.target.closest("[data-ov-block]");
      let toIdx = rows[toRow].cols[toCol].length;
      if (targetBlock) {
        const tId = targetBlock.dataset.ovBlock;
        const hit = rows[toRow].cols[toCol].indexOf(tId);
        if (hit >= 0) toIdx = hit;
      }
      store.patch((draft) => {
        const nextRows = normalizeOverviewRows(draft.overviewLayout?.rows);
        for (const r of nextRows) {
          for (const c of r.cols) {
            const i = c.indexOf(blockId);
            if (i >= 0) c.splice(i, 1);
          }
        }
        nextRows[toRow].cols[toCol].splice(
          Math.max(0, Math.min(toIdx, nextRows[toRow].cols[toCol].length)),
          0,
          blockId
        );
        draft.overviewLayout = { rows: nextRows };
      });
    });
  });
  root.overviewWorkspace.querySelectorAll("[data-ov-row-up]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rowIdx = Number(btn.dataset.ovRowUp);
      store.patch((draft) => {
        const rowsNow = normalizeOverviewRows(draft.overviewLayout?.rows);
        if (rowIdx <= 0 || rowIdx >= rowsNow.length) return;
        const tmp = rowsNow[rowIdx - 1];
        rowsNow[rowIdx - 1] = rowsNow[rowIdx];
        rowsNow[rowIdx] = tmp;
        draft.overviewLayout = { rows: rowsNow };
      });
    });
  });
  root.overviewWorkspace.querySelectorAll("[data-ov-row-down]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rowIdx = Number(btn.dataset.ovRowDown);
      store.patch((draft) => {
        const rowsNow = normalizeOverviewRows(draft.overviewLayout?.rows);
        if (rowIdx < 0 || rowIdx >= rowsNow.length - 1) return;
        const tmp = rowsNow[rowIdx + 1];
        rowsNow[rowIdx + 1] = rowsNow[rowIdx];
        rowsNow[rowIdx] = tmp;
        draft.overviewLayout = { rows: rowsNow };
      });
    });
  });
  root.overviewWorkspace.querySelector("#ov-add-row-btn")?.addEventListener("click", () => {
    const layout = root.overviewWorkspace.querySelector("#ov-add-row-size")?.value || "half";
    const rowColsByLayout = {
      half: 1,
      halves: 2,
      thirds: 3,
      oneThirdTwoThird: 2,
      twoThirdOneThird: 2,
    };
    const cols = rowColsByLayout[layout] || 1;
    store.patch((draft) => {
      const nextRows = normalizeOverviewRows(draft.overviewLayout?.rows);
      nextRows.push({ layout, cols: Array.from({ length: cols }, () => []) });
      draft.overviewLayout = { rows: nextRows };
    });
  });
  root.overviewWorkspace.querySelector("#ov-add-attack-btn")?.addEventListener("click", () => {
    store.patch((draft) => {
      const rowsNow = normalizeOverviewRows(draft.overviewLayout?.rows);
      const id = `weapon-widget:${uid()}`;
      rowsNow[0].cols[0].push(id);
      draft.weaponWidgets = draft.weaponWidgets || {};
      draft.weaponWidgets[id] = structuredClone(draft.weaponWidgets?.["weapon-widget"] || createInitialState().weaponWidget);
      draft.overviewLayout = { rows: rowsNow };
    });
  });
  root.overviewWorkspace.querySelector("#ov-add-widgets-btn")?.addEventListener("click", () => {
    store.patch((draft) => {
      const rowsNow = normalizeOverviewRows(draft.overviewLayout?.rows);
      const id = `main-widgets:${uid()}`;
      rowsNow[0].cols[0].push(id);
      draft.widgetGroups = draft.widgetGroups || {};
      draft.widgetGroups[id] = { title: "Flex Widget", widgets: [] };
      draft.overviewLayout = { rows: rowsNow };
    });
  });
  root.overviewWorkspace.querySelector("#ov-add-modifier-btn")?.addEventListener("click", () => {
    store.patch((draft) => {
      const rowsNow = normalizeOverviewRows(draft.overviewLayout?.rows);
      const id = `modifier-widget:${uid()}`;
      rowsNow[0].cols[0].push(id);
      draft.base.modifierGroups = draft.base.modifierGroups || {};
      draft.base.modifierGroups[id] = { title: "Modifier Widget", rows: [] };
      draft.overviewLayout = { rows: rowsNow };
    });
  });
  root.overviewWorkspace.querySelectorAll("[data-ov-remove-block]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const blockId = btn.dataset.ovRemoveBlock;
      if (!blockId) return;
      store.patch((draft) => {
        const rowsNow = normalizeOverviewRows(draft.overviewLayout?.rows);
        for (const r of rowsNow) {
          for (const c of r.cols) {
            const idx = c.indexOf(blockId);
            if (idx >= 0) c.splice(idx, 1);
          }
        }
        if (isBlockType(blockId, "weapon-widget") && draft.weaponWidgets?.[blockId]) {
          delete draft.weaponWidgets[blockId];
        }
        if (isBlockType(blockId, "main-widgets") && draft.widgetGroups?.[blockId]) {
          delete draft.widgetGroups[blockId];
        }
        if (isBlockType(blockId, "modifier-widget") && draft.base?.modifierGroups?.[blockId]) {
          delete draft.base.modifierGroups[blockId];
        }
        draft.overviewLayout = { rows: compactOverviewRows(rowsNow) };
      });
    });
  });
}

function addRollLog(messageOrEntry, isError = false) {
  const payload =
    typeof messageOrEntry === "object" && messageOrEntry !== null
      ? messageOrEntry
      : { message: String(messageOrEntry ?? "") };
  store.patch((draft) => {
    draft.rollLog.unshift({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: payload.name || "",
      message: payload.message || "",
      isError,
      ts: new Date().toLocaleTimeString(),
    });
    draft.rollLog = draft.rollLog.slice(0, 40);
  });
}

function persistState(state) {
  const toSave = structuredClone(state);
  toSave.rollLog = [];
  if (toSave.ui) toSave.ui.rollLogOpen = false;
  toSave.saveMeta = toSave.saveMeta || {};
  if (!toSave.saveMeta.saveId) toSave.saveMeta.saveId = uid();
  if (!toSave.saveMeta.saveName) toSave.saveMeta.saveName = "New Save";
  saveState(toSave);
}

function renderRollLog(state) {
  root.rollLog.innerHTML = state.rollLog
    .map((entry, index) => {
      const title = entry.name
        ? `<div><strong>${entry.name}</strong> <span class="muted">[${entry.ts}]</span></div>`
        : `<div><span class="muted">[${entry.ts}]</span> ${entry.message}</div>`;
      let body = "";
      if (entry.name) {
        const match = String(entry.message).match(/^(-?\d+)\s*(.*)$/);
        if (match) {
          const result = match[1];
          const build = match[2] || "";
          body = `<div><span class="roll-result">${result}</span> ${build}</div>`;
        } else {
          body = `<div><span class="roll-result">${entry.message}</span></div>`;
        }
      }
      const latestClass = index === 0 ? " latest-roll" : "";
      return `<div class="log-entry${latestClass} ${entry.isError ? "error" : "success"}">${title}${body}</div>`;
    })
    .join("");
  const isOpen = Boolean(state.ui.rollLogOpen);
  root.rollLogPopup.classList.toggle("open", isOpen);
  root.rollLogPopup.setAttribute("aria-hidden", String(!isOpen));
  root.rollLogToggle.textContent = isOpen ? "Hide Roll Log" : "Roll Log";
}

function renderCharacterManager(state) {
  if (!root.charactersPopup || !root.charactersList) return;
  const entries = listCharacterSaves()
    .sort((a, b) => b.lastSavedAt - a.lastSavedAt)
    .map(
      (row) => `<div class="log-entry ${row.isActive ? "latest-roll" : ""}">
        <div><strong>${escapeHtml(row.saveName)}</strong> <span class="muted">(${escapeHtml(row.characterName)})</span></div>
        <div class="row">
          <button type="button" class="mini-btn" data-load-char-id="${row.id}">Load</button>
          <span class="muted">${row.lastSavedAt ? new Date(row.lastSavedAt).toLocaleString() : ""}</span>
        </div>
      </div>`
    )
    .join("");
  root.charactersList.innerHTML = entries || `<p class="muted">No saved characters yet.</p>`;
  const isOpen = Boolean(state.ui.characterManagerOpen);
  root.charactersPopup.classList.toggle("open", isOpen);
  root.charactersPopup.setAttribute("aria-hidden", String(!isOpen));
  root.charactersList.querySelectorAll("[data-load-char-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.loadCharId;
      const loaded = loadCharacterById(id);
      if (!loaded) return;
      store.patch((draft) => {
        Object.assign(draft, loaded);
        draft.ui.characterManagerOpen = false;
      });
      addRollLog(`Loaded character: ${loaded.saveMeta?.saveName || loaded.base?.characterName || "Character"}`, false);
    });
  });
}

function renderOverview(state) {
  renderOverviewWorkspace(state);
  const perceptionBonus = state.derived.defense.perception - 10;
  const fortBonus = state.derived.defense.fortitude - 10;
  const reflexBonus = state.derived.defense.reflex - 10;
  const willBonus = state.derived.defense.will - 10;
  const acBonus = state.derived.defense.ac - 10;
  const classDcBonus = state.derived.classDc - 10;

  root.mainCombatStrip.innerHTML = `
    <div class="row strip-row">
      <span class="strip-group">
        <label class="strip-label">HP: <input id="strip-hp-current" type="number" value="${state.base.hp.current}" /></label>
        <span>/ ${state.derived.hp.max}</span>
        <label class="strip-label">Temp HP: <input id="strip-hp-temp" type="number" value="${state.base.hp.temp}" /></label>
      </span>
      <span class="strip-group">
        <span class="defense-pill">Speed ${Number(state.derived.speed || state.base.baseSpeed || 0)} ft</span>
      </span>
    </div>
    <div class="row strip-row">
      <span class="defense-group">
        <button type="button" class="defense-pill roll-pill" data-roll-name="Fortitude" data-roll-bonus="${fortBonus}">+${fortBonus} Fortitude</button>
        <button type="button" class="defense-pill roll-pill" data-roll-name="Reflex" data-roll-bonus="${reflexBonus}">+${reflexBonus} Reflex</button>
        <button type="button" class="defense-pill roll-pill" data-roll-name="Will" data-roll-bonus="${willBonus}">+${willBonus} Will</button>
      </span>
    </div>
    <div class="row strip-row">
      <span class="defense-group">
        <button type="button" class="defense-pill defense-pill-ac roll-pill" data-roll-name="AC" data-roll-bonus="${acBonus}">AC${state.derived.defense.ac}</button>
        <label class="strip-label">
          <input id="strip-raise-shield" type="checkbox" ${state.base.toggles?.raiseShield ? "checked" : ""} />
          Shield/ Parry
        </label>
        <button type="button" class="defense-pill roll-pill" data-roll-name="Class DC" data-roll-bonus="${classDcBonus}">Class DC ${state.derived.classDc}</button>
      </span>
    </div>
  `;
  if (root.mainInitiativeStrip) {
    root.mainInitiativeStrip.innerHTML = `
      <div class="row strip-row">
        <span class="strip-group strip-pill-group">
          <button type="button" class="defense-pill roll-pill" data-roll-name="Initiative" data-roll-bonus="${state.derived.initiative}">+${state.derived.initiative} Initiative</button>
          <button type="button" class="defense-pill roll-pill" data-roll-name="Perception" data-roll-bonus="${perceptionBonus}">+${perceptionBonus} Perception</button>
        </span>
      </div>
    `;
  }
  const skillOrder = [
    "acrobatics",
    "arcana",
    "athletics",
    "crafting",
    "deception",
    "diplomacy",
    "intimidation",
    "medicine",
    "nature",
    "occultism",
    "performance",
    "religion",
    "society",
    "stealth",
    "survival",
    "thievery",
  ];
  root.mainSkillsStrip.innerHTML = skillOrder
    .map((name) => {
      const bonus = state.derived.skills[name];
      const label = `${name[0].toUpperCase()}${name.slice(1)}`;
      const ability = String(state.derived.skillAbilities?.[name] || "str").toUpperCase();
      return `<button type="button" class="defense-pill roll-pill skill-roll-pill" data-roll-name="${label}" data-roll-bonus="${bonus}">+${bonus} ${label} (${ability})</button>`;
    })
    .join(" ");
  const customSkillRows = (state.base.customProficiencies?.skill || [])
    .filter((entry) => String(entry.name || "").trim())
    .map((entry) => {
      const rank = entry.rank || "untrained";
      const abilityKey = state.base.customSkillAbilities?.[entry.id] || "str";
      const abilityMod = Number(state.derived.mods?.[abilityKey] || 0);
      const bonus = Number(state.base.level || 0) + profRankToBonus(rank) + abilityMod;
      const label = String(entry.name).trim();
      const ability = String(abilityKey).toUpperCase();
      return `<button type="button" class="defense-pill roll-pill skill-roll-pill custom-skill-roll-pill" data-roll-name="${escapeHtml(
        label
      )}" data-roll-bonus="${bonus}">${bonus >= 0 ? "+" : ""}${bonus} ${escapeHtml(label)} (${ability})</button>`;
    })
    .join(" ");
  if (customSkillRows) {
    root.mainSkillsStrip.innerHTML += ` ${customSkillRows}`;
  }
  const modifierRowsFlat = flattenModifierRows(state.base);

  const modifierTargets = [
    { value: "all", label: "All" },
    { value: "attack", label: "Attack rolls" },
    { value: "atk", label: "atk (alias)" },
    { value: "damage", label: "Damage" },
    { value: "dmg", label: "dmg (alias)" },
    { value: "ac", label: "AC" },
    { value: "classDc", label: "Class DC" },
    { value: "initiative", label: "Initiative" },
    { value: "perception", label: "Perception" },
    { value: "fortitude", label: "Fortitude" },
    { value: "reflex", label: "Reflex" },
    { value: "will", label: "Will" },
    { value: "skill", label: "All Skills" },
    ...Object.keys(SKILL_TO_ABILITY).map((k) => ({ value: `skill:${k}`, label: `Skill: ${k}` })),
  ];
  const modifierTables = [...document.querySelectorAll("[data-modifier-widget-id]")];
  root.modifierWidget = modifierTables[0] || null;
  modifierTables.forEach((container) => {
    const blockId = container.dataset.modifierWidgetId || "modifier-widget";
    const group = state.base.modifierGroups?.[blockId] || { title: "Modifier Widget", rows: [] };
    const tableRows = Array.isArray(group.rows) ? group.rows : [];
    const editingId = state.ui.modifierWidgetGroupId === blockId ? state.ui.modifierWidgetEditingId : null;
    const editing = tableRows.find((m) => m.id === editingId) || null;
    const rows = tableRows
      .map((m) => {
        const effectText = Array.isArray(m.effectsBatches) && m.effectsBatches.length
          ? m.effectsBatches.map((b) => `${b.target || "all"} / ${b.type || "untyped"} / ${b.effect || "0"}`).join(" + ")
          : String(m.effect ?? m.value ?? "");
        return `<div class="modifier-row-card">
          <div class="modifier-row-main">
            <strong>${escapeHtml(m.label || "Modifier")}</strong>
            <span class="muted">${escapeHtml(effectText || "0")}</span>
          </div>
          <label class="modifier-onoff">
            <input type="checkbox" data-mod-enabled-toggle="${m.id}" ${m.enabled === false ? "" : "checked"} />
            <span>${m.enabled === false ? "Off" : "On"}</span>
          </label>
          <button type="button" class="custom-widget-edit-btn" data-mod-edit="${m.id}" aria-label="Edit modifier">⚙</button>
        </div>`;
      })
      .join("");
    const editingBatches = Array.isArray(editing?.effectsBatches)
      ? editing.effectsBatches
      : [
          {
            target: editing?.target || "all",
            type: editing?.type || "untyped",
            effect: editing?.effect ?? editing?.value ?? "0",
            enabled: true,
          },
        ];
    const editingEffectInputs = (editingBatches.length ? editingBatches : [{ target: "all", type: "untyped", effect: "0", enabled: true }])
      .map(
        (fx, i) => `<div class="row modifier-effect-row">
          <label>Affects</label>
          <div class="modifier-affects-grid">
            ${modifierTargets
              .map((o) => {
                const targets = Array.isArray(fx?.targets) ? fx.targets : [fx?.target || "all"];
                return `<label class="modifier-affect-pill"><input type="checkbox" data-mod-batch-target="${i}" value="${o.value}" ${
                  targets.includes(o.value) ? "checked" : ""
                } /> ${o.label}</label>`;
              })
              .join("")}
          </div>
          <label>Bonus type
            <select data-mod-batch-type="${i}">
              ${MODIFIER_TYPES.map((t) => `<option value="${t}" ${String(fx?.type || "untyped") === t ? "selected" : ""}>${t}</option>`).join("")}
            </select>
          </label>
          <label>Effect ${i + 1} <input data-mod-batch-effect="${i}" value="${escapeHtml(String(fx?.effect || ""))}" placeholder="+1 or 1d6" /></label>
          <button type="button" class="mini-btn" data-mod-del-effect-idx="${i}">Remove</button>
        </div>`
      )
      .join("");
    container.innerHTML = `
      <div class="custom-widgets-header-row">
        <p class="section-header">${escapeHtml(group.title || "Modifier Widget")}</p>
      </div>
      <div class="custom-widgets-toolbar">
        <button type="button" data-mod-add-btn="${escapeHtml(blockId)}">Add</button>
      </div>
      <div class="modifier-list-wrap">${rows || `<p class="muted">No modifiers yet.</p>`}</div>
      <div class="weapon-editor-popup ${state.ui.modifierWidgetEditorOpen && state.ui.modifierWidgetGroupId === blockId ? "" : "hidden"}">
        <div class="weapon-editor-card">
          <p class="section-header">${editing ? "Edit Modifier" : "Add Modifier"}</p>
          <div class="row"><label>Widget name <input id="mod-widget-name" value="${escapeHtml(group.title || "Modifier Widget")}" /></label></div>
          <div class="row"><label>Name <input id="mod-name" value="${escapeHtml(editing?.label || "")}" /></label></div>
          <p class="section-header">Effects</p>
          <div id="mod-effects">${editingEffectInputs}</div>
          <div class="row"><button type="button" id="mod-add-effect-btn">Add Effect</button></div>
          <div class="row"><label>Enabled <input id="mod-enabled" type="checkbox" ${editing?.enabled === false ? "" : "checked"} /></label></div>
          <div class="row"><button type="button" id="mod-save-btn">Save</button><button type="button" id="mod-cancel-btn">Cancel</button></div>
        </div>
      </div>
    `;
    container.querySelector("[data-mod-add-btn]")?.addEventListener("click", () => {
      store.patch((draft) => {
        draft.ui.modifierWidgetEditorOpen = true;
        draft.ui.modifierWidgetEditingId = null;
        draft.ui.modifierWidgetGroupId = blockId;
      });
    });
    container.querySelectorAll("[data-mod-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        store.patch((draft) => {
          draft.ui.modifierWidgetEditorOpen = true;
          draft.ui.modifierWidgetEditingId = btn.dataset.modEdit;
          draft.ui.modifierWidgetGroupId = blockId;
        });
      });
    });
    container.querySelectorAll("[data-mod-enabled-toggle]").forEach((el) => {
      el.addEventListener("change", () => {
        const id = el.dataset.modEnabledToggle;
        store.patch((draft) => {
          const g = draft.base.modifierGroups?.[blockId];
          const row = (g?.rows || []).find((m) => m.id === id);
          if (row) row.enabled = Boolean(el.checked);
        });
      });
    });
    container.querySelector("#mod-cancel-btn")?.addEventListener("click", () => {
      store.patch((draft) => {
        draft.ui.modifierWidgetEditorOpen = false;
        draft.ui.modifierWidgetEditingId = null;
        draft.ui.modifierWidgetGroupId = blockId;
      });
    });
    container.querySelector("#mod-save-btn")?.addEventListener("click", () => {
      const name = container.querySelector("#mod-name")?.value || "";
      const widgetName = container.querySelector("#mod-widget-name")?.value || "Modifier Widget";
      const effectInputs = [...container.querySelectorAll("[data-mod-batch-effect]")];
      const effectsBatches = effectInputs
        .map((el) => {
          const idx = String(el.dataset.modBatchEffect || "");
          const targetInputs = [...container.querySelectorAll(`[data-mod-batch-target="${idx}"]`)];
          const targets = targetInputs.filter((n) => n.checked).map((n) => n.value);
          const type = container.querySelector(`[data-mod-batch-type="${idx}"]`)?.value || "untyped";
          const effect = String(el.value || "").trim();
          if (!effect) return null;
          return { target: targets[0] || "all", targets: targets.length ? targets : ["all"], type, effect, enabled: true };
        })
        .filter(Boolean);
      const enabled = Boolean(container.querySelector("#mod-enabled")?.checked);
      store.patch((draft) => {
        draft.base.modifierGroups = draft.base.modifierGroups || {};
        draft.base.modifierGroups[blockId] = draft.base.modifierGroups[blockId] || { title: "Modifier Widget", rows: [] };
        draft.base.modifierGroups[blockId].title = String(widgetName || "Modifier Widget");
        const rowsNow = draft.base.modifierGroups[blockId].rows || [];
        const id = draft.ui.modifierWidgetEditingId;
        const existing = id ? rowsNow.find((m) => m.id === id) : null;
        const numericTotal = effectsBatches.reduce((sum, e) => {
          const n = Number(e.effect);
          return sum + (Number.isFinite(n) ? n : 0);
        }, 0);
        if (existing) {
          existing.label = name;
          existing.effectsBatches = effectsBatches;
          existing.effect = effectsBatches.map((e) => e.effect).join(" + ");
          existing.value = numericTotal;
          existing.enabled = enabled;
        } else {
          rowsNow.push({
            id: uid(),
            label: name,
            effectsBatches,
            effect: effectsBatches.map((e) => e.effect).join(" + "),
            value: numericTotal,
            enabled,
          });
        }
        draft.base.modifierGroups[blockId].rows = rowsNow;
        draft.ui.modifierWidgetEditorOpen = false;
        draft.ui.modifierWidgetEditingId = null;
        draft.ui.modifierWidgetGroupId = blockId;
      });
    });
    container.querySelector(".weapon-editor-popup")?.addEventListener("click", (event) => {
      if (!event.target.classList.contains("weapon-editor-popup")) return;
      store.patch((draft) => {
        draft.ui.modifierWidgetEditorOpen = false;
        draft.ui.modifierWidgetEditingId = null;
        draft.ui.modifierWidgetGroupId = blockId;
      });
    });
    container.querySelector("#mod-add-effect-btn")?.addEventListener("click", () => {
      const holder = container.querySelector("#mod-effects");
      const nextIdx = holder ? holder.querySelectorAll("[data-mod-batch-effect]").length : 0;
      if (!holder) return;
      const row = document.createElement("div");
      row.className = "row modifier-effect-row";
      row.innerHTML = `<label>Affects</label>
      <div class="modifier-affects-grid">
        ${modifierTargets
          .map(
            (o) =>
              `<label class="modifier-affect-pill"><input type="checkbox" data-mod-batch-target="${nextIdx}" value="${o.value}" ${
                o.value === "all" ? "checked" : ""
              } /> ${o.label}</label>`
          )
          .join("")}
      </div>
      <label>Bonus type
        <select data-mod-batch-type="${nextIdx}">
          ${MODIFIER_TYPES.map((t) => `<option value="${t}">${t}</option>`).join("")}
        </select>
      </label>
      <label>Effect ${nextIdx + 1} <input data-mod-batch-effect="${nextIdx}" placeholder="+1 or 1d6" /></label>
      <button type="button" class="mini-btn" data-mod-del-effect-idx="${nextIdx}">Remove</button>`;
      holder.appendChild(row);
      row.querySelector("[data-mod-del-effect-idx]")?.addEventListener("click", () => row.remove());
    });
    container.querySelectorAll("[data-mod-del-effect-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        btn.closest(".modifier-effect-row")?.remove();
      });
    });
  });

  const defaultWeapon = createInitialState().weaponWidget;
  const renderDamageEditorRow = (damage) => `
    <div class="row weapon-editor-row">
      <label>Label <input data-ww-kind="damage" data-ww-id="${damage.id}" data-ww-field="label" value="${escapeHtml(damage.label)}" /></label>
      <label>Formula <input data-ww-kind="damage" data-ww-id="${damage.id}" data-ww-field="formula" value="${escapeHtml(damage.formula)}" /></label>
    </div>`;
  const weaponContainers = [...document.querySelectorAll("[data-weapon-widget-id]")];
  root.weaponWidget = weaponContainers[0] || null;
  weaponContainers.forEach((el) => {
    const blockId = el.dataset.weaponWidgetId || "weapon-widget";
    const widget = structuredClone(state.weaponWidgets?.[blockId] || state.weaponWidgets?.["weapon-widget"] || defaultWeapon);
    const attackGroupName = String(widget.groupName || "Attack Widget").trim() || "Attack Widget";
    const attackBonusTotal = (widget.attackBonuses || []).filter((b) => b.on).reduce((sum, b) => sum + Number(b.bonus || 0), 0);
    const strikeBase =
      weaponStrikeBase(state, widget) + attackBonusTotal + summarizeModifiers(modifierRowsFlat, "attack").total;
    const mapStep = Math.max(0, Number(widget.mapPenalty ?? 5));
    const strikeBonuses = [strikeBase, strikeBase - mapStep, strikeBase - 2 * mapStep];
    const strikeLabels = ["1st", "2nd", "3rd"];
    const fmtAtk = (n) => `${n >= 0 ? "+" : ""}${n}`;
    const atkProfMode = widget.attackProficiency || "weapon";
    const attackRows = strikeBonuses
      .map(
        (bonus, i) => `
        <button type="button" class="weapon-roll-btn" data-roll-name="${escapeHtml(widget.name)} Strike (${strikeLabels[i]})" data-roll-bonus="${bonus}">${fmtAtk(
          bonus
        )}</button>
      `
      )
      .join("");
    const dmgAbilityMod = weaponDamageAbilityMod(state, widget);
    const hitFormulaBase = buildWeaponHitFormula(widget, dmgAbilityMod);
    const critFormulaBase = buildWeaponCritFormula(widget, dmgAbilityMod);
    const damageModifierEffects = selectModifierEffects(modifierRowsFlat, "damage");
    const hitFormula = [hitFormulaBase, ...damageModifierEffects].filter(Boolean).join("+");
    const critFormula = [critFormulaBase, ...damageModifierEffects].filter(Boolean).join("+");
    const hitLabel = escapeHtml(widget.damages?.[0]?.label || "Damage");
    const critLabel = escapeHtml(widget.damages?.[1]?.label || "Critical");
    const toggleRows = (widget.damageToggles || [])
      .map(
        (t) => `
        <label class="weapon-toggle">
          <input type="checkbox" data-ww-toggle-id="${escapeHtml(t.id)}" ${t.on ? "checked" : ""} />
          <span>${escapeHtml(t.label)}</span>
        </label>
      `
      )
      .join("");
    const attackToggleRows = (widget.attackBonuses || [])
      .map(
        (b) => `
        <label class="weapon-toggle">
          <input type="checkbox" data-ww-atk-toggle-id="${escapeHtml(b.id)}" ${b.on ? "checked" : ""} />
          <span>${escapeHtml(b.label)} ${Number(b.bonus || 0) >= 0 ? "+" : ""}${Number(b.bonus || 0)}</span>
        </label>
      `
      )
      .join("");
    const damageRows = widget.damages || [];
    const hitEditorRow = damageRows[0] ? renderDamageEditorRow(damageRows[0]) : "";
    const critEditorRow = damageRows[1] ? renderDamageEditorRow(damageRows[1]) : "";
    const toggleEditorRows = (widget.damageToggles || [])
      .map(
        (t) => `
        <div class="weapon-bonus-row">
          <label>Label <input data-ww-kind="damageToggle" data-ww-id="${t.id}" data-ww-field="label" value="${escapeHtml(t.label)}" /></label>
          <label>Bonus dice <input data-ww-kind="damageToggle" data-ww-id="${t.id}" data-ww-field="formula" value="${escapeHtml(t.formula)}" placeholder="e.g. 2d6 or +4" /></label>
          <label class="weapon-toggle-inline"><input type="checkbox" data-ww-kind="damageToggle" data-ww-id="${t.id}" data-ww-field="multiplyOnCrit" ${
            t.multiplyOnCrit !== false ? "checked" : ""
          } /> x2 on crit</label>
          <button type="button" class="weapon-del-toggle-btn" data-ww-del-toggle="${escapeHtml(t.id)}">Remove</button>
        </div>
      `
      )
      .join("");
    const attackBonusEditorRows = (widget.attackBonuses || [])
      .map(
        (b) => `
        <div class="weapon-bonus-row">
          <label>Label <input data-ww-atk-bonus-id="${b.id}" data-ww-field="label" value="${escapeHtml(b.label)}" /></label>
          <label>Bonus <input data-ww-atk-bonus-id="${b.id}" data-ww-field="bonus" type="number" value="${Number(b.bonus || 0)}" /></label>
          <label class="weapon-toggle-inline"><input type="checkbox" data-ww-atk-bonus-id="${b.id}" data-ww-field="on" ${
            b.on ? "checked" : ""
          } /> active</label>
          <button type="button" class="weapon-del-toggle-btn" data-ww-del-atk-bonus="${escapeHtml(b.id)}">Remove</button>
        </div>
      `
      )
      .join("");
    el.innerHTML = `
      <div class="row weapon-head-row">
        <h3 class="weapon-title">${escapeHtml(widget.name || "Attack")}</h3>
        <button type="button" id="weapon-widget-config-btn" class="weapon-settings-btn" aria-label="Configure weapon widget">⚙</button>
      </div>
      ${widget.subtitle ? `<div class="weapon-subtitle muted">${escapeHtml(widget.subtitle)}</div>` : ""}
      <hr class="weapon-separator" />
      ${attackToggleRows ? `<div class="weapon-damage-toggles">${attackToggleRows}</div>` : ""}
      <div class="weapon-attacks row">${attackRows}</div>
      <div class="weapon-damage row">
        <button type="button" class="weapon-roll-btn weapon-damage-main-btn" data-roll-name="${escapeHtml(widget.name)} ${hitLabel}" data-roll-formula="${escapeHtml(hitFormula)}">Damage</button>
        <button type="button" class="weapon-roll-btn weapon-crit-mini-btn" title="${escapeHtml(
          `${critLabel}: ${critFormula}`
        )}" aria-label="${escapeHtml(critLabel)}" data-roll-name="${escapeHtml(widget.name)} ${critLabel}" data-roll-formula="${escapeHtml(critFormula)}">Critical</button>
      </div>
      <div class="weapon-damage-line"><strong>${escapeHtml(hitFormula)}</strong> <span class="muted">${escapeHtml(widget.damageType)}</span></div>
      ${(widget.damageToggles || []).length ? `<div class="weapon-damage-toggles weapon-damage-toggles-bottom">${toggleRows}</div>` : ""}
      <div class="weapon-editor-popup ${state.ui.weaponWidgetEditorOpen && state.ui.weaponWidgetEditingId === blockId ? "" : "hidden"}">
        <div class="weapon-editor-card">
        <p class="section-header">Weapon</p>
        <div class="weapon-editor-grid">
          <label>Name <input data-ww-field="name" value="${widget.name}" /></label>
        <label>Weapon category
          <select data-ww-field="proficiencyType">
            ${WEAPON_PROF_TYPES.map((type) => `<option value="${type}" ${widget.proficiencyType === type ? "selected" : ""}>${type}</option>`).join("")}
          </select>
        </label>
        <label>Weapon proficiency
          <select data-ww-field="attackProficiency">
            <option value="weapon" ${atkProfMode === "weapon" ? "selected" : ""}>Weapon category (above)</option>
            <option value="classDcRank" ${atkProfMode === "classDcRank" ? "selected" : ""}>Class DC rank + level + ability</option>
            <option value="classDcMinus10" ${atkProfMode === "classDcMinus10" ? "selected" : ""}>Class DC − 10</option>
          </select>
        </label>
        <label>Damage type
          <select data-ww-field="damageType">
            ${DAMAGE_TYPES.map((type) => `<option value="${type}" ${widget.damageType === type ? "selected" : ""}>${type}</option>`).join("")}
          </select>
        </label>
        <label>Attack ability
          <select data-ww-field="attackAbility">
            ${ATTACK_ABILITY_SELECT.map(
              (o) =>
                `<option value="${o.value}" ${(widget.attackAbility || "maxStrDex") === o.value ? "selected" : ""}>${o.label}</option>`
            ).join("")}
          </select>
        </label>
        <label>Damage ability
          <select data-ww-field="damageAbility">
            ${DAMAGE_ABILITY_SELECT.map(
              (o) => `<option value="${o.value}" ${(widget.damageAbility || "none") === o.value ? "selected" : ""}>${o.label}</option>`
            ).join("")}
          </select>
        </label>
      </div>
      <div class="row">
        <label>Custom text <input data-ww-field="subtitle" value="${escapeHtml(widget.subtitle || "")}" placeholder="shown under header" /></label>
      </div>
      <hr class="section-divider" />
      <p class="section-header">MAP</p>
      <div class="row weapon-editor-map-row">
        <label>MAP <input data-ww-field="mapPenalty" type="number" min="0" step="1" value="${Number(widget.mapPenalty ?? 5)}" /></label>
      </div>
      <hr class="section-divider" />
      <p class="section-header">Damage Rolls</p>
      ${hitEditorRow}
      <p class="section-header">Critical hit</p>
      <p class="muted weapon-crit-hint">Critical uses this row, plus any checked bonuses with their x2-on-crit setting.</p>
      ${critEditorRow}
      <hr class="section-divider" />
      <p class="section-header">Bonus</p>
      <p class="section-header">Attack bonuses</p>
      ${attackBonusEditorRows || `<p class="muted">No attack bonuses yet.</p>`}
      <button type="button" data-ww-add-atk-bonus>Add attack bonus</button>
      <p class="section-header">Damage bonuses</p>
      <p class="muted weapon-crit-hint">Checked bonuses apply to hit; each bonus can be set to x2 on crit or stay single.</p>
      ${toggleEditorRows || `<p class="muted">No toggles yet — add one below.</p>`}
      <button type="button" data-ww-add-toggle>Add toggle</button>
      <div class="row">
        <label>Group name <input data-ww-field="groupName" value="${escapeHtml(attackGroupName)}" /></label>
      </div>
      <div class="row">
        <button type="button" id="weapon-widget-close-btn">Done</button>
      </div>
      <div class="row widget-delete-row">
        <button type="button" id="weapon-widget-delete-btn" class="danger-btn">Delete Attack Widget</button>
      </div>
      </div>
    </div>
  `;
  });
  document.querySelector("#strip-hp-current")?.addEventListener("change", (event) => {
    store.patch((draft) => {
      draft.base.hp.current = Number(event.currentTarget.value || 0);
    });
  });
  document.querySelector("#strip-hp-temp")?.addEventListener("change", (event) => {
    store.patch((draft) => {
      draft.base.hp.temp = Number(event.currentTarget.value || 0);
    });
  });
  document.querySelector("#strip-raise-shield")?.addEventListener("change", (event) => {
    store.patch((draft) => {
      draft.base.toggles.raiseShield = Boolean(event.currentTarget.checked);
    });
  });

  document.querySelectorAll(".roll-pill").forEach((button) => {
    button.addEventListener("click", () => {
      const name = button.dataset.rollName || "Check";
      const bonus = Number(button.dataset.rollBonus || 0);
      const d20 = Math.floor(Math.random() * 20) + 1;
      const total = d20 + bonus;
      const sign = bonus >= 0 ? "+" : "-";
      const absBonus = Math.abs(bonus);
      addRollLog(
        {
          name,
          message: `${total} (1d20: ${d20} ${sign} ${absBonus})`,
        },
        false
      );
      store.patch((draft) => {
        draft.ui.rollLogOpen = true;
      });
    });
  });

  document.querySelectorAll(".weapon-roll-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const name = button.dataset.rollName || "Weapon";
      const formula = button.dataset.rollFormula;
      if (formula) {
        try {
          const { total, breakdown } = rollDiceExpression(formula);
          addRollLog({ name, message: `${total} (${breakdown.join(", ")})` }, false);
        } catch (_err) {
          addRollLog({ name, message: `Failed roll: ${formula}` }, true);
        }
      } else {
        const bonus = Number(button.dataset.rollBonus || 0);
        const d20 = Math.floor(Math.random() * 20) + 1;
        const total = d20 + bonus;
        const sign = bonus >= 0 ? "+" : "-";
        addRollLog({ name, message: `${total} (1d20: ${d20} ${sign} ${Math.abs(bonus)})` }, false);
      }
      store.patch((draft) => {
        draft.ui.rollLogOpen = true;
      });
    });
  });

  weaponContainers.forEach((container) => {
    const blockId = container.dataset.weaponWidgetId || "weapon-widget";
    container.querySelector("#weapon-widget-config-btn")?.addEventListener("click", () => {
      store.patch((draft) => {
        draft.ui.weaponWidgetEditorOpen = true;
        draft.ui.weaponWidgetEditingId = blockId;
      });
    });
    container.querySelector("#weapon-widget-close-btn")?.addEventListener("click", () => {
      store.patch((draft) => {
        draft.ui.weaponWidgetEditorOpen = false;
      });
    });
    container.querySelector("#weapon-widget-delete-btn")?.addEventListener("click", () => {
      if (!window.confirm("Are you sure you wish to delete this widget? It cannot be undone")) return;
      store.patch((draft) => {
        const rowsNow = normalizeOverviewRows(draft.overviewLayout?.rows);
        let removed = false;
        for (const r of rowsNow) {
          for (const c of r.cols) {
            const idx = c.indexOf(blockId);
            if (idx >= 0 && !removed) {
              c.splice(idx, 1);
              removed = true;
            }
          }
        }
        draft.overviewLayout = { rows: compactOverviewRows(rowsNow) };
        draft.ui.weaponWidgetEditorOpen = false;
        draft.ui.overviewLayoutEdit = false;
        if (draft.weaponWidgets?.[blockId]) delete draft.weaponWidgets[blockId];
      });
    });
    container.querySelectorAll("input[data-ww-field],select[data-ww-field]").forEach((el) => {
      const applyField = (event) => {
        const target = event.currentTarget;
        const field = target.dataset.wwField;
        store.patch((draft) => {
          draft.weaponWidgets = draft.weaponWidgets || {};
          draft.weaponWidgets[blockId] = draft.weaponWidgets[blockId] || structuredClone(createInitialState().weaponWidget);
          const ww = draft.weaponWidgets[blockId];
          if (field === "mapPenalty") {
            ww[field] = Number(target.value || 0);
          } else if (field === "groupName") {
            ww.groupName = String(target.value || "");
          } else {
            ww[field] = target.value;
          }
        });
      };
      el.addEventListener("change", applyField);
      if (el.dataset.wwField === "mapPenalty") {
        el.addEventListener("input", applyField);
      }
    });
    container.querySelectorAll("input[data-ww-kind],select[data-ww-kind]").forEach((el) => {
      el.addEventListener("change", (event) => {
        const target = event.currentTarget;
        const kind = target.dataset.wwKind;
        const id = target.dataset.wwId;
        const field = target.dataset.wwField;
        store.patch((draft) => {
          const ww = draft.weaponWidgets?.[blockId];
          const row = ww?.[`${kind}s`]?.find((r) => r.id === id);
          if (!row) return;
          if (field === "modifier" || field === "map") row[field] = Number(target.value || 0);
          else if (target.type === "checkbox") row[field] = Boolean(target.checked);
          else row[field] = target.value;
        });
      });
    });
    container.querySelectorAll("input[data-ww-toggle-id]").forEach((el) => {
      el.addEventListener("change", () => {
        const id = el.dataset.wwToggleId;
        store.patch((draft) => {
          const t = (draft.weaponWidgets?.[blockId]?.damageToggles || []).find((x) => x.id === id);
          if (t) t.on = Boolean(el.checked);
        });
      });
    });
    container.querySelectorAll("input[data-ww-atk-toggle-id]").forEach((el) => {
      el.addEventListener("change", () => {
        const id = el.dataset.wwAtkToggleId;
        store.patch((draft) => {
          const b = (draft.weaponWidgets?.[blockId]?.attackBonuses || []).find((x) => x.id === id);
          if (b) b.on = Boolean(el.checked);
        });
      });
    });
    container.querySelector("[data-ww-add-toggle]")?.addEventListener("click", () => {
      store.patch((draft) => {
        draft.weaponWidgets = draft.weaponWidgets || {};
        draft.weaponWidgets[blockId] = draft.weaponWidgets[blockId] || structuredClone(createInitialState().weaponWidget);
        draft.weaponWidgets[blockId].damageToggles = draft.weaponWidgets[blockId].damageToggles || [];
        draft.weaponWidgets[blockId].damageToggles.push({
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          label: "Bonus",
          formula: "1d6",
          on: false,
          multiplyOnCrit: true,
        });
      });
    });
    container.querySelectorAll("[data-ww-del-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.wwDelToggle;
        store.patch((draft) => {
          const ww = draft.weaponWidgets?.[blockId];
          if (!ww) return;
          ww.damageToggles = (ww.damageToggles || []).filter((t) => t.id !== id);
        });
      });
    });
    container.querySelectorAll("input[data-ww-atk-bonus-id]").forEach((el) => {
      el.addEventListener("change", (event) => {
        const id = el.dataset.wwAtkBonusId;
        const field = el.dataset.wwField;
        const target = event.currentTarget;
        store.patch((draft) => {
          const b = (draft.weaponWidgets?.[blockId]?.attackBonuses || []).find((x) => x.id === id);
          if (!b) return;
          if (field === "bonus") b[field] = Number(target.value || 0);
          else if (field === "on") b[field] = Boolean(target.checked);
          else b[field] = target.value;
        });
      });
    });
    container.querySelector("[data-ww-add-atk-bonus]")?.addEventListener("click", () => {
      store.patch((draft) => {
        draft.weaponWidgets = draft.weaponWidgets || {};
        draft.weaponWidgets[blockId] = draft.weaponWidgets[blockId] || structuredClone(createInitialState().weaponWidget);
        draft.weaponWidgets[blockId].attackBonuses = draft.weaponWidgets[blockId].attackBonuses || [];
        draft.weaponWidgets[blockId].attackBonuses.push({
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          label: "Attack bonus",
          bonus: 1,
          on: true,
        });
      });
    });
    container.querySelectorAll("[data-ww-del-atk-bonus]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.wwDelAtkBonus;
        store.patch((draft) => {
          const ww = draft.weaponWidgets?.[blockId];
          if (!ww) return;
          ww.attackBonuses = (ww.attackBonuses || []).filter((b) => b.id !== id);
        });
      });
    });
    container.querySelector(".weapon-editor-popup")?.addEventListener("click", (event) => {
      if (event.target.classList.contains("weapon-editor-popup")) {
        store.patch((draft) => {
          draft.ui.weaponWidgetEditorOpen = false;
        });
      }
    });
  });

  const mainWidgetContainers = [...document.querySelectorAll("[data-main-widgets-id]")];
  root.mainWidgets = mainWidgetContainers[0] || null;
  mainWidgetContainers.forEach((container) => {
    const groupId = container.dataset.mainWidgetsId || "main-widgets";
    const group = state.widgetGroups?.[groupId] || { title: "Flex Widget", widgets: [] };
    const editId = state.ui.customWidgetGroupId === groupId ? state.ui.customWidgetEditingId : null;
    const editing = (group.widgets || []).find((w) => w.id === editId) || null;
    const widgetRows = (group.widgets || [])
      .map((w) => {
        const isOpen = w.collapsed !== true;
        const body = `<div class="custom-widget-text">${escapeHtml(w.content || "").replace(/\n/g, "<br />")}</div>`;
        const toggleCount = Math.max(0, Number(w.toggleCount || 0));
        const toggleStates = Array.from({ length: toggleCount }, (_, i) => Boolean(w.toggleStates?.[i]));
        const rollDefs = [parseRollField(w.roll1, "Roll 1"), parseRollField(w.roll2, "Roll 2")].filter(Boolean);
        const headerRollButtons = rollDefs
          .map(
            (r) =>
              `<button type="button" class="mini-btn" data-cw-roll-id="${w.id}" data-cw-roll-label="${escapeHtml(
                r.label
              )}" data-cw-roll-formula="${escapeHtml(r.formula)}">${escapeHtml(r.formula)}</button>`
          )
          .join(" ");
        const headerToggleDots =
          toggleCount > 0
            ? `<span class="custom-widget-dot-group">${toggleStates
                .map(
                  (on, i) =>
                    `<button type="button" class="custom-widget-dot ${on ? "on" : ""}" data-cw-dot-id="${w.id}" data-cw-dot-index="${i}" aria-label="Toggle ${
                      i + 1
                    }" title="Toggle ${i + 1}"></button>`
                )
                .join("")}</span>`
            : "";
        return `<article class="custom-widget-card">
          <div class="custom-widget-head">
            <button type="button" class="custom-widget-collapse" data-cw-toggle="${w.id}" aria-label="Toggle widget">${isOpen ? "▼" : "▶"}</button>
            <button type="button" class="custom-widget-title-btn" data-cw-toggle="${w.id}">${escapeHtml(w.title || "Untitled")}</button>
            ${headerRollButtons}
            ${headerToggleDots}
            <button type="button" class="mini-btn" data-cw-up="${w.id}" aria-label="Move up">↑</button>
            <button type="button" class="mini-btn" data-cw-down="${w.id}" aria-label="Move down">↓</button>
            <button type="button" class="custom-widget-edit-btn" data-cw-edit="${w.id}" aria-label="Edit widget">⚙</button>
          </div>
          ${isOpen ? `<div class="custom-widget-body">${body}</div>` : ""}
        </article>`;
      })
      .join("");
    container.innerHTML = `
      <div class="custom-widgets-header-row">
        <p class="section-header">${escapeHtml(group.title || "Flex Widget")}</p>
      </div>
      <div class="custom-widgets-toolbar"><button type="button" id="cw-add-btn">Add Ability</button></div>
      <div>${widgetRows || `<p class="muted">No custom widgets yet.</p>`}</div>
      <div class="weapon-editor-popup ${state.ui.customWidgetEditorOpen && state.ui.customWidgetGroupId === groupId ? "" : "hidden"}">
        <div class="weapon-editor-card">
          <p class="section-header">${editing ? "Edit Widget" : "Add Widget"}</p>
          <div class="row"><label>Group name <input id="cw-group-name" value="${escapeHtml(group.title || "Flex Widget")}" /></label></div>
          <div class="row"><label>Title <input id="cw-title" value="${escapeHtml(editing?.title || "")}" /></label></div>
          <label>Content <textarea id="cw-content" placeholder="Any text content.">${escapeHtml(editing?.content || "")}</textarea></label>
          <div class="row">
            <label>Roll 1 <input id="cw-roll1" value="${escapeHtml(editing?.roll1 || "")}" placeholder="Attack: 1d20 + $str + 12" /></label>
            <label>Roll 2 <input id="cw-roll2" value="${escapeHtml(editing?.roll2 || "")}" placeholder="Damage: 2d6 + $str" /></label>
            <label>Toggle count <input id="cw-toggle-count" type="number" min="0" max="5" step="1" value="${Math.min(5, editing?.toggleCount || 0)}" /></label>
          </div>
          <div class="row"><button type="button" id="cw-save-btn">Save</button><button type="button" id="cw-cancel-btn">Cancel</button></div>
          ${editing ? `<div class="row widget-delete-row"><button type="button" id="cw-delete-btn" class="danger-btn">Delete Widget</button></div>` : ""}
        </div>
      </div>
    `;
    container.querySelector("#cw-add-btn")?.addEventListener("click", () => {
      store.patch((draft) => {
        draft.ui.customWidgetEditorOpen = true;
        draft.ui.customWidgetEditingId = null;
        draft.ui.customWidgetGroupId = groupId;
      });
    });
    container.querySelector("#cw-cancel-btn")?.addEventListener("click", () => {
      store.patch((draft) => {
        draft.ui.customWidgetEditorOpen = false;
        draft.ui.customWidgetEditingId = null;
      });
    });
    container.querySelector("#cw-save-btn")?.addEventListener("click", () => {
    const title = container.querySelector("#cw-title")?.value?.trim() || "";
    const content = container.querySelector("#cw-content")?.value || "";
    const roll1 = container.querySelector("#cw-roll1")?.value || "";
    const roll2 = container.querySelector("#cw-roll2")?.value || "";
    const toggleCount = Math.min(5, Math.max(0, Number(container.querySelector("#cw-toggle-count")?.value || 0)));
    const groupName = container.querySelector("#cw-group-name")?.value || "";
    if (!title) return;
    store.patch((draft) => {
      draft.widgetGroups = draft.widgetGroups || {};
      draft.widgetGroups[groupId] = draft.widgetGroups[groupId] || { title: "Flex Widget", widgets: [] };
      draft.widgetGroups[groupId].title = String(groupName || "Flex Widget");
      const widgets = draft.widgetGroups[groupId].widgets || [];
      const id = draft.ui.customWidgetEditingId;
      const existing = id ? widgets.find((w) => w.id === id) : null;
      if (existing) {
        existing.title = title;
        existing.content = content;
        existing.roll1 = roll1;
        existing.roll2 = roll2;
        existing.toggleCount = toggleCount;
        const prev = Array.isArray(existing.toggleStates) ? existing.toggleStates.map((v) => Boolean(v)) : [];
        const next = Array.from({ length: toggleCount }, (_, i) => Boolean(prev[i]));
        if (toggleCount > 0 && !next.some(Boolean)) next[0] = true;
        existing.toggleStates = next;
        if (typeof existing.active !== "boolean") existing.active = false;
      } else {
        const w = {
          id: uid(),
          title,
          content,
          roll1,
          roll2,
          toggleCount,
          toggleStates: Array.from({ length: toggleCount }, (_, i) => i === 0),
          collapsed: false,
          active: false,
        };
        widgets.push(w);
      }
      draft.widgetGroups[groupId].widgets = widgets;
      draft.ui.customWidgetEditorOpen = false;
      draft.ui.customWidgetEditingId = null;
    });
    });
    container.querySelectorAll("[data-cw-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.cwEdit;
        store.patch((draft) => {
          draft.ui.customWidgetEditorOpen = true;
          draft.ui.customWidgetEditingId = id;
          draft.ui.customWidgetGroupId = groupId;
        });
      });
    });
    container.querySelector("#cw-delete-btn")?.addEventListener("click", () => {
      const id = store.getState().ui.customWidgetEditingId;
      if (!id) return;
      if (!window.confirm("Are you sure you wish to delete this widget? It cannot be undone")) return;
      store.patch((draft) => {
        const widgets = draft.widgetGroups?.[groupId]?.widgets || [];
        draft.widgetGroups[groupId].widgets = widgets.filter((w) => w.id !== id);
        draft.ui.customWidgetEditorOpen = false;
        draft.ui.customWidgetEditingId = null;
      });
    });
    container.querySelectorAll("[data-cw-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.cwToggle;
        store.patch((draft) => {
          const w = (draft.widgetGroups?.[groupId]?.widgets || []).find((x) => x.id === id);
          if (w) w.collapsed = !w.collapsed;
        });
      });
    });
    container.querySelectorAll("[data-cw-up],[data-cw-down]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.cwUp || btn.dataset.cwDown;
        const dir = btn.dataset.cwUp ? -1 : 1;
        store.patch((draft) => {
          const widgets = draft.widgetGroups?.[groupId]?.widgets || [];
          const idx = widgets.findIndex((w) => w.id === id);
          const nextIdx = idx + dir;
          if (idx < 0 || nextIdx < 0 || nextIdx >= widgets.length) return;
          const tmp = widgets[idx];
          widgets[idx] = widgets[nextIdx];
          widgets[nextIdx] = tmp;
        });
      });
    });
    container.querySelectorAll("[data-cw-dot-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.cwDotId;
        const idx = Number(btn.dataset.cwDotIndex || -1);
        if (idx < 0) return;
        store.patch((draft) => {
          const w = (draft.widgetGroups?.[groupId]?.widgets || []).find((x) => x.id === id);
          if (!w) return;
          const count = Math.max(0, Number(w.toggleCount || 0));
          const next = Array.from({ length: count }, (_, i) => Boolean(w.toggleStates?.[i]));
          next[idx] = !next[idx];
          w.toggleStates = next;
        });
      });
    });
    container.querySelectorAll("[data-cw-roll-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const wid = btn.dataset.cwRollId;
        const label = btn.dataset.cwRollLabel || "Roll";
        const formula = btn.dataset.cwRollFormula || "";
        try {
          const vars = resolveVariableMap(store.getState());
          const resolved = evaluateExpression(formula, (name) => vars[String(name || "").toLowerCase()]);
          const { total, breakdown } = rollDiceExpression(resolved);
          const widgetName =
            (store.getState().widgetGroups?.[groupId]?.widgets || []).find((w) => w.id === wid)?.title || "Widget";
          addRollLog(
            {
              name: `${widgetName}: ${label}`,
              message: `${total} (${breakdown.join(", ")}${resolved !== formula ? `; ${resolved}` : ""})`,
            },
            false
          );
          store.patch((draft) => {
            draft.ui.rollLogOpen = true;
          });
        } catch (_err) {
          addRollLog(`Invalid quick roll: ${formula}`, true);
        }
      });
    });
    container.querySelector(".weapon-editor-popup")?.addEventListener("click", (event) => {
      if (event.target.classList.contains("weapon-editor-popup")) {
        store.patch((draft) => {
          draft.ui.customWidgetEditorOpen = false;
          draft.ui.customWidgetEditingId = null;
        });
      }
    });
    container.querySelector("#cw-group-name")?.addEventListener("change", (event) => {
      const value = event.currentTarget.value || "";
      store.patch((draft) => {
        draft.widgetGroups = draft.widgetGroups || {};
        draft.widgetGroups[groupId] = draft.widgetGroups[groupId] || { title: "Flex Widget", widgets: [] };
        draft.widgetGroups[groupId].title = String(value || "Flex Widget");
      });
    });
  });
}

function renderAll() {
  const state = store.getState();
  if (!isHydrating) {
    persistState(state);
  }
  try {
    resolveVariableMap(state);
  } catch (err) {
    addRollLog(`Variable validation: ${err.message}`, true);
  }
  renderBasePanel(root.base, state, store);
  if (root.characterHeaderName) {
    const name = String(state.base.characterName || "").trim() || "Character";
    root.characterHeaderName.textContent = name;
  }
  renderOverview(state);
  renderRollLog(state);
  renderCharacterManager(state);
}

store.subscribe(renderAll);
renderAll();
isHydrating = false;

document.querySelectorAll(".tab-btn").forEach((tab) => {
  tab.addEventListener("click", () => {
    const name = tab.dataset.tab;
    document.querySelectorAll(".tab-btn").forEach((btn) => btn.classList.toggle("active", btn === tab));
    document.querySelectorAll(".tab-panel").forEach((panel) =>
      panel.classList.toggle("active", panel.id === `tab-${name}`)
    );
    store.patch((draft) => {
      draft.ui.activeTab = name;
    });
  });
});

root.exportBtn?.addEventListener("click", () => {
  const state = store.getState();
  const exportState = structuredClone(state);
  exportState.saveMeta = exportState.saveMeta || {};
  if (!exportState.saveMeta.saveId) exportState.saveMeta.saveId = uid();
  if (!exportState.saveMeta.saveName) exportState.saveMeta.saveName = "New Save";
  const json = JSON.stringify(exportState, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const safeName = String(exportState.saveMeta.saveName || "save")
    .trim()
    .replace(/[^a-z0-9-_]+/gi, "_")
    .slice(0, 40);
  const fname = `${safeName || "save"}_${exportState.saveMeta.saveId}.json`;
  const a = document.createElement("a");
  a.href = url;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  addRollLog(`Exported ${fname}`, false);
});

root.charactersBtn?.addEventListener("click", () => {
  store.patch((draft) => {
    draft.ui.characterManagerOpen = !draft.ui.characterManagerOpen;
  });
});

root.charactersClose?.addEventListener("click", () => {
  store.patch((draft) => {
    draft.ui.characterManagerOpen = false;
  });
});

root.newCharacterBtn?.addEventListener("click", () => {
  const fresh = createInitialState();
  store.patch((draft) => {
    Object.assign(draft, fresh);
  });
  addRollLog("Created new character.", false);
});

root.importBtn?.addEventListener("click", () => {
  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = ".json,application/json";
  picker.addEventListener("change", async () => {
    const file = picker.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || !parsed.base) throw new Error("Invalid character file");
      if (!parsed.saveMeta || typeof parsed.saveMeta !== "object") parsed.saveMeta = {};
      if (!parsed.saveMeta.saveId) parsed.saveMeta.saveId = uid();
      if (!parsed.saveMeta.saveName) parsed.saveMeta.saveName = "Imported Save";
      store.patch((draft) => {
        Object.assign(draft, parsed);
      });
      addRollLog(`Imported ${parsed.saveMeta.saveName}`, false);
    } catch (_err) {
      addRollLog("Import failed: invalid JSON character file.", true);
    }
  });
  picker.click();
});

root.overviewEditBtn?.addEventListener("click", () => {
  store.patch((draft) => {
    const next = !draft.ui.overviewLayoutEdit;
    draft.ui.overviewLayoutEdit = next;
    if (!next) {
      draft.overviewLayout = { rows: compactOverviewRows(draft.overviewLayout?.rows) };
    }
  });
});

root.rollLogToggle.addEventListener("click", () => {
  store.patch((draft) => {
    draft.ui.rollLogOpen = !draft.ui.rollLogOpen;
  });
});

root.rollLogClose.addEventListener("click", () => {
  store.patch((draft) => {
    draft.ui.rollLogOpen = false;
  });
});
