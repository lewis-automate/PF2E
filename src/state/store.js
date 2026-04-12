import {
  calculateDerived,
  ABILITIES,
  SKILL_TO_ABILITY,
  ARMOR_TYPES,
  WEAPON_TYPES,
} from "../engine/calc.js";

function createInitialState() {
  const stats = Object.fromEntries(ABILITIES.map((k) => [k, 10]));
  const skillProficiencies = Object.fromEntries(
    Object.keys(SKILL_TO_ABILITY).map((skill) => [skill, "untrained"])
  );
  const armorProficiencies = Object.fromEntries(ARMOR_TYPES.map((type) => [`armor_${type}`, "trained"]));
  const weaponProficiencies = Object.fromEntries(
    WEAPON_TYPES.map((type) => [`weapon_${type}`, "trained"])
  );
  return {
    version: 1,
    saveMeta: {
      saveId: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      saveName: "New Save",
    },
    base: {
      characterName: "Character",
      level: 1,
      baseSpeed: 25,
      armorType: "unarmored",
      weaponType: "simple",
      classDcKey: "maxStrDexIntWis",
      stats,
      proficiencies: {
        perception: "trained",
        fortitude: "trained",
        reflex: "trained",
        will: "trained",
        classDc: "trained",
        ...armorProficiencies,
        ...weaponProficiencies,
        ...skillProficiencies,
      },
      bonuses: {
        acItem: 0,
        fortitudeItem: 0,
        reflexItem: 0,
        willItem: 0,
        perceptionItem: 0,
      },
      armor: {
        name: "",
        group: "",
        bulk: "",
        acBonus: 0,
        dexCap: 5,
        checkPenalty: 0,
        speedPenalty: 0,
        strengthRequirement: 0,
        bonuses: [],
        enchantments: "",
        modifiers: "",
        modifierValue: 0,
      },
      modifiers: [],
      modifierGroups: {
        "modifier-widget": {
          title: "Modifier Widget",
          rows: [],
          library: [],
        },
      },
      toggles: {
        raiseShield: false,
        raiseShieldBonus: 1,
      },
      health: {
        ancestryBase: 8,
        classPerLevel: 8,
        perLevelModifier: 0,
        flatBonus: 0,
      },
      customProficiencies: {
        core: [],
        skill: [],
      },
      skillAbilityOverrides: {},
      customSkillAbilities: {},
      favoriteSkills: [],
      hp: { max: 20, current: 20, temp: 0 },
      speedChanges: [],
    },
    derived: {},
    variables: {},
    abilities: [],
    customWidgets: [],
    overviewLayout: {
      rows: [
        { layout: "thirds", cols: [["base-strip"], ["initiative-strip"], ["skills-strip"]] },
        { layout: "thirds", cols: [["weapon-widget"], ["main-widgets"], ["modifier-widget"]] },
      ],
    },
    weaponWidget: {
      groupName: "Attack Widget",
      name: "+1 Striking Rapier",
      subtitle: "",
      proficiencyType: "martial",
      attackAbility: "maxStrDex",
      attackProficiency: "weapon",
      attackBonuses: [],
      damageAbility: "none",
      damageType: "piercing",
      mapPenalty: 5,
      damageToggles: [],
      damages: [
        { id: "d1", label: "Damage", formula: "2d6+4" },
        { id: "d2", label: "Critical", formula: "4d6+8" },
      ],
    },
    ui: {
      activeTab: "overview",
      rollLogOpen: false,
      weaponWidgetEditorOpen: false,
      modifierWidgetEditorOpen: false,
      modifierWidgetEditingId: null,
      modifierWidgetGroupId: "modifier-widget",
      modifierPresetBrowserOpen: false,
      modifierPresetGroupId: "modifier-widget",
      modifierPresetSearch: "",
      conditionInfoOpen: false,
      conditionInfoGroupId: "modifier-widget",
      conditionInfoKey: "",
      customWidgetEditorOpen: false,
      customWidgetEditingId: null,
      characterManagerOpen: false,
      overviewLayoutEdit: false,
      shieldSettingsOpen: false,
      quickRollOpen: false,
    },
    rollLog: [],
  };
}

export function createStore(seedState) {
  const listeners = new Set();
  let state = structuredClone(seedState || createInitialState());

  function recompute() {
    state.derived = calculateDerived(state.base);
  }

  function emit() {
    for (const listener of listeners) listener(getState());
  }

  function getState() {
    return structuredClone(state);
  }

  function patch(mutator) {
    mutator(state);
    recompute();
    emit();
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  recompute();

  return { getState, patch, subscribe, createInitialState };
}

export { createInitialState };
