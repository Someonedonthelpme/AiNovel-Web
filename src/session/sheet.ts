import type { Ability, Abilities, Attack, Combatant } from '../combat/types.ts';
import { ABILITIES, abilityMod } from '../combat/types.ts';
import type { Inventory } from '../items/types.ts';
import { emptyInventory, equippedArmour, equippedAttack, equippedGrants } from '../items/types.ts';
import { activate } from '../skills/book.ts';
import type { Item } from '../items/types.ts';
import type { ActiveSkill } from '../skills/active.ts';
import type { GraftSpec } from '../play/graft.ts';
import type { Persona, Status } from '../character/persona.ts';
import { emptyPersona, neutralPersonality, restingMind } from '../character/persona.ts';

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

/** Re-exported so existing importers keep working; the type lives in items/. */
export type { Item } from '../items/types.ts';

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

/**
 * A full character sheet: a persona, plus everything needed to fight.
 *
 * The player character is no longer a special shape — this is the same sheet a
 * recruitable NPC carries, which is what makes a companion possible at all.
 */
export type CharacterSheet = Persona & {
  name: string;
  language: 'th' | 'en';
  background: Background;
  /** Base scores before the background's bonuses. */
  baseAbilities: Abilities;
  traits: string[];
  level: number;
  hitDie: number;
  /** Points put into scores on levelling. Separate from the point-buy base so
   *  character creation can still be validated against its own budget. */
  spentAbilities?: Partial<Abilities>;
  /** Unspent points waiting to be assigned. */
  abilityPoints?: number;
  xp?: number;
  /** Passive tree nodes taken, in the order they were taken. */
  allocated?: string[];
  skillPoints?: number;
  /**
   * What the allocated nodes add up to.
   *
   * A denormalisation, and a deliberate one: `derive` is called everywhere and
   * regenerating the tree each time would be wasteful. It is only ever written
   * alongside `allocated`, by `allocate`, so the two cannot drift.
   */
  treeBonuses?: {
    ability: Partial<Abilities>;
    maxHp: number;
    ac: number;
    attack: number;
    damage: number;
  };
  /**
   * What earned traits add up to.
   *
   * Aggregated for the same reason as `treeBonuses`, and for one more: the
   * trait book lives in `play/`, which imports this module. Reading it from
   * here would be a cycle.
   */
  traitBonuses?: Partial<Abilities>;
  /** Signets claimed. Discovery is the hard part; holding one is just a list. */
  signets?: string[];
  /**
   * Actives learned from books, on top of what the background taught.
   *
   * Stored on the sheet rather than derived, because a book read on floor 9 is
   * a thing that happened — it cannot be recomputed from anything else.
   */
  learned?: ActiveSkill[];
  /**
   * What the player chose to BE.
   *
   * Optional because every session made before classes existed has none, and
   * those fall back to inferring a discipline from the background as they
   * always did. The class carries the mechanics — hit die, starting attack,
   * which disciplines the tree may hold — while the model keeps the flavour.
   */
  classId?: string;
  /** Chosen at level 3. Opens an island into somewhere the class cannot go. */
  subclassId?: string;
  /**
   * Books read, in the order they were read.
   *
   * The shelf, not the pile. Each carries the set it grew, so the tree can be
   * rebuilt from the sheet alone — and each records what had to be read first,
   * because a chain is only a chain if the game remembers the order.
   */
  library?: ReadBook[];
};

/** One book, absorbed. */
export type ReadBook = {
  bookId: string;
  name: string;
  /** The branch reading it grew. Kept here so the tree needs no item lookup. */
  set: GraftSpec;
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

/**
 * Base scores, plus the background, plus points spent on levelling, plus
 * anything worn.
 *
 * Traits gate on the TOTAL, so everything that moves a score has to land here
 * or a condition like "str 20+" would read a number the player never sees.
 */
export function finalAbilities(sheet: CharacterSheet, inventory?: Inventory): Abilities {
  const worn = inventory ? equippedGrants(inventory) : {};
  const out = { ...sheet.baseAbilities };
  for (const ability of ABILITIES) {
    out[ability] =
      out[ability]
      + (sheet.background.grantsStats[ability] ?? 0)
      + (sheet.spentAbilities?.[ability] ?? 0)
      + (sheet.treeBonuses?.ability[ability] ?? 0)
      + (sheet.traitBonuses?.[ability] ?? 0)
      + (worn[ability] ?? 0);
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
export function maxHpFor(sheet: CharacterSheet, inventory?: Inventory): number {
  const con = abilityMod(finalAbilities(sheet, inventory).con);
  const perLevel = Math.floor(sheet.hitDie / 2) + 1;
  const level = Math.max(1, sheet.level);
  const fromTree = sheet.treeBonuses?.maxHp ?? 0;
  return Math.max(1, sheet.hitDie + con + (level - 1) * (perLevel + con) + fromTree);
}

/** Worn armour sets the base; without it you are as hard to hit as you are quick. */
export function armourClassFor(sheet: CharacterSheet, inventory?: Inventory): number {
  const base = inventory ? equippedArmour(inventory) : null;
  return (base ?? 10) + abilityMod(finalAbilities(sheet, inventory).dex) + (sheet.treeBonuses?.ac ?? 0);
}

export type DerivedSheet = {
  abilities: Abilities;
  maxHp: number;
  ac: number;
  proficiency: number;
  speed: number;
  skills: Skill[];
};

/**
 * Every active skill a character can use.
 *
 * The background's are promoted from what the model named; the rest were read
 * out of books. One list, because nothing downstream should care where a skill
 * came from.
 */
export function activeSkills(sheet: CharacterSheet): ActiveSkill[] {
  return [...sheet.background.grantsSkills.map(activate), ...(sheet.learned ?? [])];
}

export function derive(sheet: CharacterSheet, inventory: Inventory = emptyInventory()): DerivedSheet {
  return {
    abilities: finalAbilities(sheet, inventory),
    maxHp: maxHpFor(sheet, inventory),
    ac: armourClassFor(sheet, inventory),
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
export function toCombatant(sheet: CharacterSheet, id = 'pc', inventory: Inventory = emptyInventory()): Combatant {
  const d = derive(sheet, inventory);
  // A wielded weapon replaces the background's bare hands. Without this, loot
  // could never change how a fight goes, which is most of the point of loot.
  const wielded = equippedAttack(inventory);
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
    attacks: wielded ? [wielded] : sheet.background.startingAttacks,
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
  if (sheet.language === 'th' && !sheet.voice.underStress) {
    warnings.push('no stressed pronoun: this character will sound the same when terrified');
  }

  return { ok: errors.length === 0, errors, warnings };
}
