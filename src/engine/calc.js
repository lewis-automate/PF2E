import { summarizeModifiers } from "./modifiers.js";

const PROF_BONUS = {
  untrained: 0,
  trained: 2,
  expert: 4,
  master: 6,
  legendary: 8,
};

export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

/** Which ability modifier is folded into Class DC (and thus Class DC − 10, spell attack, etc.). */
export const CLASS_DC_KEY_OPTIONS = [
  { value: "maxStrDexIntWis", label: "Highest of STR, DEX, INT, WIS" },
  { value: "str", label: "STR" },
  { value: "dex", label: "DEX" },
  { value: "con", label: "CON" },
  { value: "int", label: "INT" },
  { value: "wis", label: "WIS" },
  { value: "cha", label: "CHA" },
];

const CLASS_DC_KEYS = new Set(CLASS_DC_KEY_OPTIONS.map((o) => o.value));

export function classDcKeyAbilityMod(mods, classDcKey) {
  const key = CLASS_DC_KEYS.has(classDcKey) ? classDcKey : "maxStrDexIntWis";
  if (key === "maxStrDexIntWis") {
    return Math.max(mods.str, mods.dex, mods.int, mods.wis);
  }
  return mods[key] ?? 0;
}
export const ARMOR_TYPES = ["unarmored", "light", "medium", "heavy"];
export const WEAPON_TYPES = ["unarmed", "simple", "martial", "advanced"];
export const SKILL_TO_ABILITY = {
  acrobatics: "dex",
  arcana: "int",
  athletics: "str",
  crafting: "int",
  deception: "cha",
  diplomacy: "cha",
  intimidation: "cha",
  medicine: "wis",
  nature: "wis",
  occultism: "int",
  performance: "cha",
  religion: "wis",
  society: "int",
  stealth: "dex",
  survival: "wis",
  thievery: "dex",
};

export function abilityMod(score) {
  const safe = Number.isFinite(score) ? score : Number(score || 10);
  return Math.floor((safe - 10) / 2);
}

export function profRankToBonus(rank) {
  return PROF_BONUS[rank] ?? 0;
}

export function calculateDerived(base) {
  const skillAbilityOverrides = base.skillAbilityOverrides || {};
  const skillAbilities = Object.fromEntries(
    Object.entries(SKILL_TO_ABILITY).map(([skill, defaultAbility]) => {
      const override = skillAbilityOverrides[skill];
      const chosen = ABILITIES.includes(override) ? override : defaultAbility;
      return [skill, chosen];
    })
  );

  const level = Number(base.level || 1);
  const armor = base.armor || {};
  const mods = Object.fromEntries(
    ABILITIES.map((key) => [key, abilityMod(Number(base.stats[key] || 10))])
  );
  const armorDexCap = Number.isFinite(Number(armor.dexCap)) ? Number(armor.dexCap) : 99;
  const appliedDexMod = Math.min(mods.dex, armorDexCap);
  const armorBonusRows = (Array.isArray(armor.bonuses) ? armor.bonuses : []).map((b) => ({
    enabled: true,
    target: "ac",
    type: String(b?.type || "item"),
    effect: String(Number(b?.bonus || 0)),
  }));
  const armorAcBonus = Number(armor.acBonus || 0) + summarizeModifiers(armorBonusRows, "ac").total;
  const armorModifierValue = Number(armor.modifierValue || 0);
  const armorSpeedPenalty = Number(armor.speedPenalty || 0);
  const armorCheckPenalty = Number(armor.checkPenalty || 0);

  const armorType = base.armorType || "unarmored";
  const weaponType = base.weaponType || "simple";
  const armorKey = `armor_${armorType}`;
  const weaponKey = `weapon_${weaponType}`;

  const rankBonus = {
    perception: profRankToBonus(base.proficiencies.perception),
    ac: profRankToBonus(base.proficiencies[armorKey] || base.proficiencies.ac),
    fortitude: profRankToBonus(base.proficiencies.fortitude),
    reflex: profRankToBonus(base.proficiencies.reflex),
    will: profRankToBonus(base.proficiencies.will),
    attack: profRankToBonus(base.proficiencies[weaponKey] || base.proficiencies.attack),
    classDc: profRankToBonus(base.proficiencies.classDc),
  };

  const defense = {
    ac:
      10 +
      appliedDexMod +
      level +
      rankBonus.ac +
      Number(base.bonuses.acItem || 0) +
      armorAcBonus +
      armorModifierValue +
      Number(base.toggles?.raiseShield ? Number(base.toggles?.raiseShieldBonus || 1) : 0),
    fortitude:
      10 + mods.con + level + rankBonus.fortitude + Number(base.bonuses.fortitudeItem || 0),
    reflex: 10 + mods.dex + level + rankBonus.reflex + Number(base.bonuses.reflexItem || 0),
    will: 10 + mods.wis + level + rankBonus.will + Number(base.bonuses.willItem || 0),
    perception:
      10 + mods.wis + level + rankBonus.perception + Number(base.bonuses.perceptionItem || 0),
  };

  const health = base.health || {};
  const ancestryBase = Number(health.ancestryBase || 0);
  const classPerLevel = Number(health.classPerLevel || 0);
  const perLevelModifier = Number(health.perLevelModifier || 0);
  const flatBonus = Number(health.flatBonus || 0);
  // PF2E default model: ancestry HP once + class HP each level + CON mod each level.
  const hpMax =
    ancestryBase + level * (classPerLevel + mods.con + perLevelModifier) + flatBonus;
  const hpCurrent = Number(base.hp.current || 0);
  const hpTemp = Number(base.hp.temp || 0);
  const rawModifierRows = base.modifierGroups && typeof base.modifierGroups === "object"
    ? Object.values(base.modifierGroups).flatMap((g) => (Array.isArray(g?.rows) ? g.rows : []))
    : base.modifiers || [];
  const modifierRows = rawModifierRows.flatMap((row) => {
    if (Array.isArray(row?.effectsBatches) && row.effectsBatches.length) {
      return row.effectsBatches.map((b) => {
        const effectText = String(b?.effect || "").trim();
        const parsed = Number(effectText);
        const targets = Array.isArray(b?.targets) && b.targets.length
          ? b.targets.map((t) => String(t || "all"))
          : [String(b?.target || "all")];
        return {
          enabled: row.enabled !== false && b?.enabled !== false,
          targets,
          target: targets[0] || "all",
          type: String(b?.type || "untyped"),
          effect: effectText,
          value: Number.isFinite(parsed) ? parsed : 0,
        };
      });
    }
    return [row];
  });
  const modifierSummary = summarizeModifiers(modifierRows, "all");
  const modFor = (target) => summarizeModifiers(modifierRows, target).total;
  const speedRows = (Array.isArray(base.speedChanges) ? base.speedChanges : []).map((row) => ({
    enabled: true,
    target: "speed",
    type: String(row?.type || "item"),
    effect: String(Number(row?.value || 0)),
  }));
  const speedAllRows = [...modifierRows, ...speedRows];
  const speed = Number(base.baseSpeed || 0) - armorSpeedPenalty + summarizeModifiers(speedAllRows, "speed").total;
  // PF2E default initiative is Perception unless another skill is explicitly used.
  const initiative = defense.perception - 10 + modFor("initiative");
  const skills = Object.fromEntries(
    Object.entries(skillAbilities).map(([skill, ability]) => {
      const rank = base.proficiencies?.[skill] || "untrained";
      // PF2e: untrained checks use ability mod only (no level); trained+ add level + proficiency.
      const levelForSkill = rank === "untrained" ? 0 : level;
      return [
        skill,
        mods[ability] +
          levelForSkill +
          profRankToBonus(rank) +
          modFor("skill") +
          modFor(`skill:${skill}`) +
          (["acrobatics", "athletics", "stealth", "thievery"].includes(skill) ? -armorCheckPenalty : 0),
      ];
    })
  );
  defense.ac += modFor("ac");
  defense.fortitude += modFor("fortitude");
  defense.reflex += modFor("reflex");
  defense.will += modFor("will");
  defense.perception += modFor("perception");

  return {
    mods,
    rankBonus,
    armorType,
    weaponType,
    defense,
    attackBase: level + rankBonus.attack,
    classDc: 10 + level + rankBonus.classDc + classDcKeyAbilityMod(mods, base.classDcKey) + modFor("classDc"),
    hp: { max: hpMax, current: hpCurrent, temp: hpTemp },
    speed,
    modifierSummary,
    initiative,
    skills,
    skillAbilities,
  };
}
