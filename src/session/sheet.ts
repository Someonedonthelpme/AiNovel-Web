import type { Ability, Abilities, Attack, Combatant } from '../combat/types.ts';
import { ABILITIES, abilityMod } from '../combat/types.ts';
import type { Status } from '../engine/types.ts';

/**
 * The character sheet, and the bridge from it into the combat engine.
 *
 * One ability set serves the whole game: d20 + modifier resolves combat, and the
 * 2d6 three-tier system uses the same modifiers for social and exploration
 * checks. Two resolution systems, one sheet.
 *
 * Skills belong to BACKGROUNDS, not to a shared pool — a soldier, a scholar and
 * a thief draw on different things, which is what makes the choice at character
 * creation matter.
 */

export const SKILL_KINDS = ['combat', 'social', 'utility'] as const;
export type SkillKind = (typeof SKILL_KINDS)[number];

export type Skill = {
  id: string;
  /** Generated in the play language, so a Thai character gets Thai skill names. */
  name: string;
  description: string;
  ability: Ability;
  kind: SkillKind;
};

export type Item = { id: string; name: string; description: string };

export type Background = {
  id: string;
  name: string;
  description: string;
  /** Added on top of the point-bought base scores. */
  grantsStats: Partial<Abilities>;
  /** This background's own skills. Not drawn from a shared list. */
  grantsSkills: Skill[];
  startingGear: Item[];
  startingAttacks: Attack[];
  /** Standing relative to most NPCs; feeds the Thai register mechanic. */
  socialStanding: Status;
};

export type CharacterSheet = {
  name: string;
  language: 'th' | 'en';
  background: Background;
  /** Base scores before the background's bonuses. */
  baseAbilities: Abilities;
  traits: string[];
  level: number;
  hitDie: number;
  voice: { selfPronoun: string; underStress: string };
};

/* -------------------------------------------------------------------------- */
/* Point buy                                                                   */
/* -------------------------------------------------------------------------- */

export const POINT_BUY_BUDGET = 27;
export const POINT_BUY_MIN = 8;
export const POINT_BUY_MAX = 15;

const COSTS: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };

/** Cost of a single score, or null when it is outside the buyable range. */
export function pointBuyCost(score: number): number | null {
  return COSTS[score] ?? null;
}

export type AbilityValidation = { ok: boolean; spent: number; errors: string[] };

export function validateAbilities(base: Abilities): AbilityValidation {
  const errors: string[] = [];
  let spent = 0;

  for (const ability of ABILITIES) {
    const score = base[ability];
    if (!Number.isInteger(score)) {
      errors.push(`${ability} must be a whole number, got ${score}`);
      continue;
    }
    const cost = pointBuyCost(score);
    if (cost === null) {
      errors.push(`${ability} is ${score}; scores must be ${POINT_BUY_MIN}-${POINT_BUY_MAX}`);
      continue;
    }
    spent += cost;
  }

  if (spent > POINT_BUY_BUDGET) {
    errors.push(`spends ${spent} points, budget is ${POINT_BUY_BUDGET}`);
  }
  return { ok: errors.length === 0, spent, errors };
}

/** An even spread that costs exactly the budget — the fallback starting array. */
export function defaultAbilities(): Abilities {
  // 5+5+5+4+4+4 = 27. Leaving points unspent would quietly hand out a worse
  // character than the rules allow.
  return { str: 13, dex: 13, con: 13, int: 12, wis: 12, cha: 12 };
}

/* -------------------------------------------------------------------------- */
/* Derived values                                                              */
/* -------------------------------------------------------------------------- */

/** Base scores plus whatever the background grants. */
export function finalAbilities(sheet: CharacterSheet): Abilities {
  const out = { ...sheet.baseAbilities };
  for (const ability of ABILITIES) {
    out[ability] = out[ability] + (sheet.background.grantsStats[ability] ?? 0);
  }
  return out;
}

export function proficiencyFor(level: number): number {
  return 2 + Math.floor((Math.max(1, level) - 1) / 4);
}

/**
 * Full hit die at first level, then the average rounded up per level after —
 * the standard fixed-progression option, so a character is never crippled by
 * one unlucky roll.
 */
export function maxHpFor(sheet: CharacterSheet): number {
  const con = abilityMod(finalAbilities(sheet).con);
  const perLevel = Math.floor(sheet.hitDie / 2) + 1;
  const level = Math.max(1, sheet.level);
  return Math.max(1, sheet.hitDie + con + (level - 1) * (perLevel + con));
}

export function armourClassFor(sheet: CharacterSheet): number {
  return 10 + abilityMod(finalAbilities(sheet).dex);
}

export type DerivedSheet = {
  abilities: Abilities;
  maxHp: number;
  ac: number;
  proficiency: number;
  speed: number;
  skills: Skill[];
};

export function derive(sheet: CharacterSheet): DerivedSheet {
  return {
    abilities: finalAbilities(sheet),
    maxHp: maxHpFor(sheet),
    ac: armourClassFor(sheet),
    proficiency: proficiencyFor(sheet.level),
    speed: 6,
    skills: sheet.background.grantsSkills,
  };
}

/* -------------------------------------------------------------------------- */
/* Bridge into the combat engine                                               */
/* -------------------------------------------------------------------------- */

/**
 * The one place the sheet becomes a combatant. Everything the combat engine
 * needs is derived here, so the two systems can never disagree about a
 * character's numbers.
 */
export function toCombatant(sheet: CharacterSheet, id = 'pc'): Combatant {
  const d = derive(sheet);
  return {
    id,
    name: sheet.name,
    side: 'party',
    abilities: d.abilities,
    hp: d.maxHp,
    maxHp: d.maxHp,
    ac: d.ac,
    speed: d.speed,
    proficiency: d.proficiency,
    size: 'medium',
    pos: { x: 0, y: 0 },
    conditions: [],
    attacks: sheet.background.startingAttacks,
    dead: false,
    dying: false,
    deathSaves: { successes: 0, failures: 0 },
  };
}

/* -------------------------------------------------------------------------- */
/* Whole-sheet validation                                                      */
/* -------------------------------------------------------------------------- */

export type SheetValidation = { ok: boolean; errors: string[]; warnings: string[] };

export function validateSheet(sheet: CharacterSheet): SheetValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!sheet.name.trim()) errors.push('the character has no name');
  if (sheet.level < 1) errors.push(`level must be at least 1, got ${sheet.level}`);
  if (![6, 8, 10, 12].includes(sheet.hitDie)) errors.push(`hit die must be d6, d8, d10 or d12, got d${sheet.hitDie}`);

  errors.push(...validateAbilities(sheet.baseAbilities).errors);

  const skills = sheet.background.grantsSkills;
  if (skills.length === 0) warnings.push('the background grants no skills, so the choice carries no weight');

  const skillIds = skills.map((s) => s.id);
  const dupes = skillIds.filter((id, i) => skillIds.indexOf(id) !== i);
  if (dupes.length) errors.push(`duplicate skill ids: ${[...new Set(dupes)].join(', ')}`);

  if (sheet.background.startingAttacks.length === 0) {
    warnings.push('the character has no way to attack');
  }
  if (sheet.language === 'th' && !sheet.voice.selfPronoun) {
    errors.push('a Thai character needs a self-pronoun; register is derived from it');
  }

  return { ok: errors.length === 0, errors, warnings };
}
