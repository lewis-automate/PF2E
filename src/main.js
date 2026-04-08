import { createStore, createInitialState } from "./state/store.js";
import {
  loadState,
  saveState,
  listCharacterSaves,
  loadCharacterById,
  renameCharacterById,
  deleteCharacterById,
} from "./state/persist.js";
import { profRankToBonus, SKILL_TO_ABILITY } from "./engine/calc.js";
import { MODIFIER_TYPES, summarizeModifiers, selectModifierEffects } from "./engine/modifiers.js";
import { rollDiceExpression } from "./engine/roller.js";
import { buildWeaponHitFormula, buildWeaponCritFormula } from "./engine/weaponDamage.js";
import { evaluateExpression, expandTemplate } from "./engine/formula.js";
import { renderBasePanel } from "./ui/basePanel.js";
import { resolveVariableMap } from "./ui/variablesPanel.js";

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function listAvailableVariableTokens(state) {
  let map = {};
  try {
    map = resolveVariableMap(state) || {};
  } catch (_err) {
    map = {};
  }
  const canonical = new Set(
    Object.keys(map).map((k) => String(k || "").trim().toLowerCase().replace(/-/g, "_")).filter(Boolean)
  );
  canonical.add("attack_widget_header_name");
  return [...canonical]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => `$${name}`);
}

function insertTokenAtCursor(el, token) {
  if (!el) return;
  const value = String(el.value || "");
  const start = Number.isFinite(el.selectionStart) ? el.selectionStart : value.length;
  const end = Number.isFinite(el.selectionEnd) ? el.selectionEnd : start;
  const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
  el.value = next;
  const caret = start + token.length;
  if (typeof el.setSelectionRange === "function") el.setSelectionRange(caret, caret);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.focus();
}

function replaceVariableTokenAtCursor(el, replacement) {
  if (!el) return;
  const value = String(el.value || "");
  const caret = Number.isFinite(el.selectionStart) ? el.selectionStart : value.length;
  const left = value.slice(0, caret);
  const right = value.slice(caret);
  const match = left.match(/[$@][a-zA-Z0-9_-]*$/);
  if (!match) {
    insertTokenAtCursor(el, replacement);
    return;
  }
  const start = caret - match[0].length;
  const next = `${value.slice(0, start)}${replacement}${right}`;
  el.value = next;
  const nextCaret = start + replacement.length;
  if (typeof el.setSelectionRange === "function") el.setSelectionRange(nextCaret, nextCaret);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.focus();
}

function bindVariableAutocomplete(scope = document, tokens = []) {
  const existing = document.querySelector("#variable-autocomplete-popup");
  if (existing) existing.remove();
  const popup = document.createElement("div");
  popup.id = "variable-autocomplete-popup";
  popup.className = "variable-autocomplete-popup hidden";
  document.body.appendChild(popup);
  let activeInput = null;
  let options = [];
  let activeIndex = 0;

  const close = () => {
    popup.classList.add("hidden");
    popup.innerHTML = "";
    activeInput = null;
    options = [];
    activeIndex = 0;
  };

  const openFor = (input) => {
    activeInput = input;
    const rect = input.getBoundingClientRect();
    popup.style.left = `${Math.max(8, rect.left)}px`;
    popup.style.top = `${Math.min(window.innerHeight - 10, rect.bottom + 4)}px`;
    popup.style.width = `${Math.max(200, rect.width)}px`;
    popup.classList.remove("hidden");
  };

  const render = () => {
    if (!activeInput || !options.length) {
      close();
      return;
    }
    popup.innerHTML = options
      .map(
        (token, idx) =>
          `<button type="button" class="variable-autocomplete-item ${idx === activeIndex ? "active" : ""}" data-var-ac-opt="${escapeHtml(token)}">${escapeHtml(token)}</button>`
      )
      .join("");
    popup.querySelectorAll("[data-var-ac-opt]").forEach((btn, idx) => {
      btn.addEventListener("mousedown", (event) => {
        event.preventDefault();
        replaceVariableTokenAtCursor(activeInput, options[idx]);
        close();
      });
    });
  };

  const updateForInput = (input) => {
    const caret = Number.isFinite(input.selectionStart) ? input.selectionStart : String(input.value || "").length;
    const left = String(input.value || "").slice(0, caret);
    const match = left.match(/[$@]([a-zA-Z0-9_-]*)$/);
    if (!match) {
      close();
      return;
    }
    const typed = String(match[1] || "").toLowerCase();
    const filtered = tokens.filter((token) => token.slice(1).toLowerCase().startsWith(typed)).slice(0, 12);
    if (!filtered.length) {
      close();
      return;
    }
    if (activeInput !== input) activeIndex = 0;
    options = filtered;
    openFor(input);
    render();
  };

  const targets = scope.querySelectorAll('input[list],textarea[list],input[data-armor-field="modifiers"],#cw-roll1,#cw-roll2');
  targets.forEach((input) => {
    if (!input || (input.tagName !== "INPUT" && input.tagName !== "TEXTAREA")) return;
    input.addEventListener("input", () => updateForInput(input));
    input.addEventListener("click", () => updateForInput(input));
    input.addEventListener("focus", () => updateForInput(input));
    input.addEventListener("blur", () => {
      setTimeout(() => {
        if (!popup.matches(":hover")) close();
      }, 120);
    });
    input.addEventListener("keydown", (event) => {
      if (popup.classList.contains("hidden")) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        activeIndex = (activeIndex + 1) % Math.max(1, options.length);
        render();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        activeIndex = (activeIndex - 1 + Math.max(1, options.length)) % Math.max(1, options.length);
        render();
      } else if (event.key === "Enter" || event.key === "Tab") {
        if (!options.length) return;
        event.preventDefault();
        replaceVariableTokenAtCursor(input, options[activeIndex] || options[0]);
        close();
      } else if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    });
  });
}

function bindVariableInsertHandlers(scope = document) {
  scope.querySelectorAll("button[data-var-token]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const token = String(btn.dataset.varToken || "");
      const targetSelector = String(btn.dataset.varTarget || "").trim();
      if (!token || !targetSelector) return;
      const card = btn.closest(".weapon-editor-card") || document;
      const active = document.activeElement;
      const useActive =
        active &&
        (active.tagName === "INPUT" || active.tagName === "TEXTAREA") &&
        typeof active.matches === "function" &&
        active.matches(targetSelector);
      const target = useActive ? active : card.querySelector(targetSelector);
      insertTokenAtCursor(target, token);
    });
  });
}

function renderVariableAssist(listId, tokens, targetSelector = "") {
  const options = tokens.map((token) => `<option value="${escapeHtml(token)}"></option>`).join("");
  const shown = tokens.slice(0, 18);
  const chips = shown
    .map(
      (token) =>
        `<button type="button" class="mini-btn variable-chip-btn" data-var-token="${escapeHtml(token)}" data-var-target="${escapeHtml(targetSelector)}">${escapeHtml(token)}</button>`
    )
    .join(" ");
  return {
    listAttr: `list="${escapeHtml(listId)}"`,
    datalistHtml: `<datalist id="${escapeHtml(listId)}">${options}</datalist>`,
    hintHtml: `<div class="muted variable-hint"><span class="variable-help">Click a variable to insert at cursor, or type <code>$</code> then letters. Typed bonus syntax: <code>[circumstance:1]</code>.</span><br />Variables: ${chips || `<code>$level</code>`}${tokens.length > shown.length ? " ..." : ""} <span class="muted">(@ also works)</span></div>`,
  };
}

function coerceArmorState(armor) {
  const base = armor && typeof armor === "object" ? armor : {};
  const legacyPotency = Number(base.potencyRune || 0);
  const existingBonuses = Array.isArray(base.bonuses) ? base.bonuses : [];
  const bonuses = existingBonuses.map((b) => ({
    id: String(b?.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`),
    label: String(b?.label || "Armor bonus"),
    bonus: Number(b?.bonus || 0),
    type: MODIFIER_TYPES.includes(String(b?.type || "").toLowerCase()) ? String(b.type).toLowerCase() : "item",
  }));
  if (legacyPotency !== 0 && !bonuses.length) {
    bonuses.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      label: "Potency",
      bonus: legacyPotency,
      type: "item",
    });
  }
  return {
    name: String(base.name || ""),
    group: String(base.group || ""),
    bulk: String(base.bulk || ""),
    acBonus: Number(base.acBonus || 0),
    dexCap: Number.isFinite(Number(base.dexCap)) ? Number(base.dexCap) : 5,
    checkPenalty: Number(base.checkPenalty || 0),
    speedPenalty: Number(base.speedPenalty || 0),
    strengthRequirement: Number(base.strengthRequirement || 0),
    bonuses,
    enchantments: String(base.enchantments || ""),
    modifiers: String(base.modifiers || ""),
    modifierValue: Number(base.modifierValue || 0),
  };
}

const root = {
  base: document.querySelector("#base-panel"),
  characterHeaderName: document.querySelector("#character-header-name"),
  overviewEditBtn: document.querySelector("#overview-edit-btn"),
  manageCharactersBtn: document.querySelector("#manage-characters-btn"),
  manageCharactersPopup: document.querySelector("#manage-characters-popup"),
  manageCharactersOpenBtn: document.querySelector("#manage-characters-open-btn"),
  manageImportBtn: document.querySelector("#manage-import-btn"),
  manageExportBtn: document.querySelector("#manage-export-btn"),
  rollLog: document.querySelector("#roll-log"),
  rollLogPopup: document.querySelector("#roll-log-popup"),
  rollLogToggle: document.querySelector("#roll-log-toggle"),
  rollLogClose: document.querySelector("#roll-log-close"),
  quickRollToggle: document.querySelector("#quick-roll-toggle"),
  quickRollPopup: document.querySelector("#quick-roll-popup"),
  quickRollClose: document.querySelector("#quick-roll-close"),
  quickRollD20Btn: document.querySelector("#quick-roll-d20-btn"),
  quickRollApplyBtn: document.querySelector("#quick-roll-apply-btn"),
  quickRollCount: document.querySelector("#quick-roll-count"),
  quickRollSides: document.querySelector("#quick-roll-sides"),
  charactersPopup: document.querySelector("#characters-popup"),
  charactersList: document.querySelector("#characters-list"),
  charactersNewBtn: document.querySelector("#characters-new-btn"),
  charactersSaveAsBtn: document.querySelector("#characters-save-as-btn"),
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
const REQUIRED_OVERVIEW_BLOCKS = ["base-strip", "initiative-strip", "skills-strip", "modifier-widget"];
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
    seeded.base.modifierGroups[gid] = { title: "Modifier Widget", rows: [], library: [] };
    continue;
  }
  if (typeof group.title !== "string" || !group.title.trim()) group.title = "Modifier Widget";
  if (!Array.isArray(group.rows)) group.rows = [];
  if (!Array.isArray(group.library)) group.library = [];
  group.rows = group.rows.map((row) => {
    const normalized = { ...(row || {}) };
    if (typeof normalized.showInOverview !== "boolean") normalized.showInOverview = true;
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
if (seeded.base?.modifierGroups && !seeded.base.modifierGroups["modifier-widget"]) {
  const legacyModifierKey = Object.keys(seeded.base.modifierGroups).find((k) => baseBlockType(k) === "modifier-widget");
  if (legacyModifierKey) {
    seeded.base.modifierGroups["modifier-widget"] = structuredClone(seeded.base.modifierGroups[legacyModifierKey]);
  } else {
    seeded.base.modifierGroups["modifier-widget"] = { title: "Modifier Widget", rows: [], library: [] };
  }
}
if (seeded.base && !Number.isFinite(Number(seeded.base.baseSpeed))) {
  seeded.base.baseSpeed = 25;
}
if (seeded.base && !Array.isArray(seeded.base.speedChanges)) {
  seeded.base.speedChanges = [];
}
if (seeded.base && Array.isArray(seeded.base.speedChanges)) {
  seeded.base.speedChanges = seeded.base.speedChanges.map((row) => {
    const type = String(row?.type || "item").toLowerCase();
    return {
      id: String(row?.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`),
      label: String(row?.label || ""),
      value: Number(row?.value || 0),
      type: MODIFIER_TYPES.includes(type) ? type : "item",
    };
  });
}
if (seeded.base && (!seeded.base.toggles || typeof seeded.base.toggles !== "object")) {
  seeded.base.toggles = { raiseShield: false, raiseShieldBonus: 1 };
}
if (seeded.base) {
  seeded.base.armor = coerceArmorState(seeded.base.armor);
}
if (seeded.base && typeof seeded.base.toggles.raiseShield !== "boolean") {
  seeded.base.toggles.raiseShield = false;
}
if (seeded.base && !Number.isFinite(Number(seeded.base.toggles.raiseShieldBonus))) {
  seeded.base.toggles.raiseShieldBonus = 1;
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
if (seeded.ui && typeof seeded.ui.modifierPresetBrowserOpen !== "boolean") {
  seeded.ui.modifierPresetBrowserOpen = false;
}
if (seeded.ui && typeof seeded.ui.modifierPresetGroupId !== "string") {
  seeded.ui.modifierPresetGroupId = "modifier-widget";
}
if (seeded.ui && typeof seeded.ui.modifierPresetSearch !== "string") {
  seeded.ui.modifierPresetSearch = "";
}
if (seeded.ui && typeof seeded.ui.conditionInfoOpen !== "boolean") {
  seeded.ui.conditionInfoOpen = false;
}
if (seeded.ui && typeof seeded.ui.conditionInfoGroupId !== "string") {
  seeded.ui.conditionInfoGroupId = "modifier-widget";
}
if (seeded.ui && typeof seeded.ui.conditionInfoKey !== "string") {
  seeded.ui.conditionInfoKey = "";
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
if (seeded.ui && typeof seeded.ui.shieldSettingsOpen !== "boolean") {
  seeded.ui.shieldSettingsOpen = false;
}
if (seeded.ui && typeof seeded.ui.armorSettingsOpen !== "boolean") {
  seeded.ui.armorSettingsOpen = false;
}
if (seeded.ui && typeof seeded.ui.quickRollOpen !== "boolean") {
  seeded.ui.quickRollOpen = false;
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
    alwaysOn: t.alwaysOn === true,
    multiplyOnCrit: t.multiplyOnCrit !== false,
    type: MODIFIER_TYPES.includes(String(t.type || "").toLowerCase()) ? String(t.type).toLowerCase() : "untyped",
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
  ww.attackBonuses = ww.attackBonuses.map((b) => ({
    ...b,
    alwaysOn: b.alwaysOn === true,
    type: MODIFIER_TYPES.includes(String(b.type || "").toLowerCase()) ? String(b.type).toLowerCase() : "item",
  }));
  if (typeof ww.attackBonusFlat === "number" && ww.attackBonusFlat !== 0 && ww.attackBonuses.length === 0) {
    ww.attackBonuses.push({
      id: `ab-${Date.now()}`,
      label: "Legacy bonus",
      bonus: Number(ww.attackBonusFlat || 0),
      on: true,
      alwaysOn: false,
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
const CONDITION_RULES_TEXT = {
  blinded: `You can't see. All normal terrain is difficult terrain to you. You can't detect anything using vision. You automatically critically fail Perception checks that require you to be able to see, and if vision is your only precise sense, you take a -4 status penalty to Perception checks. You are immune to visual effects. Blinded overrides dazzled.`,
  broken: `Broken is a condition that affects only objects. An object is broken when damage has reduced its Hit Points to equal or less than its Broken Threshold. A broken object can't be used for its normal function, nor does it grant bonuses—with the exception of armor. Broken armor still grants its item bonus to AC, but it also imparts a status penalty to AC depending on its category: -1 for broken light armor, -2 for broken medium armor, or -3 for broken heavy armor.

A broken item still imposes penalties and limitations normally incurred by carrying, holding, or wearing it. For example, broken armor would still impose its Dexterity modifier cap, check penalty, and so forth. If an effect makes an item broken automatically and the item has more HP than its Broken Threshold, that effect also reduces the item's current HP to the Broken Threshold.`,
  clumsy: `Your movements become clumsy and inexact. Clumsy always includes a value. You take a status penalty equal to the condition value to Dexterity-based rolls and DCs, including AC, Reflex saves, ranged attack rolls, and skill checks using Acrobatics, Stealth, and Thievery.`,
  concealed: `You are difficult for one or more creatures to see due to thick fog or some other obscuring feature. You can be concealed to some creatures but not others. While concealed, you can still be observed, but you're tougher to target. A creature that you're concealed from must succeed at a DC 5 flat check when targeting you with an attack, spell, or other effect. If the check fails, you aren't affected. Area effects aren't subject to this flat check.`,
  confused: `You don't have your wits about you, and you attack wildly. You are off-guard, you don't treat anyone as your ally (though they might still treat you as theirs), and you can't Delay, Ready, or use reactions.

You use all your actions to Strike or cast offensive cantrips, though the GM can have you use other actions to facilitate attack, such as draw a weapon, move so target is in reach, and so forth. Your targets are determined randomly by the GM. If you have no other viable targets, you target yourself, automatically hitting but not scoring a critical hit. If it's impossible for you to attack or cast spells, you babble incoherently, wasting your actions.

Each time you take damage from an attack or spell, you can attempt a DC 11 flat check to recover from your confusion and end the condition.`,
  controlled: `You have been commanded, magically dominated, or otherwise had your will subverted. The controller dictates how you act and can make you use any of your actions, including attacks, reactions, or even Delay. The controller usually doesn't have to spend their own actions when controlling you.`,
  dazzled: `Your eyes are overstimulated or your vision is swimming. If vision is your only precise sense, all creatures and objects are concealed from you.`,
  deafened: `You can't hear. You automatically critically fail Perception checks that require you to be able to hear. You take a -2 status penalty to Perception checks for initiative and checks that involve sound but also rely on other senses. If you perform an action that has the auditory trait, you must succeed at a DC 5 flat check or the action is lost; attempt the check after spending the action but before any effects are applied. You are immune to auditory effects while deafened.`,
  doomed: `Your soul has been gripped by a powerful force that calls you closer to death. Doomed always includes a value. The dying value at which you die is reduced by your doomed value. If your maximum dying value is reduced to 0, you instantly die. When you die, you're no longer doomed.

Your doomed value decreases by 1 each time you get a full night's rest.`,
  drained: `Your health and vitality have been depleted as you've lost blood, life force, or some other essence. Drained always includes a value. You take a status penalty equal to your drained value on Constitution-based rolls and DCs, such as Fortitude saves. You also lose a number of Hit Points equal to your level (minimum 1) times the drained value, and your maximum Hit Points are reduced by the same amount. For example, if you become drained 3 and you're a 3rd-level character, you lose 9 Hit Points and reduce your maximum Hit Points by 9. Losing these Hit Points doesn't count as taking damage.

Each time you get a full night's rest, your drained value decreases by 1. This increases your maximum Hit Points, but you don't immediately recover the lost Hit Points.`,
  dying: `You are bleeding out or otherwise at death's door. While you have this condition, you are unconscious. Dying always includes a value, and if it ever reaches dying 4, you die. When you're dying, you must attempt a recovery check at the start of your turn each round to determine whether you get better or worse. Your dying condition increases by 1 if you take damage while dying, or by 2 if you take damage from an enemy's critical hit or a critical failure on your save.

If you lose the dying condition by succeeding at a recovery check and are still at 0 Hit Points, you remain unconscious, but you can wake up as described in that condition. You lose the dying condition automatically and wake up if you ever have 1 Hit Point or more. Any time you lose the dying condition, you gain the wounded 1 condition, or increase your wounded condition value by 1 if you already have that condition.`,
  encumbered: `You are carrying more weight than you can manage. While you're encumbered, you're clumsy 1 and take a 10-foot penalty to all your Speeds. As with all penalties to your Speed, this can't reduce your Speed below 5 feet.`,
  enfeebled: `You're physically weakened. Enfeebled always includes a value. When you are enfeebled, you take a status penalty equal to the condition value to Strength-based rolls and DCs, including Strength-based melee attack rolls, Strength-based damage rolls, and Athletics checks.`,
  fascinated: `You're compelled to focus your attention on something, distracting you from whatever else is going on around you. You take a -2 status penalty to Perception and skill checks, and you can't use concentrate actions unless they (or their intended consequences) are related to the subject of your fascination, as determined by the GM. For instance, you might be able to Seek and Recall Knowledge about the subject, but you likely couldn't cast a spell targeting a different creature. This condition ends if a creature uses hostile actions against you or any of your allies.`,
  fatigued: `You're tired and can't summon much energy. You take a -1 status penalty to AC and saving throws. You can't use exploration activities performed while traveling, such as those on pages 438-439.

You recover from fatigue after a full night's rest.`,
  fleeing: `You're forced to run away due to fear or some other compulsion. On your turn, you must spend each of your actions trying to escape the source of the fleeing condition as expediently as possible (such as by using move actions to flee, or opening doors barring your escape). The source is usually the effect or creature that gave you the condition, though some effects might define something else as the source. You can't Delay or Ready while fleeing.`,
  friendly: `This condition reflects a creature's disposition toward a particular character, and only supernatural effects (like a spell) can impose this condition on a PC. A creature that is friendly to a character likes that character. It is likely to agree to Requests from that character as long as they are simple, safe, and don't cost too much to fulfill. If the character (or one of their allies) uses hostile actions against the creature, the creature gains a worse attitude condition depending on the severity of the hostile action, as determined by the GM.`,
  frightened: `You're gripped by fear and struggle to control your nerves. The frightened condition always includes a value. You take a status penalty equal to this value to all your checks and DCs. Unless specified otherwise, at the end of each of your turns, the value of your frightened condition decreases by 1.`,
  grabbed: `You're held in place by another creature, giving you the off-guard and immobilized conditions. If you attempt a manipulate action while grabbed, you must succeed at a DC 5 flat check or it is lost; roll the check after spending the action, but before any effects are applied.`,
  helpful: `This condition reflects a creature's disposition toward a particular character, and only supernatural effects (like a spell) can impose this condition on a PC. A creature that is helpful to a character wishes to actively aid that character. It will accept reasonable Requests from that character, as long as such requests aren't at the expense of the helpful creature's goals or quality of life. If the character (or one of their allies) uses a hostile action against the creature, the creature gains a worse attitude condition depending on the severity of the hostile action, as determined by the GM.`,
  hidden: `While you're hidden from a creature, that creature knows the space you're in but can't tell precisely where you are. You typically become hidden by using Stealth to Hide. When Seeking a creature using only imprecise senses, it remains hidden, rather than observed. A creature you're hidden from is off-guard to you, and it must succeed at a DC 11 flat check when targeting you with an attack, spell, or other effect or it fails to affect you. Area effects aren't subject to this flat check.

A creature might be able to use the Seek action to try to observe you.`,
  hostile: `This condition reflects a creature's disposition toward a particular character, and only supernatural effects (like a spell) can impose on a PC. A creature hostile to a character actively seeks to harm that character. It doesn't necessarily attack, but it won't accept Requests from the character.`,
  immobilized: `You are incapable of movement. You can't use any actions that have the move trait. If you're immobilized by something holding you in place and an external force would move you out of your space, the force must succeed at a check against either the DC of the effect holding you in place or the relevant defense (usually Fortitude DC) of the monster holding you in place.`,
  indifferent: `This condition reflects a creature's disposition toward a particular character, and only supernatural effects (like a spell) can impose this condition on a PC. A creature that is indifferent to a character doesn't really care one way or the other about that character. Assume a creature's attitude to a given character is indifferent unless specified otherwise.`,
  invisible: `You can't be seen. You're undetected to everyone. Creatures can Seek to detect you; if a creature succeeds at its Perception check against your Stealth DC, you become hidden to that creature until you Sneak to become undetected again. If you become invisible while someone can already see you, you start out hidden to them (instead of undetected) until you successfully Sneak. You can't become observed while invisible except via special abilities or magic.`,
  observed: `Anything in plain view is observed by you. If a creature takes measures to avoid detection, such as by using Stealth to Hide, it can become hidden or undetected instead of observed. If you have another precise sense besides sight, you might be able to observe a creature or object using that sense instead. You can observe a creature with only your precise senses. When Seeking a creature using only imprecise senses, it remains hidden, rather than observed.`,
  "off-guard": `You're distracted or otherwise unable to focus your full attention on defense. You take a -2 circumstance penalty to AC. Some effects give you the off-guard condition only to certain creatures or against certain attacks. Others—especially conditions—can make you off-guard against everything. If a rule doesn't specify that the condition applies only to certain circumstances, it applies to all of them, such as "The target is off-guard."`,
  paralyzed: `You're frozen in place. You have the off-guard condition and can't act except to Recall Knowledge and use actions that require only your mind (as determined by the GM). Your senses still function, but only in the areas you can perceive without moving, so you can't Seek.`,
  "persistent-damage": `You are taking damage from an ongoing effect, such as from being lit on fire. This appears as "X persistent [type] damage," where "X" is the amount of damage dealt and "[type]" is the damage type. Like normal damage, it can be doubled or halved based on the results of an attack roll or saving throw. Instead of taking persistent damage immediately, you take it at the end of each of your turns as long as you have the condition, rolling any damage dice anew each time. After you take persistent damage, roll a DC 15 flat check to see if you recover from the persistent damage. If you succeed, the condition ends.

Persistent Damage Rules
The additional rules presented below apply to persistent damage in certain cases.

Persistent damage runs its course and automatically ends after a certain amount of time as fire burns out, blood clots, and the like. The GM determines when this occurs, but it usually takes 1 minute.
Assisted Recovery
You can take steps to help yourself recover from persistent damage, or an ally can help you, allowing you to attempt an additional flat check before the end of your turn. This is usually an activity requiring 2 actions, and it must be something that would reasonably improve your chances (as determined by the GM). For example, you might try to smother a flame or wash off acid. This allows you to attempt an extra flat check immediately, but only once per round.

The GM decides how your help works, using the following examples as guidelines when there's not a specific action that applies.
The action to help might require a skill check or another roll to determine its effectiveness.
Reduce the DC of the flat check to 10 for a particularly appropriate type of help, such as dousing you in water to put out flames.
Automatically end the condition due to the type of help, such as healing that restores you to your maximum HP to end persistent bleed damage, or submerging yourself in a lake to end persistent fire damage.
Alter the number of actions required to help you if the means the helper uses are especially efficient or remarkably inefficient.

Immunities, Resistances, And Weaknesses
Immunities, resistances, and weaknesses all apply to persistent damage. If an effect deals initial damage in addition to persistent damage, apply immunities, resistances, and weaknesses separately to the initial damage and to the persistent damage. Usually, if an effect negates the initial damage, it also negates the persistent damage, such as with a slashing weapon that also deals persistent bleed damage because it cut you. The GM might rule otherwise in some situations.
Multiple Persistent Damage Conditions
You can be simultaneously affected by multiple persistent damage conditions so long as they have different damage types. If you would gain more than one persistent damage condition with the same damage type, the higher amount of damage overrides the lower amount. If it's unclear which damage would be higher, such as if you're already taking 2 persistent fire damage and then begin taking 1d4 persistent fire damage, the GM decides which source of damage would better fit the scene. The damage you take from persistent damage occurs all at once, so if something triggers when you take damage, it triggers only once; for example, if you're dying with several types of persistent damage, the persistent damage increases your dying condition only once.`,
  petrified: `You have been turned to stone. You can't act, nor can you sense anything. You become an object with a Bulk double your normal Bulk (typically 12 for a petrified Medium creature or 6 for a petrified Small creature), AC 9, Hardness 8, and the same current Hit Points you had when alive. You don't have a Broken Threshold. When the petrified condition ends, you have the same number of Hit Points you had as a statue. If the statue is destroyed, you immediately die. While petrified, your mind and body are in stasis, so you don't age or notice the passing of time.`,
  prone: `You're lying on the ground. You are off-guard and take a -2 circumstance penalty to attack rolls. The only move actions you can use while you're prone are Crawl and Stand. Standing up ends the prone condition. You can Take Cover while prone to hunker down and gain greater cover against ranged attacks, even if you don't have an object to get behind, which grants you a +4 circumstance bonus to AC against ranged attacks (but you remain off-guard).

If you would be knocked prone while you're Climbing or Flying, you fall. You can't be knocked prone when Swimming.`,
  quickened: `You're able to act more quickly. You gain 1 additional action at the start of your turn each round. Many effects that make you quickened require you use this extra action only in certain ways. If you become quickened from multiple sources, you can use the extra action you've been granted for any single action allowed by any of the effects that made you quickened. Because quickened has its effect at the start of your turn, you don't immediately gain actions if you become quickened during your turn.`,
  restrained: `You're tied up and can barely move, or a creature has you pinned. You have the off-guard and immobilized conditions, and you can't use any attack or manipulate actions except to attempt to Escape or Force Open your bonds. Restrained overrides grabbed.`,
  sickened: `You feel ill. Sickened always includes a value. You take a status penalty equal to this value on all your checks and DCs. You can't willingly ingest anything—including elixirs and potions—while sickened.

You can spend a single action retching in an attempt to recover, which lets you immediately attempt a Fortitude save against the DC of the effect that made you sickened. On a success, you reduce your sickened value by 1 (or by 2 on a critical success).`,
  slowed: `You have fewer actions. Slowed always includes a value. When you regain your actions, reduce the number of actions regained by your slowed value. Because you regain actions at the start of your turn, you don't immediately lose actions if you become slowed during your turn.`,
  stunned: `You've become senseless. You can't act. Stunned usually includes a value, which indicates how many total actions you lose, possibly over multiple turns, from being stunned. Each time you regain actions, reduce the number you regain by your stunned value, then reduce your stunned value by the number of actions you lost. For example, if you were stunned 4, you would lose all 3 of your actions on your turn, reducing you to stunned 1; on your next turn, you would lose 1 more action, and then be able to use your remaining 2 actions normally. Stunned might also have a duration instead, such as "stunned for 1 minute," causing you to lose all your actions for the duration.

Stunned overrides slowed. If the duration of your stunned condition ends while you are slowed, you count the actions lost to the stunned condition toward those lost to being slowed. So, if you were stunned 1 and slowed 2 at the beginning of your turn, you would lose 1 action from stunned, and then lose only 1 additional action by being slowed, so you would still have 1 action remaining to use that turn.`,
  stupefied: `Your thoughts and instincts are clouded. Stupefied always includes a value. You take a status penalty equal to this value on Intelligence-, Wisdom-, and Charisma-based rolls and DCs, including Will saving throws, spell attack modifiers, spell DCs, and skill checks that use these attribute modifiers. Any time you attempt to Cast a Spell while stupefied, the spell is disrupted unless you succeed at a flat check with a DC equal to 5 + your stupefied value.`,
  unconscious: `You're sleeping or have been knocked out. You can't act. You take a -4 status penalty to AC, Perception, and Reflex saves, and you have the blinded and off-guard conditions. When you gain this condition, you fall prone and drop items you're holding unless the effect states otherwise or the GM determines you're positioned so you wouldn't.

If you're unconscious because you're dying, you can't wake up while you have 0 Hit Points. If you are restored to 1 Hit Point or more, you lose the dying and unconscious conditions and can act normally on your next turn.

If you are unconscious and at 0 Hit Points, but not dying, you return to 1 Hit Point and awaken after sufficient time passes. The GM determines how long you remain unconscious, from a minimum of 10 minutes to several hours. If you are healed, you lose the unconscious condition and can act normally on your next turn.

If you're unconscious and have more than 1 Hit Point (typically because you are asleep or unconscious due to an effect), you wake up in one of the following ways.
You take damage, though if the damage reduces you to 0 Hit Points, you remain unconscious and gain the dying condition as normal.
You receive healing, other than the natural healing you get from resting.
Someone shakes you awake with an Interact action.
Loud noise around you might wake you. At the start of your turn, you automatically attempt a Perception check against the noise's DC (or the lowest DC if there is more than one noise), waking up if you succeed. If creatures are attempting to stay quiet around you, this Perception check uses their Stealth DCs. Some effects make you sleep so deeply that they don't allow you this Perception check.
If you are simply asleep, the GM decides you wake up either because you have had a restful night's sleep or something disrupted that rest.`,
  undetected: `When you are undetected by a creature, that creature can't see you at all, has no idea what space you occupy, and can't target you, though you still can be affected by abilities that target an area. When you're undetected by a creature, that creature is off-guard to you.

A creature you're undetected by can guess which square you're in to try targeting you. It must pick a square and attempt an attack. This works like targeting a hidden creature (requiring a DC 11 flat check, as described under Detecting Creatures), but the flat check and attack roll are rolled in secret by the GM, who doesn't reveal whether the attack missed due to failing the flat check, failing the attack roll, or choosing the wrong square. They can Seek to try to find you.`,
  unfriendly: `This condition reflects a creature's disposition toward a particular character, and only supernatural effects (like a spell) can impose this condition on a PC. A creature that is unfriendly to a character dislikes and distrusts that character. The unfriendly creature won't accept Requests from the character.`,
  unnoticed: `If you're unnoticed by a creature, that creature has no idea you're present. When you're unnoticed, you're also undetected. This matters for abilities that can be used only against targets totally unaware of your presence.`,
  wounded: `You have been seriously injured. If you lose the dying condition and do not already have the wounded condition, you become wounded 1. If you already have the wounded condition when you lose the dying condition, your wounded condition value increases by 1. If you gain the dying condition while wounded, increase your dying condition value by your wounded value.

The wounded condition ends if someone successfully restores Hit Points to you using Treat Wounds, or if you are restored to full Hit Points by any means and rest for 10 minutes.`,
};
const MODIFIER_PRESETS = [
  { key: "blinded", label: "Blinded", source: "Player Core pg. 442", rulesText: "You can't see. Key numeric impact in this sheet: typically -4 status to Perception checks relying on vision.", effectsTemplate: [{ targets: ["perception", "initiative"], target: "perception", type: "status", effect: "-4", enabled: true }] },
  { key: "broken", label: "Broken", source: "Player Core pg. 442", rulesText: "Object-only condition. Broken armor applies AC status penalty based on armor category; other object handling is informational in this sheet." },
  { key: "clumsy", label: "Clumsy", source: "Player Core pg. 442", rulesText: "Status penalty equal to value on Dex-based rolls/DCs, including AC, Reflex, ranged attack rolls, and Acrobatics/Stealth/Thievery.", levelConfig: { min: 1, max: 4, default: 1, perLevel: -1 }, effectsTemplate: [{ targets: ["ac", "reflex", "initiative", "attack", "skill:acrobatics", "skill:stealth", "skill:thievery"], target: "ac", type: "status", enabled: true }] },
  { key: "concealed", label: "Concealed", source: "Player Core pg. 442", rulesText: "Primarily DC 5 flat check to target; no direct numeric stat modifier auto-applied." },
  { key: "confused", label: "Confused", source: "Player Core pg. 442", rulesText: "You are off-guard and action economy is constrained/randomized.", effectsTemplate: [{ targets: ["ac"], target: "ac", type: "circumstance", effect: "-2", enabled: true }] },
  { key: "controlled", label: "Controlled", source: "Player Core pg. 442", rulesText: "Action control condition; no direct numeric modifier auto-applied." },
  { key: "dazzled", label: "Dazzled", source: "Player Core pg. 442", rulesText: "Typically makes targets concealed from you; no direct numeric modifier auto-applied." },
  { key: "deafened", label: "Deafened", source: "Player Core pg. 443", rulesText: "You can't hear. Numeric portion mapped as -2 status to Perception and initiative checks relying on hearing.", effectsTemplate: [{ targets: ["perception", "initiative"], target: "perception", type: "status", effect: "-2", enabled: true }] },
  { key: "doomed", label: "Doomed", source: "Player Core pg. 443", rulesText: "Affects dying threshold/death. No direct numeric modifier in this sheet.", levelConfig: { min: 1, max: 4, default: 1, perLevel: 0 }, effectsTemplate: [] },
  { key: "drained", label: "Drained", source: "Player Core pg. 443", rulesText: "Status penalty equal to value on Constitution-based rolls/DCs (Fortitude). HP max/current impact is informational here.", levelConfig: { min: 1, max: 4, default: 1, perLevel: -1 }, effectsTemplate: [{ targets: ["fortitude"], target: "fortitude", type: "status", enabled: true }] },
  { key: "dying", label: "Dying", source: "Player Core pg. 443", rulesText: "Recovery/threshold condition. No direct numeric modifier auto-applied.", levelConfig: { min: 1, max: 4, default: 1, perLevel: 0 }, effectsTemplate: [] },
  { key: "encumbered", label: "Encumbered", source: "Player Core pg. 443", rulesText: "You are clumsy 1 and take a 10-foot speed penalty.", effectsTemplate: [{ targets: ["ac", "reflex", "initiative", "attack", "skill:acrobatics", "skill:stealth", "skill:thievery"], target: "ac", type: "status", effect: "-1", enabled: true }, { targets: ["speed"], target: "speed", type: "status", effect: "-10", enabled: true }] },
  { key: "enfeebled", label: "Enfeebled", source: "Player Core pg. 443", rulesText: "Status penalty equal to value on Strength-based rolls/DCs, including melee attack, Strength damage, and Athletics.", levelConfig: { min: 1, max: 4, default: 1, perLevel: -1 }, effectsTemplate: [{ targets: ["attack", "damage", "skill:athletics"], target: "attack", type: "status", enabled: true }] },
  { key: "fascinated", label: "Fascinated", source: "Player Core pg. 443", rulesText: "You take a -2 status penalty to Perception and skill checks; concentrate restrictions are informational.", effectsTemplate: [{ targets: ["perception", "initiative", "skill"], target: "perception", type: "status", effect: "-2", enabled: true }] },
  { key: "fatigued", label: "Fatigued", source: "Player Core pg. 444", rulesText: "You take a -1 status penalty to AC and saving throws.", effectsTemplate: [{ targets: ["ac", "fortitude", "reflex", "will"], target: "ac", type: "status", effect: "-1", enabled: true }] },
  { key: "fleeing", label: "Fleeing", source: "Player Core pg. 444", rulesText: "Action behavior condition; no direct numeric modifier auto-applied." },
  { key: "friendly", label: "Friendly", source: "Player Core pg. 444", rulesText: "Attitude/disposition condition; no direct numeric modifier auto-applied." },
  { key: "frightened", label: "Frightened", source: "Player Core pg. 444", rulesText: "Status penalty equal to frightened value to all checks and DCs; usually decreases by 1 each turn.", levelConfig: { min: 1, max: 4, default: 1, perLevel: -1 }, effectsTemplate: [{ targets: ["all"], target: "all", type: "status", enabled: true }] },
  { key: "grabbed", label: "Grabbed", source: "Player Core pg. 444", rulesText: "You are off-guard and immobilized. AC penalty is mapped; movement lock is informational.", effectsTemplate: [{ targets: ["ac"], target: "ac", type: "circumstance", effect: "-2", enabled: true }] },
  { key: "helpful", label: "Helpful", source: "Player Core pg. 444", rulesText: "Attitude/disposition condition; no direct numeric modifier auto-applied." },
  { key: "hidden", label: "Hidden", source: "Player Core pg. 444", rulesText: "Detection state; no direct numeric modifier auto-applied." },
  { key: "hostile", label: "Hostile", source: "Player Core pg. 444", rulesText: "Attitude/disposition condition; no direct numeric modifier auto-applied." },
  { key: "immobilized", label: "Immobilized", source: "Player Core pg. 444", rulesText: "Can't use move actions; no direct numeric modifier auto-applied." },
  { key: "indifferent", label: "Indifferent", source: "Player Core pg. 444", rulesText: "Attitude/disposition condition; no direct numeric modifier auto-applied." },
  { key: "invisible", label: "Invisible", source: "Player Core pg. 444", rulesText: "Detection/targeting state; no direct numeric modifier auto-applied." },
  { key: "observed", label: "Observed", source: "Player Core pg. 444", rulesText: "Detection state; no direct numeric modifier auto-applied." },
  { key: "off-guard", label: "Off-Guard", source: "Player Core pg. 445", rulesText: "You take a -2 circumstance penalty to AC.", effectsTemplate: [{ targets: ["ac"], target: "ac", type: "circumstance", effect: "-2", enabled: true }] },
  { key: "paralyzed", label: "Paralyzed", source: "Player Core pg. 445", rulesText: "You are off-guard and can't act (except limited mental actions). AC penalty mapped; action lock informational.", effectsTemplate: [{ targets: ["ac"], target: "ac", type: "circumstance", effect: "-2", enabled: true }] },
  { key: "persistent-damage", label: "Persistent Damage", source: "Player Core pg. 445", rulesText: "Ongoing damage process condition with flat-check recovery; no direct static numeric modifier auto-applied." },
  { key: "petrified", label: "Petrified", source: "Player Core pg. 445", rulesText: "Transformed into object with fixed defenses; no direct numeric modifier auto-applied in this sheet." },
  { key: "prone", label: "Prone", source: "Player Core pg. 445", rulesText: "You are off-guard and take a -2 circumstance penalty to attack rolls.", effectsTemplate: [{ targets: ["ac"], target: "ac", type: "circumstance", effect: "-2", enabled: true }, { targets: ["attack"], target: "attack", type: "circumstance", effect: "-2", enabled: true }] },
  { key: "quickened", label: "Quickened", source: "Player Core pg. 446", rulesText: "Action-economy condition (+1 action with restrictions). No direct numeric modifier auto-applied." },
  { key: "restrained", label: "Restrained", source: "Player Core pg. 446", rulesText: "You are off-guard, immobilized, and action-limited. AC penalty mapped; movement/action restrictions informational.", effectsTemplate: [{ targets: ["ac"], target: "ac", type: "circumstance", effect: "-2", enabled: true }] },
  { key: "sickened", label: "Sickened", source: "Player Core pg. 446", rulesText: "Status penalty equal to sickened value on all checks and DCs.", levelConfig: { min: 1, max: 4, default: 1, perLevel: -1 }, effectsTemplate: [{ targets: ["all"], target: "all", type: "status", enabled: true }] },
  { key: "slowed", label: "Slowed", source: "Player Core pg. 446", rulesText: "Action-economy condition (fewer actions). No direct numeric modifier auto-applied.", levelConfig: { min: 1, max: 4, default: 1, perLevel: 0 }, effectsTemplate: [] },
  { key: "stunned", label: "Stunned", source: "Player Core pg. 446", rulesText: "Action-economy condition (can't act / lose actions). No direct numeric modifier auto-applied.", levelConfig: { min: 1, max: 4, default: 1, perLevel: 0 }, effectsTemplate: [] },
  { key: "stupefied", label: "Stupefied", source: "Player Core pg. 446", rulesText: "Status penalty equal to value on Int/Wis/Cha rolls/DCs, including Will and many mental skills.", levelConfig: { min: 1, max: 4, default: 1, perLevel: -1 }, effectsTemplate: [{ targets: ["will", "perception", "initiative", "skill:arcana", "skill:crafting", "skill:medicine", "skill:nature", "skill:occultism", "skill:performance", "skill:religion", "skill:society", "skill:survival", "skill:deception", "skill:diplomacy", "skill:intimidation"], target: "will", type: "status", enabled: true }] },
  { key: "unconscious", label: "Unconscious", source: "Player Core pg. 446", rulesText: "You can't act; -4 status to AC, Perception, and Reflex; also blinded/off-guard.", effectsTemplate: [{ targets: ["ac", "perception", "reflex"], target: "ac", type: "status", effect: "-4", enabled: true }] },
  { key: "undetected", label: "Undetected", source: "Player Core pg. 447", rulesText: "Detection state; no direct numeric modifier auto-applied." },
  { key: "unfriendly", label: "Unfriendly", source: "Player Core pg. 447", rulesText: "Attitude/disposition condition; no direct numeric modifier auto-applied." },
  { key: "unnoticed", label: "Unnoticed", source: "Player Core pg. 447", rulesText: "Detection state; no direct numeric modifier auto-applied." },
  { key: "wounded", label: "Wounded", source: "Player Core pg. 447", rulesText: "Interacts with dying value and recovery; no direct numeric modifier auto-applied.", levelConfig: { min: 1, max: 4, default: 1, perLevel: 0 }, effectsTemplate: [] },
];
for (const preset of MODIFIER_PRESETS) {
  if (CONDITION_RULES_TEXT[preset.key]) {
    preset.rulesText = CONDITION_RULES_TEXT[preset.key];
  }
}

function applyPresetLevelToRow(row, level) {
  const cfg = row?.levelConfig;
  if (!cfg) return;
  const min = Number(cfg.min || 1);
  const max = Number(cfg.max || min);
  const safeLevel = Math.max(min, Math.min(max, Number(level || min)));
  const perLevel = Number(cfg.perLevel || 0);
  const effectVal = perLevel * safeLevel;
  row.level = safeLevel;
  row.label = `${String(cfg.baseLabel || row.label || "Condition")} ${safeLevel}`;
  row.effectsBatches = (row.effectsBatches || []).map((b) => ({
    ...b,
    effect: String(effectVal),
  }));
  row.effect = (row.effectsBatches || []).map((b) => b.effect).join(" + ");
  row.value = (row.effectsBatches || []).reduce((sum, b) => {
    const n = Number(b.effect);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
}
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
  let depth = 0;
  let splitAt = -1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "[") depth += 1;
    else if (ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === ":" && depth === 0) {
      splitAt = i;
      break;
    }
  }
  if (splitAt > 0) {
    const left = text.slice(0, splitAt).trim();
    const right = text.slice(splitAt + 1).trim();
    if (left && right) return { label: left, formula: right };
  }
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
            .map((id) => {
              const type = baseBlockType(id);
              if (id === "main-strip") return ["base-strip", "skills-strip"];
              if (type === "modifier-widget") return ["modifier-widget"];
              return [id];
            })
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
                      (isBlockType(id, "weapon-widget") || isBlockType(id, "main-widgets"))
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
          if (draft.ui.modifierWidgetGroupId === blockId) {
            draft.ui.modifierWidgetGroupId = "modifier-widget";
            draft.ui.modifierWidgetEditingId = null;
            draft.ui.modifierWidgetEditorOpen = false;
            draft.ui.modifierPresetGroupId = "modifier-widget";
            draft.ui.modifierPresetBrowserOpen = false;
          }
          if (draft.ui.conditionInfoGroupId === blockId) {
            draft.ui.conditionInfoGroupId = "modifier-widget";
            draft.ui.conditionInfoOpen = false;
            draft.ui.conditionInfoKey = "";
          }
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
  root.rollLogToggle.textContent = isOpen ? "Hide Log" : "Log";
  const quickOpen = Boolean(state.ui.quickRollOpen);
  root.quickRollPopup?.classList.toggle("open", quickOpen);
  root.quickRollPopup?.setAttribute("aria-hidden", String(!quickOpen));
  if (root.quickRollToggle) root.quickRollToggle.textContent = quickOpen ? "Hide Roll" : "Roll";
}

function renderCharacterManager(state) {
  if (!root.charactersPopup || !root.charactersList) return;
  const entries = listCharacterSaves()
    .sort((a, b) => b.lastSavedAt - a.lastSavedAt)
    .map(
      (row) => `<div class="log-entry ${row.isActive ? "latest-roll" : ""}">
        <div><strong>${escapeHtml(row.characterName)}</strong> <span class="muted">(Level ${Number(row.level || 1)})</span></div>
        <div class="row">
          <button type="button" class="mini-btn" data-load-char-id="${row.id}">Load</button>
          <button type="button" class="mini-btn" data-rename-char-id="${row.id}">Rename</button>
          <button type="button" class="mini-btn danger-btn" data-delete-char-id="${row.id}">Delete</button>
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
      addRollLog(`Loaded character: ${loaded.base?.characterName || loaded.saveMeta?.saveName || "Character"}`, false);
    });
  });
  root.charactersList.querySelectorAll("[data-rename-char-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.renameCharId;
      const currentState = loadCharacterById(id);
      if (!currentState) return;
      const currentName = String(currentState.base?.characterName || currentState.saveMeta?.saveName || "Character");
      const nextName = window.prompt("Enter a new character name:", currentName);
      if (nextName == null) return;
      const trimmed = String(nextName).trim();
      if (!trimmed) return;
      const didRename = renameCharacterById(id, trimmed);
      if (!didRename) return;
      const activeId = store.getState().saveMeta?.saveId;
      if (activeId === id) {
        store.patch((draft) => {
          draft.base = draft.base || {};
          draft.base.characterName = trimmed;
          draft.saveMeta = draft.saveMeta || {};
          draft.saveMeta.saveName = trimmed;
        });
      } else {
        store.patch((draft) => {
          draft.ui.characterManagerOpen = true;
        });
      }
      addRollLog(`Renamed character: ${trimmed}`, false);
    });
  });
  root.charactersList.querySelectorAll("[data-delete-char-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.deleteCharId;
      if (!id) return;
      const toDelete = loadCharacterById(id);
      const label = String(toDelete?.saveMeta?.saveName || toDelete?.base?.characterName || "Character");
      if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) return;
      const result = deleteCharacterById(id);
      if (!result.deleted) return;
      const activeId = store.getState().saveMeta?.saveId;
      if (activeId === id) {
        const nextState = result.nextActiveId ? loadCharacterById(result.nextActiveId) : null;
        store.patch((draft) => {
          if (nextState) {
            Object.assign(draft, nextState);
          } else {
            Object.assign(draft, createInitialState());
          }
          draft.ui.characterManagerOpen = false;
        });
      } else {
        store.patch((draft) => {
          draft.ui.characterManagerOpen = true;
        });
      }
      addRollLog(`Deleted character: ${label}`, false);
    });
  });
}

function renderOverview(state) {
  renderOverviewWorkspace(state);
  const modifierRowsFlat = flattenModifierRows(state.base);
  const modTone = (total) => (total > 0 ? "mod-positive" : total < 0 ? "mod-negative" : "mod-neutral");
  const acModTotal = summarizeModifiers(modifierRowsFlat, "ac").total;
  const fortModTotal = summarizeModifiers(modifierRowsFlat, "fortitude").total;
  const reflexModTotal = summarizeModifiers(modifierRowsFlat, "reflex").total;
  const willModTotal = summarizeModifiers(modifierRowsFlat, "will").total;
  const perceptionModTotal = summarizeModifiers(modifierRowsFlat, "perception").total;
  const classDcModTotal = summarizeModifiers(modifierRowsFlat, "classDc").total;
  const skillAllModTotal = summarizeModifiers(modifierRowsFlat, "skill").total;
  const initiativeModTotal = summarizeModifiers(modifierRowsFlat, "initiative").total;
  const speedModTotal = summarizeModifiers(modifierRowsFlat, "speed").total;
  const perceptionBonus = state.derived.defense.perception - 10;
  const fortBonus = state.derived.defense.fortitude - 10;
  const reflexBonus = state.derived.defense.reflex - 10;
  const willBonus = state.derived.defense.will - 10;
  const acBonus = state.derived.defense.ac - 10;
  const classDcBonus = state.derived.classDc - 10;
  const armor = coerceArmorState(state.base.armor);
  const variableTokens = listAvailableVariableTokens(state);
  const armorVarAssist = renderVariableAssist("armor-variable-options", variableTokens, 'input[data-armor-field="modifiers"]');
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

  root.mainCombatStrip.innerHTML = `
    <div class="row strip-row">
      <span class="base-top-layout">
        <span class="ac-square-wrap">
          <button type="button" class="defense-pill defense-pill-ac defense-pill-ac-big roll-pill ${modTone(acModTotal)} ${state.base.toggles?.raiseShield ? "shield-active" : ""}" data-roll-name="AC" data-roll-bonus="${acBonus}">AC ${state.derived.defense.ac}</button>
        </span>
        <span class="health-grid">
          <label class="strip-label health-cell-label"><span>HP:</span><input id="strip-hp-current" type="number" value="${state.base.hp.current}" /></label>
          <label class="strip-label health-cell-label"><span>Temp HP:</span><input id="strip-hp-temp" type="number" value="${state.base.hp.temp}" /></label>
          <span class="health-cell-inline">
            <button type="button" class="mini-btn" id="strip-damage-apply-btn">Damage</button>
            <label class="strip-label"><input id="strip-damage-input" type="number" value="" /></label>
          </span>
          <span class="health-cell-inline">
            <button type="button" class="mini-btn" id="strip-healing-apply-btn">Heal</button>
            <label class="strip-label"><input id="strip-healing-input" type="number" value="" /></label>
          </span>
        </span>
      </span>
    </div>
    <div class="row strip-row">
      <span class="defense-group">
        <label class="strip-label">
          <input id="strip-raise-shield" type="checkbox" ${state.base.toggles?.raiseShield ? "checked" : ""} />
          Shield/ Parry
        </label>
        <button type="button" class="mini-btn" id="strip-raise-shield-settings-btn" aria-label="Shield settings">⚙</button>
        <button type="button" class="mini-btn" data-armor-settings-open="true" aria-label="Armor settings">⚙</button>
        <div class="strip-inline-settings ${state.ui.shieldSettingsOpen ? "" : "hidden"}" id="strip-raise-shield-settings">
          <label>Circumstance bonus
            <input id="strip-raise-shield-bonus" type="number" min="0" step="1" value="${Number(state.base.toggles?.raiseShieldBonus || 1)}" />
          </label>
        </div>
      </span>
    </div>
    <hr class="base-separator" />
    <div class="row strip-row">
      <span class="defense-group">
        <button type="button" class="defense-pill roll-pill ${modTone(fortModTotal)}" data-roll-name="Fortitude" data-roll-bonus="${fortBonus}">+${fortBonus} Fortitude</button>
        <button type="button" class="defense-pill roll-pill ${modTone(reflexModTotal)}" data-roll-name="Reflex" data-roll-bonus="${reflexBonus}">+${reflexBonus} Reflex</button>
        <button type="button" class="defense-pill roll-pill ${modTone(willModTotal)}" data-roll-name="Will" data-roll-bonus="${willBonus}">+${willBonus} Will</button>
        <button type="button" class="defense-pill roll-pill ${modTone(classDcModTotal)}" data-roll-name="Class DC" data-roll-bonus="${classDcBonus}">Class DC ${state.derived.classDc}</button>
      </span>
    </div>
    <div class="weapon-editor-popup ${state.ui.armorSettingsOpen ? "" : "hidden"}" id="armor-settings-popup">
      <div class="weapon-editor-card armor-editor-card">
        <p class="section-header">Armor</p>
        <div class="weapon-editor-grid">
          <label>Name <input data-armor-field="name" value="${escapeHtml(armor.name)}" /></label>
          <label>Proficiency
            <select data-armor-field="armorType">
              <option value="unarmored" ${String(state.base.armorType || "unarmored") === "unarmored" ? "selected" : ""}>Unarmored</option>
              <option value="light" ${state.base.armorType === "light" ? "selected" : ""}>Light Armor</option>
              <option value="medium" ${state.base.armorType === "medium" ? "selected" : ""}>Medium Armor</option>
              <option value="heavy" ${state.base.armorType === "heavy" ? "selected" : ""}>Heavy Armor</option>
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
        <p class="section-header">Always-on Armor Bonuses</p>
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
        <div class="row">
          <button type="button" id="armor-settings-close-btn">Done</button>
        </div>
      </div>
    </div>
  `;
  if (root.mainInitiativeStrip) {
    root.mainInitiativeStrip.innerHTML = `
      <div class="row strip-row">
        <span class="strip-group strip-pill-group">
          <button type="button" class="defense-pill roll-pill ${modTone(initiativeModTotal)}" data-roll-name="Initiative" data-roll-bonus="${state.derived.initiative}">+${state.derived.initiative} Initiative</button>
          <button type="button" class="defense-pill roll-pill ${modTone(perceptionModTotal)}" data-roll-name="Perception" data-roll-bonus="${perceptionBonus}">+${perceptionBonus} Perception</button>
          <span class="defense-pill ${modTone(speedModTotal)}">Speed ${Number(state.derived.speed || state.base.baseSpeed || 0)} ft</span>
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
      const skillModTotal = skillAllModTotal + summarizeModifiers(modifierRowsFlat, `skill:${name}`).total;
      return `<button type="button" class="defense-pill roll-pill skill-roll-pill ${modTone(skillModTotal)}" data-roll-name="${label}" data-roll-bonus="${bonus}">+${bonus} ${label} (${ability})</button>`;
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
      return `<button type="button" class="defense-pill roll-pill skill-roll-pill custom-skill-roll-pill ${modTone(skillAllModTotal)}" data-roll-name="${escapeHtml(
        label
      )}" data-roll-bonus="${bonus}">${bonus >= 0 ? "+" : ""}${bonus} ${escapeHtml(label)} (${ability})</button>`;
    })
    .join(" ");
  if (customSkillRows) {
    root.mainSkillsStrip.innerHTML += ` ${customSkillRows}`;
  }
  const modifierTargets = [
    { value: "all", label: "All" },
    { value: "attack", label: "Attack rolls" },
    { value: "atk", label: "atk (alias)" },
    { value: "damage", label: "Damage" },
    { value: "dmg", label: "dmg (alias)" },
    { value: "ac", label: "AC" },
    { value: "classDc", label: "Class DC" },
    { value: "initiative", label: "Initiative" },
    { value: "speed", label: "Speed" },
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
    const group = state.base.modifierGroups?.[blockId] || { title: "Modifier Widget", rows: [], library: [] };
    const tableRows = Array.isArray(group.rows) ? group.rows : [];
    const libraryRows = Array.isArray(group.library) ? group.library : [];
    const hiddenActiveCount = tableRows.filter((m) => m.showInOverview === false && m.enabled !== false).length;
    const editingId = state.ui.modifierWidgetGroupId === blockId ? state.ui.modifierWidgetEditingId : null;
    const editing = tableRows.find((m) => m.id === editingId) || null;
    const visibleRows = tableRows.filter((m) => m.showInOverview !== false);
    const rows = visibleRows
      .map((m) => {
        return `<div class="modifier-row-card">
          <div class="modifier-row-main">
            <label class="modifier-onoff">
              <input type="checkbox" data-mod-enabled-toggle="${m.id}" ${m.enabled === false ? "" : "checked"} />
            </label>
            <strong>${escapeHtml(m.label || "Modifier")}</strong>
            ${
              m.levelConfig
                ? `<span class="muted">L${Number(m.level || m.levelConfig?.min || 1)}</span>`
                : ""
            }
          </div>
          <div class="modifier-row-actions">
            <button type="button" class="mini-btn" data-mod-hide-toggle="${m.id}">
              ${m.showInOverview === false ? "Show" : "Hide"}
            </button>
            ${
              m.levelConfig
                ? `<button type="button" class="mini-btn" data-mod-level-down="${m.id}" aria-label="Decrease level">−</button>
                   <button type="button" class="mini-btn" data-mod-level-up="${m.id}" aria-label="Increase level">+</button>`
                : ""
            }
            <button type="button" class="mini-btn" data-mod-up="${m.id}" aria-label="Move modifier up">↑</button>
            <button type="button" class="mini-btn" data-mod-down="${m.id}" aria-label="Move modifier down">↓</button>
            ${
              m.presetKey
                ? `<button type="button" class="mini-btn" data-mod-row-info-key="${escapeHtml(m.presetKey)}">(i)</button>`
                : ""
            }
          </div>
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
        (fx, i) => `<div class="row modifier-effect-row" data-mod-effect-row="${i}">
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
          <div class="modifier-effect-actions">
            <button type="button" class="mini-btn" data-mod-move-up-idx="${i}" aria-label="Move effect up">↑</button>
            <button type="button" class="mini-btn" data-mod-move-down-idx="${i}" aria-label="Move effect down">↓</button>
            <button type="button" class="mini-btn" data-mod-del-effect-idx="${i}">Remove</button>
          </div>
        </div>`
      )
      .join("");
    const presetRows = MODIFIER_PRESETS.map((preset) => {
      const existing = tableRows.find((m) => m.presetKey === preset.key);
      const inGroup = Boolean(existing);
      const searchText = `${preset.label || ""} ${preset.source || ""} ${preset.rulesText || ""}`.toLowerCase();
      return `<div class="modifier-preset-row" data-mod-preset-search-text="${escapeHtml(searchText)}">
        <div class="modifier-preset-main">
          <strong>${escapeHtml(preset.label)}</strong>
          <span class="muted">${escapeHtml(preset.source || "")}</span>
        </div>
        <div class="modifier-preset-actions">
          <button type="button" class="mini-btn" data-mod-preset-toggle="${escapeHtml(preset.key)}">
            ${inGroup ? "Disable" : "Enable"}
          </button>
          ${
            inGroup
              ? `<button type="button" class="mini-btn" data-mod-visibility-toggle="${escapeHtml(existing.id)}">${
                  existing.showInOverview === false ? "Show" : "Hide"
                }</button>`
              : ""
          }
          ${inGroup ? `<button type="button" class="mini-btn" data-mod-open-settings="${escapeHtml(existing.id)}">⚙</button>` : ""}
          <button type="button" class="mini-btn" data-mod-info-key="${escapeHtml(preset.key)}">(i)</button>
        </div>
      </div>`;
    }).join("");
    const activeConditionInfo =
      state.ui.conditionInfoOpen && state.ui.conditionInfoGroupId === blockId
        ? MODIFIER_PRESETS.find((p) => p.key === state.ui.conditionInfoKey)
        : null;
    const customActivationRows = libraryRows
      .map((entry) => {
        const existing = tableRows.find((m) => m.customDefId === entry.id);
        const inGroup = Boolean(existing);
        return `<div class="modifier-preset-row">
          <div class="modifier-preset-main">
            <strong>${escapeHtml(entry.label || "Custom Modifier")}</strong>
            <span class="muted">${escapeHtml(entry.effect || "0")}</span>
          </div>
          <div class="modifier-preset-actions">
            <button type="button" class="mini-btn" data-mod-custom-toggle="${escapeHtml(entry.id)}">
              ${inGroup ? "Disable" : "Enable"}
            </button>
            ${
              inGroup
                ? `<button type="button" class="mini-btn" data-mod-visibility-toggle="${escapeHtml(existing.id)}">${
                    existing.showInOverview === false ? "Show" : "Hide"
                  }</button>`
                : ""
            }
            ${inGroup ? `<button type="button" class="mini-btn" data-mod-open-settings="${escapeHtml(existing.id)}">⚙</button>` : ""}
            <button type="button" class="mini-btn danger-btn" data-mod-custom-delete="${escapeHtml(entry.id)}">Delete</button>
          </div>
        </div>`;
      })
      .join("");
    container.innerHTML = `
      <div class="custom-widgets-header-row widget-head-row">
        <p class="section-header">${escapeHtml(group.title || "Modifier Widget")}</p>
        <div class="widget-head-actions">
          <button type="button" class="mini-btn" data-mod-view-btn="${escapeHtml(blockId)}" title="Modifier list">+</button>
          <button type="button" class="mini-btn" data-mod-show-hidden-btn="${escapeHtml(blockId)}" ${hiddenActiveCount ? "" : "disabled"} title="Show hidden active modifiers">Show Hidden${
            hiddenActiveCount ? ` (${hiddenActiveCount})` : ""
          }</button>
          <button type="button" class="mini-btn" data-mod-add-btn="${escapeHtml(blockId)}" title="Create modifier">New</button>
        </div>
      </div>
      <div class="modifier-list-wrap">${rows || `<p class="muted">No modifiers yet.</p>`}</div>
      <div class="weapon-editor-popup ${state.ui.modifierPresetBrowserOpen && state.ui.modifierPresetGroupId === blockId ? "" : "hidden"}" id="mod-preset-browser">
        <div class="weapon-editor-card">
          <p class="section-header">Activate Modifiers</p>
          <p class="muted">Enable defaults and created modifiers for this widget.</p>
          <div class="row">
            <label>Search conditions
              <input id="mod-preset-search" placeholder="e.g. frightened, off-guard, ac..." />
            </label>
          </div>
          <div class="modifier-preset-list">${presetRows}</div>
          ${customActivationRows ? `<p class="section-header">Created Modifiers</p><div class="modifier-preset-list">${customActivationRows}</div>` : `<p class="muted">No created modifiers yet.</p>`}
          <div class="row"><button type="button" id="mod-preset-close-btn">Close</button></div>
        </div>
      </div>
      <div class="weapon-editor-popup ${activeConditionInfo ? "" : "hidden"}" id="mod-condition-info-popup">
        <div class="weapon-editor-card">
          <p class="section-header">${escapeHtml(activeConditionInfo?.label || "Condition")}</p>
          <p class="muted">${escapeHtml(activeConditionInfo?.source || "")}</p>
          <div class="condition-info-body">${escapeHtml(activeConditionInfo?.rulesText || "").replace(/\n/g, "<br />")}</div>
          <div class="row"><button type="button" id="mod-condition-info-close-btn">Close</button></div>
        </div>
      </div>
      <div class="weapon-editor-popup ${state.ui.modifierWidgetEditorOpen && state.ui.modifierWidgetGroupId === blockId ? "" : "hidden"}">
        <div class="weapon-editor-card">
          <p class="section-header">${editing ? "Edit Modifier" : "Create Modifier"}</p>
          <div class="row"><label>Widget name <input id="mod-widget-name" value="${escapeHtml(group.title || "Modifier Widget")}" /></label></div>
          <div class="row"><label>Name <input id="mod-name" value="${escapeHtml(editing?.label || "")}" /></label></div>
          <p class="section-header">Effects</p>
          <div id="mod-effects">${editingEffectInputs}</div>
          <div class="row"><button type="button" id="mod-add-effect-btn">Add Effect</button></div>
          <div class="row"><label>Enabled <input id="mod-enabled" type="checkbox" ${editing?.enabled === false ? "" : "checked"} /></label></div>
          <div class="row"><button type="button" id="mod-save-btn">Save</button><button type="button" id="mod-cancel-btn">Cancel</button></div>
          ${editing ? `<div class="row widget-delete-row"><button type="button" id="mod-delete-btn" class="danger-btn">Delete Modifier</button></div>` : ""}
        </div>
      </div>
    `;
    container.querySelector("[data-mod-add-btn]")?.addEventListener("click", () => {
      store.patch((draft) => {
        draft.ui.modifierWidgetEditorOpen = true;
        draft.ui.modifierWidgetEditingId = null;
        draft.ui.modifierWidgetGroupId = blockId;
        draft.ui.modifierPresetBrowserOpen = false;
        draft.ui.conditionInfoOpen = false;
        draft.ui.conditionInfoKey = "";
      });
    });
    container.querySelector("[data-mod-view-btn]")?.addEventListener("click", () => {
      store.patch((draft) => {
        draft.ui.modifierPresetBrowserOpen = true;
        draft.ui.modifierPresetGroupId = blockId;
        draft.ui.modifierWidgetEditorOpen = false;
        draft.ui.modifierWidgetEditingId = null;
        draft.ui.conditionInfoOpen = false;
        draft.ui.conditionInfoKey = "";
      });
    });
    container.querySelector("[data-mod-show-hidden-btn]")?.addEventListener("click", () => {
      store.patch((draft) => {
        const rowsNow = draft.base.modifierGroups?.[blockId]?.rows || [];
        rowsNow.forEach((row) => {
          if (row.enabled !== false && row.showInOverview === false) row.showInOverview = true;
        });
      });
    });
    container.querySelector("#mod-preset-close-btn")?.addEventListener("click", () => {
      store.patch((draft) => {
        draft.ui.modifierPresetBrowserOpen = false;
      });
    });
    const presetSearchInput = container.querySelector("#mod-preset-search");
    const applyPresetFilter = () => {
      const needle = String(presetSearchInput?.value || "").trim().toLowerCase();
      container.querySelectorAll(".modifier-preset-row").forEach((rowEl) => {
        const hay = String(rowEl.dataset.modPresetSearchText || "");
        rowEl.classList.toggle("hidden", Boolean(needle) && !hay.includes(needle));
      });
    };
    presetSearchInput?.addEventListener("input", applyPresetFilter);
    applyPresetFilter();
    container.querySelector("#mod-condition-info-close-btn")?.addEventListener("click", () => {
      store.patch((draft) => {
        draft.ui.conditionInfoOpen = false;
        draft.ui.conditionInfoKey = "";
      });
    });
    container.querySelectorAll("[data-mod-info-key]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.modInfoKey;
        if (!key) return;
        store.patch((draft) => {
          draft.ui.conditionInfoOpen = true;
          draft.ui.conditionInfoGroupId = blockId;
          draft.ui.conditionInfoKey = key;
        });
      });
    });
    container.querySelectorAll("[data-mod-row-info-key]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.modRowInfoKey;
        if (!key) return;
        store.patch((draft) => {
          draft.ui.conditionInfoOpen = true;
          draft.ui.conditionInfoGroupId = blockId;
          draft.ui.conditionInfoKey = key;
          draft.ui.modifierPresetBrowserOpen = false;
        });
      });
    });
    container.querySelectorAll("[data-mod-preset-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.modPresetToggle;
        const preset = MODIFIER_PRESETS.find((p) => p.key === key);
        if (!preset) return;
        store.patch((draft) => {
          draft.base.modifierGroups = draft.base.modifierGroups || {};
          draft.base.modifierGroups[blockId] = draft.base.modifierGroups[blockId] || { title: "Modifier Widget", rows: [], library: [] };
          const rowsNow = draft.base.modifierGroups[blockId].rows || [];
          const existing = rowsNow.find((m) => m.presetKey === preset.key);
          if (existing) {
            draft.base.modifierGroups[blockId].rows = rowsNow.filter((m) => m.presetKey !== preset.key);
            if (draft.ui.modifierWidgetEditingId === existing.id) {
              draft.ui.modifierWidgetEditingId = null;
              draft.ui.modifierWidgetEditorOpen = false;
            }
            return;
          }
          const effectsBatches = structuredClone(preset.effectsTemplate || []);
          const newRow = {
            id: uid(),
            presetKey: preset.key,
            label: preset.label,
            effectsBatches,
            effect: effectsBatches.map((e) => e.effect || "0").join(" + "),
            value: 0,
            enabled: false,
            showInOverview: true,
          };
          if (preset.levelConfig) {
            newRow.levelConfig = { ...preset.levelConfig, baseLabel: preset.label };
            applyPresetLevelToRow(newRow, preset.levelConfig.default || preset.levelConfig.min || 1);
          } else {
            newRow.value = effectsBatches.reduce((sum, e) => {
              const n = Number(e.effect);
              return sum + (Number.isFinite(n) ? n : 0);
            }, 0);
          }
          rowsNow.push(newRow);
          draft.base.modifierGroups[blockId].rows = rowsNow;
        });
      });
    });
    container.querySelectorAll("[data-mod-custom-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.modCustomToggle;
        if (!id) return;
        store.patch((draft) => {
          draft.base.modifierGroups = draft.base.modifierGroups || {};
          draft.base.modifierGroups[blockId] = draft.base.modifierGroups[blockId] || {
            title: "Modifier Widget",
            rows: [],
            library: [],
          };
          const g = draft.base.modifierGroups[blockId];
          const rowsNow = g.rows || [];
          const existing = rowsNow.find((m) => m.customDefId === id);
          if (existing) {
            g.rows = rowsNow.filter((m) => m.customDefId !== id);
            return;
          }
          const def = (g.library || []).find((x) => x.id === id);
          if (!def) return;
          const effectsBatches = structuredClone(def.effectsBatches || []);
          const numericTotal = effectsBatches.reduce((sum, e) => {
            const n = Number(e.effect);
            return sum + (Number.isFinite(n) ? n : 0);
          }, 0);
          rowsNow.push({
            id: uid(),
            customDefId: id,
            label: def.label || "Custom Modifier",
            effectsBatches,
            effect: effectsBatches.map((e) => e.effect).join(" + "),
            value: numericTotal,
            enabled: false,
            showInOverview: true,
          });
          g.rows = rowsNow;
        });
      });
    });
    container.querySelectorAll("[data-mod-custom-delete]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.modCustomDelete;
        if (!id) return;
        if (!window.confirm("Delete this created modifier from Activate list?")) return;
        store.patch((draft) => {
          const g = draft.base.modifierGroups?.[blockId];
          if (!g) return;
          g.library = (g.library || []).filter((x) => x.id !== id);
          g.rows = (g.rows || []).filter((m) => m.customDefId !== id);
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
    container.querySelectorAll("[data-mod-hide-toggle],[data-mod-visibility-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.modHideToggle || btn.dataset.modVisibilityToggle;
        if (!id) return;
        store.patch((draft) => {
          const g = draft.base.modifierGroups?.[blockId];
          const row = (g?.rows || []).find((m) => m.id === id);
          if (!row) return;
          row.showInOverview = row.showInOverview === false ? true : false;
        });
      });
    });
    container.querySelectorAll("[data-mod-up],[data-mod-down]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.modUp || btn.dataset.modDown;
        const dir = btn.dataset.modUp ? -1 : 1;
        if (!id) return;
        store.patch((draft) => {
          const g = draft.base.modifierGroups?.[blockId];
          if (!g || !Array.isArray(g.rows)) return;
          const rowsNow = g.rows;
          const idx = rowsNow.findIndex((m) => m.id === id);
          const nextIdx = idx + dir;
          if (idx < 0 || nextIdx < 0 || nextIdx >= rowsNow.length) return;
          const tmp = rowsNow[idx];
          rowsNow[idx] = rowsNow[nextIdx];
          rowsNow[nextIdx] = tmp;
          g.rows = rowsNow;
        });
      });
    });
    container.querySelectorAll("[data-mod-level-up],[data-mod-level-down]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.modLevelUp || btn.dataset.modLevelDown;
        const dir = btn.dataset.modLevelUp ? 1 : -1;
        if (!id) return;
        store.patch((draft) => {
          const g = draft.base.modifierGroups?.[blockId];
          const row = (g?.rows || []).find((m) => m.id === id);
          if (!row || !row.levelConfig) return;
          const min = Number(row.levelConfig.min || 1);
          const max = Number(row.levelConfig.max || min);
          const next = Math.max(min, Math.min(max, Number(row.level || min) + dir));
          applyPresetLevelToRow(row, next);
        });
      });
    });
    container.querySelectorAll("[data-mod-open-settings]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.modOpenSettings;
        if (!id) return;
        store.patch((draft) => {
          draft.ui.modifierWidgetEditorOpen = true;
          draft.ui.modifierWidgetEditingId = id;
          draft.ui.modifierWidgetGroupId = blockId;
          draft.ui.modifierPresetBrowserOpen = true;
          draft.ui.modifierPresetGroupId = blockId;
          draft.ui.conditionInfoOpen = false;
          draft.ui.conditionInfoKey = "";
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
    container.querySelector("#mod-delete-btn")?.addEventListener("click", () => {
      const id = store.getState().ui.modifierWidgetEditingId;
      if (!id) return;
      if (!window.confirm("Delete this modifier? This cannot be undone.")) return;
      store.patch((draft) => {
        const g = draft.base.modifierGroups?.[blockId];
        if (!g || !Array.isArray(g.rows)) return;
        g.rows = g.rows.filter((m) => m.id !== id);
        draft.ui.modifierWidgetEditingId = null;
        draft.ui.modifierWidgetEditorOpen = false;
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
        draft.base.modifierGroups[blockId] = draft.base.modifierGroups[blockId] || { title: "Modifier Widget", rows: [], library: [] };
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
          if (existing.levelConfig) {
            existing.levelConfig.baseLabel = name || existing.levelConfig.baseLabel || "Condition";
            applyPresetLevelToRow(existing, Number(existing.level || existing.levelConfig.min || 1));
          }
        } else {
          const g = draft.base.modifierGroups[blockId];
          g.library = g.library || [];
          g.library.push({
            id: uid(),
            label: name || "Custom Modifier",
            effectsBatches,
            effect: effectsBatches.map((e) => e.effect).join(" + "),
          });
        }
        draft.base.modifierGroups[blockId].rows = rowsNow;
        draft.ui.modifierWidgetEditorOpen = false;
        draft.ui.modifierWidgetEditingId = null;
        draft.ui.modifierWidgetGroupId = blockId;
      });
    });
    container.querySelectorAll(".weapon-editor-popup").forEach((overlay) => {
      overlay.addEventListener("click", (event) => {
        if (!event.target.classList.contains("weapon-editor-popup")) return;
        store.patch((draft) => {
          draft.ui.modifierWidgetEditorOpen = false;
          draft.ui.modifierWidgetEditingId = null;
          draft.ui.modifierWidgetGroupId = blockId;
          draft.ui.modifierPresetBrowserOpen = false;
          draft.ui.conditionInfoOpen = false;
          draft.ui.conditionInfoKey = "";
        });
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
      <button type="button" class="mini-btn" data-mod-move-up-idx="${nextIdx}" aria-label="Move effect up">↑</button>
      <button type="button" class="mini-btn" data-mod-move-down-idx="${nextIdx}" aria-label="Move effect down">↓</button>
      <button type="button" class="mini-btn" data-mod-del-effect-idx="${nextIdx}">Remove</button>`;
      holder.appendChild(row);
      row.querySelector("[data-mod-del-effect-idx]")?.addEventListener("click", () => row.remove());
      row.querySelector("[data-mod-move-up-idx]")?.addEventListener("click", () => {
        const current = row;
        const prev = current.previousElementSibling;
        if (prev) prev.before(current);
      });
      row.querySelector("[data-mod-move-down-idx]")?.addEventListener("click", () => {
        const current = row;
        const next = current.nextElementSibling;
        if (next) next.after(current);
      });
    });
    container.querySelectorAll("[data-mod-del-effect-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        btn.closest(".modifier-effect-row")?.remove();
      });
    });
    container.querySelectorAll("[data-mod-move-up-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const row = btn.closest(".modifier-effect-row");
        const prev = row?.previousElementSibling;
        if (row && prev) prev.before(row);
      });
    });
    container.querySelectorAll("[data-mod-move-down-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const row = btn.closest(".modifier-effect-row");
        const next = row?.nextElementSibling;
        if (row && next) next.after(row);
      });
    });
  });

  const defaultWeapon = createInitialState().weaponWidget;
  const renderDamageEditorRow = (damage, varListAttr = "") => `
    <div class="row weapon-editor-row">
      <label>Label <input data-ww-kind="damage" data-ww-id="${damage.id}" data-ww-field="label" value="${escapeHtml(damage.label)}" /></label>
      <label>Formula <input data-ww-kind="damage" data-ww-id="${damage.id}" data-ww-field="formula" ${varListAttr} value="${escapeHtml(damage.formula)}" /></label>
    </div>`;
  const weaponContainers = [...document.querySelectorAll("[data-weapon-widget-id]")];
  root.weaponWidget = weaponContainers[0] || null;
  weaponContainers.forEach((el) => {
    const blockId = el.dataset.weaponWidgetId || "weapon-widget";
    const weaponVarAssist = renderVariableAssist(
      `weapon-variable-options-${String(blockId).replace(/[^a-zA-Z0-9_-]/g, "-")}`,
      variableTokens,
      'input[data-ww-kind="damage"][data-ww-field="formula"],input[data-ww-kind="damageToggle"][data-ww-field="formula"]'
    );
    const widget = structuredClone(state.weaponWidgets?.[blockId] || state.weaponWidgets?.["weapon-widget"] || defaultWeapon);
    const attackGroupName = String(widget.groupName || "Attack Widget").trim() || "Attack Widget";
    const attackBonusRows = (widget.attackBonuses || [])
      .filter((b) => b.alwaysOn || b.on)
      .map((b) => ({
        enabled: true,
        target: "attack",
        type: String(b.type || "item"),
        effect: String(Number(b.bonus || 0)),
      }));
    const attackBonusTotal = summarizeModifiers(attackBonusRows, "attack").total;
    const attackModTotal = summarizeModifiers(modifierRowsFlat, "attack").total;
    const damageModTotal = summarizeModifiers(modifierRowsFlat, "damage").total;
    const strikeBase =
      weaponStrikeBase(state, widget) + attackBonusTotal + attackModTotal;
    const mapStep = Math.max(0, Number(widget.mapPenalty ?? 5));
    const strikeBonuses = [strikeBase, strikeBase - mapStep, strikeBase - 2 * mapStep];
    const strikeLabels = ["1st", "2nd", "3rd"];
    const fmtAtk = (n) => `${n >= 0 ? "+" : ""}${n}`;
    const atkProfMode = widget.attackProficiency || "weapon";
    const attackRows = strikeBonuses
      .map(
        (bonus, i) => `
        <button type="button" class="weapon-roll-btn ${modTone(attackModTotal)}" data-roll-name="${escapeHtml(widget.name)} Strike (${strikeLabels[i]})" data-roll-bonus="${bonus}">${fmtAtk(
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
      .filter((t) => !t.alwaysOn)
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
      .filter((b) => !b.alwaysOn)
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
    const hitEditorRow = damageRows[0] ? renderDamageEditorRow(damageRows[0], weaponVarAssist.listAttr) : "";
    const critEditorRow = damageRows[1] ? renderDamageEditorRow(damageRows[1], weaponVarAssist.listAttr) : "";
    const toggleEditorRows = (widget.damageToggles || [])
      .map(
        (t) => `
        <div class="weapon-bonus-row">
          <label>Label <input data-ww-kind="damageToggle" data-ww-id="${t.id}" data-ww-field="label" value="${escapeHtml(t.label)}" /></label>
          <label>Bonus dice <input data-ww-kind="damageToggle" data-ww-id="${t.id}" data-ww-field="formula" ${weaponVarAssist.listAttr} value="${escapeHtml(t.formula)}" placeholder="e.g. 2d6 or +4" /></label>
          <label>Type
            <select data-ww-kind="damageToggle" data-ww-id="${t.id}" data-ww-field="type">
              ${MODIFIER_TYPES.map((type) => `<option value="${type}" ${String(t.type || "untyped") === type ? "selected" : ""}>${type}</option>`).join("")}
            </select>
          </label>
          <label class="weapon-toggle-inline"><input type="checkbox" data-ww-kind="damageToggle" data-ww-id="${t.id}" data-ww-field="alwaysOn" ${
            t.alwaysOn ? "checked" : ""
          } /> always on</label>
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
          <label>Type
            <select data-ww-atk-bonus-id="${b.id}" data-ww-field="type">
              ${MODIFIER_TYPES.map((type) => `<option value="${type}" ${String(b.type || "item") === type ? "selected" : ""}>${type}</option>`).join("")}
            </select>
          </label>
          <label class="weapon-toggle-inline"><input type="checkbox" data-ww-atk-bonus-id="${b.id}" data-ww-field="alwaysOn" ${
            b.alwaysOn ? "checked" : ""
          } /> always on</label>
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
        <button type="button" class="weapon-roll-btn weapon-damage-main-btn ${modTone(damageModTotal)}" data-roll-name="${escapeHtml(widget.name)} ${hitLabel}" data-roll-formula="${escapeHtml(hitFormula)}">Damage</button>
        <button type="button" class="weapon-roll-btn weapon-crit-mini-btn ${modTone(damageModTotal)}" title="${escapeHtml(
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
      ${weaponVarAssist.hintHtml}
      ${weaponVarAssist.datalistHtml}
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
      const hpMax = Math.max(0, Number(draft.derived?.hp?.max || 0));
      const raw = Number(event.currentTarget.value || 0);
      draft.base.hp.current = Math.max(0, Math.min(hpMax, raw));
    });
  });
  document.querySelector("#strip-hp-temp")?.addEventListener("change", (event) => {
    store.patch((draft) => {
      draft.base.hp.temp = Math.max(0, Number(event.currentTarget.value || 0));
    });
  });
  document.querySelector("#strip-damage-apply-btn")?.addEventListener("click", () => {
    const amount = Math.max(0, Number(document.querySelector("#strip-damage-input")?.value || 0));
    if (!amount) return;
    const prev = store.getState();
    const prevTemp = Math.max(0, Number(prev.base?.hp?.temp || 0));
    const prevHp = Math.max(0, Number(prev.base?.hp?.current || 0));
    store.patch((draft) => {
      const currentTemp = Math.max(0, Number(draft.base.hp.temp || 0));
      const currentHp = Math.max(0, Number(draft.base.hp.current || 0));
      const soak = Math.min(currentTemp, amount);
      const overflow = Math.max(0, amount - soak);
      draft.base.hp.temp = currentTemp - soak;
      draft.base.hp.current = Math.max(0, currentHp - overflow);
    });
    const next = store.getState();
    const nextTemp = Math.max(0, Number(next.base?.hp?.temp || 0));
    const nextHp = Math.max(0, Number(next.base?.hp?.current || 0));
    addRollLog(
      {
        name: "Damage",
        message: `${amount} (Temp ${prevTemp}->${nextTemp}, HP ${prevHp}->${nextHp})`,
      },
      false
    );
    store.patch((draft) => {
      draft.ui.rollLogOpen = true;
    });
    const input = document.querySelector("#strip-damage-input");
    if (input) input.value = "";
  });
  document.querySelector("#strip-healing-apply-btn")?.addEventListener("click", () => {
    const amount = Math.max(0, Number(document.querySelector("#strip-healing-input")?.value || 0));
    if (!amount) return;
    const prev = store.getState();
    const prevHp = Math.max(0, Number(prev.base?.hp?.current || 0));
    store.patch((draft) => {
      const hpMax = Math.max(0, Number(draft.derived?.hp?.max || 0));
      const currentHp = Math.max(0, Number(draft.base.hp.current || 0));
      draft.base.hp.current = Math.min(hpMax, currentHp + amount);
    });
    const next = store.getState();
    const nextHp = Math.max(0, Number(next.base?.hp?.current || 0));
    addRollLog(
      {
        name: "Healing",
        message: `${amount} (HP ${prevHp}->${nextHp})`,
      },
      false
    );
    store.patch((draft) => {
      draft.ui.rollLogOpen = true;
    });
    const input = document.querySelector("#strip-healing-input");
    if (input) input.value = "";
  });
  document.querySelector("#strip-raise-shield")?.addEventListener("change", (event) => {
    store.patch((draft) => {
      draft.base.toggles.raiseShield = Boolean(event.currentTarget.checked);
    });
  });
  document.querySelector("#strip-raise-shield-settings-btn")?.addEventListener("click", () => {
    store.patch((draft) => {
      draft.ui.shieldSettingsOpen = !draft.ui.shieldSettingsOpen;
    });
  });
  document.querySelectorAll("[data-armor-settings-open]").forEach((btn) => {
    btn.addEventListener("click", () => {
      store.patch((draft) => {
        draft.ui.armorSettingsOpen = !draft.ui.armorSettingsOpen;
      });
    });
  });
  document.querySelector("#armor-settings-close-btn")?.addEventListener("click", () => {
    store.patch((draft) => {
      draft.ui.armorSettingsOpen = false;
    });
  });
  document.querySelector("#strip-raise-shield-bonus")?.addEventListener("change", (event) => {
    store.patch((draft) => {
      draft.base.toggles.raiseShieldBonus = Math.max(0, Number(event.currentTarget.value || 0));
    });
  });
  document.querySelectorAll("input[data-armor-field],select[data-armor-field]").forEach((el) => {
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
            const resolved = evaluateExpression(formula, resolver, {
              resolveTypedSummary: (target) => summarizeModifiers(modifierRowsFlat, target),
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
  document.querySelector("[data-armor-add-bonus]")?.addEventListener("click", () => {
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
  document.querySelectorAll("input[data-armor-bonus-id],select[data-armor-bonus-id]").forEach((el) => {
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
  document.querySelectorAll("[data-armor-del-bonus]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.armorDelBonus;
      store.patch((draft) => {
        draft.base.armor = coerceArmorState(draft.base.armor);
        draft.base.armor.bonuses = (draft.base.armor.bonuses || []).filter((b) => b.id !== id);
      });
    });
  });
  document.querySelector("#armor-settings-popup")?.addEventListener("click", (event) => {
    if (!event.target.classList.contains("weapon-editor-popup")) return;
    store.patch((draft) => {
      draft.ui.armorSettingsOpen = false;
    });
  });
  bindVariableInsertHandlers(document);
  bindVariableAutocomplete(document, variableTokens);

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
          const vars = resolveVariableMap(store.getState());
          const resolver = (varName) =>
            vars[String(varName || "").toLowerCase().replace(/-/g, "_")];
          const resolved = evaluateExpression(formula, resolver, {
            resolveTypedSummary: (target) => summarizeModifiers(modifierRowsFlat, target),
          });
          const { total, breakdown } = rollDiceExpression(resolved);
          addRollLog(
            {
              name,
              message: `${total} (${breakdown.join(", ")}${resolved !== formula ? `; ${resolved}` : ""})`,
            },
            false
          );
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
          type: "untyped",
          on: false,
          alwaysOn: false,
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
    container.querySelectorAll("input[data-ww-atk-bonus-id],select[data-ww-atk-bonus-id]").forEach((el) => {
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
          type: "item",
          on: true,
          alwaysOn: false,
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
    const customVarAssist = renderVariableAssist(
      `custom-variable-options-${String(groupId).replace(/[^a-zA-Z0-9_-]/g, "-")}`,
      variableTokens,
      "#cw-roll1,#cw-roll2"
    );
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
      <div class="custom-widgets-header-row widget-head-row">
        <p class="section-header">${escapeHtml(group.title || "Flex Widget")}</p>
        <div class="widget-head-actions">
          <button type="button" id="cw-add-btn" class="mini-btn" title="Add Ability">+</button>
        </div>
      </div>
      <div>${widgetRows || `<p class="muted">No custom widgets yet.</p>`}</div>
      <div class="weapon-editor-popup ${state.ui.customWidgetEditorOpen && state.ui.customWidgetGroupId === groupId ? "" : "hidden"}">
        <div class="weapon-editor-card">
          <p class="section-header">${editing ? "Edit Widget" : "Add Widget"}</p>
          <div class="row"><label>Group name <input id="cw-group-name" value="${escapeHtml(group.title || "Flex Widget")}" /></label></div>
          <div class="row"><label>Title <input id="cw-title" value="${escapeHtml(editing?.title || "")}" /></label></div>
          <label>Content <textarea id="cw-content" placeholder="Any text content.">${escapeHtml(editing?.content || "")}</textarea></label>
          <div class="row">
            <label>Roll 1 <input id="cw-roll1" ${customVarAssist.listAttr} value="${escapeHtml(editing?.roll1 || "")}" placeholder="Attack: 1d20 + $str + 12" /></label>
            <label>Roll 2 <input id="cw-roll2" ${customVarAssist.listAttr} value="${escapeHtml(editing?.roll2 || "")}" placeholder="Damage: 2d6 + $str" /></label>
            <label>Toggle count <input id="cw-toggle-count" type="number" min="0" max="5" step="1" value="${Math.min(5, editing?.toggleCount || 0)}" /></label>
          </div>
          ${customVarAssist.hintHtml}
          ${customVarAssist.datalistHtml}
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
          const resolver = (name) => vars[String(name || "").toLowerCase().replace(/-/g, "_")];
          const resolvedLabel = expandTemplate(label, resolver);
          const resolved = evaluateExpression(formula, resolver, {
            resolveTypedSummary: (target) => summarizeModifiers(modifierRowsFlat, target),
          });
          const { total, breakdown } = rollDiceExpression(resolved);
          const widgetName =
            (store.getState().widgetGroups?.[groupId]?.widgets || []).find((w) => w.id === wid)?.title || "Widget";
          addRollLog(
            {
              name: `${widgetName}: ${resolvedLabel}`,
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

function closeManageCharactersPopup() {
  if (!root.manageCharactersPopup || !root.manageCharactersBtn) return;
  root.manageCharactersPopup.classList.remove("open");
  root.manageCharactersPopup.setAttribute("aria-hidden", "true");
  root.manageCharactersBtn.setAttribute("aria-expanded", "false");
}

function toggleCharacterManagerOpen() {
  store.patch((draft) => {
    draft.ui.characterManagerOpen = !draft.ui.characterManagerOpen;
  });
}

function createNewCharacter() {
  const fresh = createInitialState();
  const proposed = window.prompt("Name for new character:", "Character");
  const name = String(proposed ?? "").trim();
  if (proposed !== null && name) {
    fresh.base = fresh.base || {};
    fresh.base.characterName = name;
    fresh.saveMeta = fresh.saveMeta || {};
    fresh.saveMeta.saveName = name;
  }
  store.patch((draft) => {
    Object.assign(draft, fresh);
  });
  addRollLog(`Created new character: ${fresh.base?.characterName || fresh.saveMeta?.saveName || "Character"}`, false);
}

function importCharacter() {
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
}

function exportCharacter() {
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
}

root.manageCharactersBtn?.addEventListener("click", (event) => {
  event.stopPropagation();
  if (!root.manageCharactersPopup) return;
  const isOpen = root.manageCharactersPopup.classList.toggle("open");
  root.manageCharactersPopup.setAttribute("aria-hidden", String(!isOpen));
  root.manageCharactersBtn?.setAttribute("aria-expanded", String(isOpen));
});

root.manageCharactersOpenBtn?.addEventListener("click", () => {
  toggleCharacterManagerOpen();
});

root.manageImportBtn?.addEventListener("click", () => {
  importCharacter();
});

root.manageExportBtn?.addEventListener("click", () => {
  exportCharacter();
});

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!target || !root.manageCharactersPopup) return;
  if (target instanceof Element && target.closest(".manage-menu-wrap")) return;
  closeManageCharactersPopup();
});

root.charactersClose?.addEventListener("click", () => {
  store.patch((draft) => {
    draft.ui.characterManagerOpen = false;
  });
});

root.charactersNewBtn?.addEventListener("click", () => {
  createNewCharacter();
});

root.charactersSaveAsBtn?.addEventListener("click", () => {
  const current = store.getState();
  const currentName = String(current.base?.characterName || current.saveMeta?.saveName || "Character");
  const proposed = window.prompt("Save current character as:", `${currentName} Copy`);
  const nextName = String(proposed ?? "").trim();
  if (proposed == null || !nextName) return;
  const cloned = structuredClone(current);
  cloned.base = cloned.base || {};
  cloned.base.characterName = nextName;
  cloned.saveMeta = cloned.saveMeta || {};
  cloned.saveMeta.saveId = uid();
  cloned.saveMeta.saveName = nextName;
  saveState(cloned);
  store.patch((draft) => {
    draft.base = draft.base || {};
    draft.base.characterName = nextName;
    draft.saveMeta = draft.saveMeta || {};
    draft.saveMeta.saveId = cloned.saveMeta.saveId;
    draft.saveMeta.saveName = nextName;
  });
  addRollLog(`Saved as: ${nextName}`, false);
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

root.quickRollToggle?.addEventListener("click", () => {
  store.patch((draft) => {
    draft.ui.quickRollOpen = !draft.ui.quickRollOpen;
  });
});

root.rollLogClose.addEventListener("click", () => {
  store.patch((draft) => {
    draft.ui.rollLogOpen = false;
  });
});

root.quickRollClose?.addEventListener("click", () => {
  store.patch((draft) => {
    draft.ui.quickRollOpen = false;
  });
});

root.quickRollD20Btn?.addEventListener("click", () => {
  const d20 = Math.floor(Math.random() * 20) + 1;
  addRollLog({ name: "Quick Roll", message: `${d20} (1d20: ${d20})` }, false);
  store.patch((draft) => {
    draft.ui.rollLogOpen = true;
  });
});

root.quickRollApplyBtn?.addEventListener("click", () => {
  const count = Math.max(1, Number(root.quickRollCount?.value || 1));
  const sides = Math.max(2, Number(root.quickRollSides?.value || 6));
  const formula = `${count}d${sides}`;
  try {
    const { total, breakdown } = rollDiceExpression(formula);
    addRollLog({ name: "Quick Roll", message: `${total} (${breakdown.join(", ")})` }, false);
    store.patch((draft) => {
      draft.ui.rollLogOpen = true;
    });
  } catch (_err) {
    addRollLog({ name: "Quick Roll", message: `Failed roll: ${formula}` }, true);
  }
});

