import type { Ability, Abilities, Attack, Combatant } from '../combat/types.ts';
import { STANDARD } from '../rules/ruleset.ts';
import type { Ruleset } from '../rules/ruleset.ts';
import { metNeeds, unmet } from '../character/persona.ts';
import { ABILITIES, abilityMod } from '../combat/types.ts';
import type { Inventory } from '../items/types.ts';
import { carriedWeight, emptyInventory, equippedArmour, equippedAttack, equippedGrants, equippedHoldings } from '../items/types.ts';
import { activate } from '../skills/book.ts';
import type { Item } from '../items/types.ts';
import type { ActiveSkill } from '../skills/active.ts';
import type { GraftSpec } from '../play/graft.ts';
import type { CharacterClass } from '../character/classes.ts';
import type { Persona, Status } from '../character/persona.ts';

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

export type Skill = {
  id: string;
  /** Generated in the play language, so a Thai character gets Thai skill names. */
  name: string;
  description: string;
  ability: Ability;
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
    maxStamina: number;
    maxMana: number;
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
  /**
   * The body their kind gave them, copied from the world's species at creation.
   *
   * A layer rather than folded into `baseAbilities`, which point buy bounds to
   * 8–15. Copied because `finalAbilities` never sees the world — the same reason
   * `background.grantsStats` lives here. Absent on a climber made before types.
   */
  speciesTemplate?: Partial<Abilities>;
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
  /**
   * THE RESOLVED CLASS, carried rather than looked up.
   *
   * Classes are generated per world now, so `classId` alone no longer names
   * anything globally — resolving it would mean regenerating that world's
   * roster everywhere the class is needed, and any change to the generator
   * would silently rewrite what a character IS mid-run. Worse, it would orphan
   * them outright the way an id pointing at a vanished trait does.
   *
   * So the class a character chose travels WITH them, exactly like `learned`
   * books and for the same reason: it is a thing that happened, not a thing to
   * recompute. Absent on every session made before generated classes, and
   * those fall back to looking `classId` up among the authored eight.
   */
  classSpec?: CharacterClass;
  /** Chosen at level 3. Opens an island — out of the class, or deeper into it. */
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

/**
 * Forty, not twenty-seven.
 *
 * Twenty-seven across six stats bought a character with two strong scores and
 * four passable ones. Across NINE it buys a character who is thin everywhere,
 * and every stat past the second becomes a dump stat — which is fatal now that
 * the stat is what decides which skills a character can even reach.
 *
 * Forty is a starting number and expects to move with playtesting.
 */
export const POINT_BUY_BUDGET = 40;
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
  // 4x5 + 5x4 = 40, exactly the budget. Leaving points unspent would quietly
  // hand out a worse character than the rules allow.
  return { str: 13, dex: 13, con: 12, agi: 12, vit: 13, int: 12, wis: 13, cha: 12, luk: 12 };
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
      + (sheet.speciesTemplate?.[ability] ?? 0)
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
  /*
   * VIT carries the body now, not CON and not a class hit die.
   *
   * The die is gone because classes no longer hand one out — and CON is
   * deliberately not here either: it is the mind holding on, and giving it hit
   * points as well would put it straight back into the fight with VIT that the
   * split exists to end.
   *
   * The shape is the old fixed progression, so the curve `scripts/fight.ts`
   * measures does not move further than the stat change alone forces: a solid
   * first level, then a steady climb that one unlucky number cannot ruin.
   */
  const vit = abilityMod(finalAbilities(sheet, inventory).vit);
  const level = Math.max(1, sheet.level);
  const fromTree = sheet.treeBonuses?.maxHp ?? 0;
  return Math.max(1, HP_AT_FIRST + vit + (level - 1) * (HP_PER_LEVEL + vit) + fromTree);
}

/** What a body is worth before VIT says anything. Was the class hit die. */
export const HP_AT_FIRST = 10;
export const HP_PER_LEVEL = 6;

/* -------------------------------------------------------------------------- */
/* The two pools                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Stamina and mana, which replaced per-skill uses.
 *
 * Uses were a weak lever. Every skill carried its own four, independent of
 * every other, so a character with ten skills had forty of them and no
 * scarcity at all — and the count came from the SOURCE's budget, meaning a
 * deep book handed the same four to an INT-8 reader as to an INT-18 one. The
 * stat gated what you could do and said nothing about how long you could keep
 * doing it.
 *
 * Two shared pools fix both. The spread decides the ceiling, and spending is a
 * decision between skills rather than a per-skill allowance.
 *
 *   STAMINA  the body exerting itself   from VIT
 *   MANA     the mind concentrating     from CON
 *
 * Which pool a skill draws on follows its STAT, not its payload — see
 * `poolFor` in skills/pools.ts. One rule, and it makes the physical and mental
 * halves of the stat sheet structural rather than thematic.
 */
export const BASE_SPEED = STANDARD.body.baseSpeed;
/** Nobody is rooted to the spot by being quick or slow alone. */
export const MIN_SPEED = STANDARD.body.minSpeed;

/*
 * CARRYING, which STR has claimed since the nine stats were written and which
 * did not exist. Durability, repair kits and materials all assume that hauling
 * things has a cost; without a capacity there is nothing for them to press on.
 *
 * Capacity comes off the SCORE rather than the modifier: carrying is the one
 * place where being a little stronger should help a little, rather than only
 * mattering every second point.
 */
export const CARRY_BASE = STANDARD.body.carryBase;
export const CARRY_PER_STR = STANDARD.body.carryPerStr;
/** How much overload costs a square of movement. */
export const OVERLOAD_STEP = STANDARD.body.overloadStep;
export const POOL_BASE = 8;
export const POOL_PER_LEVEL = 2;

/**
 * UNMET NEEDS DOCK THE CEILING.
 *
 * `sheet.mental` existed all along and gated nothing: drift wrote it, rest
 * eased it, the model read it aloud, and no rule anywhere consulted it. Needs
 * inherit that job and straighten out which need feeds which pool — stamina is
 * the body, so it is worn down by going UNRESTED; mana is the mind, so it is
 * worn down by feeling UNSAFE. The old pairing had stress docking stamina and
 * fatigue docking mana, which was crossed.
 */
export function maxStaminaFor(sheet: CharacterSheet, inventory?: Inventory): number {
  const vit = abilityMod(finalAbilities(sheet, inventory).vit);
  const level = Math.max(1, sheet.level);
  const worn = Math.floor(unmet(sheet.needs ?? metNeeds(), 'rest') / 2);
  const granted = sheet.treeBonuses?.maxStamina ?? 0;
  return Math.max(1, POOL_BASE + vit * 2 + (level - 1) * POOL_PER_LEVEL - worn + granted);
}

export function maxManaFor(sheet: CharacterSheet, inventory?: Inventory): number {
  const con = abilityMod(finalAbilities(sheet, inventory).con);
  const level = Math.max(1, sheet.level);
  const worn = Math.floor(unmet(sheet.needs ?? metNeeds(), 'safety') / 2);
  const granted = sheet.treeBonuses?.maxMana ?? 0;
  return Math.max(1, POOL_BASE + con * 2 + (level - 1) * POOL_PER_LEVEL - worn + granted);
}

/**
 * Worn armour sets the base; without it you are as hard to hit as you are quick.
 *
 * AC READS AGI, NOT DEX, and that is a correction. The nine-stat split gives
 * DEX accuracy — it decides whether YOUR blow lands — and AGI evasion, which
 * decides whether THEIRS does. AC was reading DEX, so a steady-handed archer
 * was also hard to hit and AGI bought nothing but tick cost. Not being hit is
 * the whole of what AGI is for.
 *
 * Soaking a hit is a different claim from dodging it, and that one is VIT's —
 * see `damageReduction` in resolve.ts.
 */
export function armourClassFor(sheet: CharacterSheet, inventory?: Inventory): number {
  const base = inventory ? equippedArmour(inventory) : null;
  return (base ?? 10) + abilityMod(finalAbilities(sheet, inventory).agi) + (sheet.treeBonuses?.ac ?? 0);
}

export type DerivedSheet = {
  abilities: Abilities;
  maxHp: number;
  maxStamina: number;
  maxMana: number;
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

/**
 * What you can carry: your back, and whatever is on it.
 *
 * This used to be `carryBase + STR` and nothing else, which made capacity a
 * fact about your body — a pack was not a thing you could find, fill or lose.
 * A worn container raises the ceiling, so the first good bag is loot worth
 * having and losing it is felt.
 */
export function carryCapacityFor(
  sheet: CharacterSheet, inventory?: Inventory, rules: Ruleset = STANDARD,
): number {
  const own = rules.body.carryBase + finalAbilities(sheet, inventory).str * rules.body.carryPerStr;
  if (!inventory) return own;
  return own + equippedHoldings(inventory).reduce((extra, h) => extra + (h.item.capacity ?? 0), 0);
}

/**
 * How far past what you can carry you are, in squares of lost movement.
 *
 * Nought while you are within capacity. Deliberately NOT a hard block on
 * picking things up: loot you cannot carry is loot you resent, and the honest
 * cost of hauling a hoard up a tower is that you move like somebody hauling a
 * hoard up a tower.
 */
export function overloadFor(
  sheet: CharacterSheet, inventory?: Inventory, rules: Ruleset = STANDARD,
): number {
  if (!inventory) return 0;
  const over = carriedWeight(inventory) - carryCapacityFor(sheet, inventory, rules);
  return over <= 0 ? 0 : Math.ceil(over / rules.body.overloadStep);
}

export function speedFor(
  sheet: CharacterSheet, inventory?: Inventory, rules: Ruleset = STANDARD,
): number {
  const quick = rules.body.baseSpeed + abilityMod(finalAbilities(sheet, inventory).agi);
  const load = overloadFor(sheet, inventory, rules);
  return load > 0 ? Math.max(1, quick - load) : Math.max(rules.body.minSpeed, quick);
}

export function derive(sheet: CharacterSheet, inventory: Inventory = emptyInventory()): DerivedSheet {
  const abilities = finalAbilities(sheet, inventory);
  return {
    abilities,
    maxHp: maxHpFor(sheet, inventory),
    maxStamina: maxStaminaFor(sheet, inventory),
    maxMana: maxManaFor(sheet, inventory),
    ac: armourClassFor(sheet, inventory),
    proficiency: proficiencyFor(sheet.level),
    // Quick people cover more ground. `speed` was a hardcoded 6 derived from
    // nothing, which left AGI paying for tick cost alone. An overloaded pack
    // can drag it below the ordinary floor — you can still shuffle.
    speed: speedFor(sheet, inventory),
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
    stamina: d.maxStamina,
    maxStamina: d.maxStamina,
    mana: d.maxMana,
    maxMana: d.maxMana,
    ticks: 6,
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
