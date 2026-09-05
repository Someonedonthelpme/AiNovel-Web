import { counterOf } from '../character/persona.ts';
import { dispositionOf } from '../character/persona.ts';
import type { Axis, Counters, Personality } from '../character/persona.ts';
import type { Ability } from '../combat/types.ts';
import type { GraftSpec } from './graft.ts';
import type { Inventory } from '../items/types.ts';
import { countOf } from '../items/types.ts';
import type { CharacterSheet } from '../session/sheet.ts';
import { derive } from '../session/sheet.ts';

/**
 * Traits: what a character becomes by doing.
 *
 * The second branch of the skill system. A trait is not bought — it arrives
 * when a condition over what you ARE and what you have DONE comes true, which
 * is why counters exist at all.
 *
 * Evaluated by the engine inside the fold, never by the model, so a replayed
 * log unlocks exactly the same traits in the same order.
 */

export type TraitCondition =
  | { kind: 'ability'; ability: Ability; atLeast: number }
  | { kind: 'counter'; counter: string; atLeast: number }
  | { kind: 'personality'; axis: Axis; atLeast?: number; atMost?: number }
  | { kind: 'level'; atLeast: number }
  | { kind: 'carries'; item: string; atLeast: number }
  /**
   * A SHAPE in the tallies rather than a threshold in one of them.
   *
   * This is what an emergent trait is made of. Every other condition is a
   * goal — a number you can be shown and walk toward. A shape is a RATIO or an
   * EXTREME, and it can only ever be a recognition: nothing can foreshadow
   * "you have killed more people than you have spoken to", because the moment
   * it could be displayed as a target it would stop being true of you and
   * start being a thing you were aiming at.
   */
  | { kind: 'shape'; shape: string };

export type Trait = {
  id: string;
  name: string;
  description: string;
  /** ALL of these must hold. An OR is expressed as two traits. */
  requires: TraitCondition[];
  /** What it does. Passive, and resolved by code like everything else. */
  grants?: { ability?: Partial<Record<Ability, number>>; note?: string };
  /**
   * A branch this trait grows on the tree when it is earned.
   *
   * Not every trait has one — a tree that sprouted on every tally would be
   * noise. The ones that do are the traits that mark a change in what you are
   * capable of rather than merely what you have done.
   */
  opens?: GraftSpec;
};

/* -------------------------------------------------------------------------- */
/* The counters traits read                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Names used in more than one place.
 *
 * A trait gating on a counter nobody increments is a trait nobody can ever
 * earn, and the bug is invisible — so the names live here rather than as
 * scattered string literals.
 */
export const COUNTERS = {
  kills: 'kills',
  fightsWon: 'fights_won',
  fightsLost: 'fights_lost',
  floorsClimbed: 'floors_climbed',
  deepestFloor: 'deepest_floor',
  shortRests: 'short_rests',
  longRests: 'long_rests',
  itemsUsed: 'items_used',
  placesFound: 'places_found',
  peopleMet: 'people_met',
} as const;

/**
 * The counters something in the engine actually writes.
 *
 * Not the same claim as `COUNTERS`, and the difference has already cost us:
 * `people_met` sat in the registry with nothing incrementing it, so the trait
 * gating on it was unearnable in every world ever generated — and the Signet
 * proof treated it as satisfiable, because a registry proves a NAME exists, not
 * that anything moves it.
 *
 * This list is the claim that each one has a writer, and
 * `counters.test.ts` makes the engine demonstrate every entry rather than
 * taking the declaration on trust. Generation makes the distinction urgent: a
 * themed trait drawing a dead counter would be silently unearnable, differently
 * in every world.
 */
export const WRITTEN_COUNTERS: readonly string[] = [
  COUNTERS.kills,
  COUNTERS.fightsWon,
  COUNTERS.fightsLost,
  COUNTERS.floorsClimbed,
  COUNTERS.deepestFloor,
  COUNTERS.shortRests,
  COUNTERS.longRests,
  COUNTERS.itemsUsed,
  COUNTERS.placesFound,
  COUNTERS.peopleMet,
];

/* -------------------------------------------------------------------------- */
/* Shapes: what the tallies say about you sideways                             */
/* -------------------------------------------------------------------------- */

/**
 * A shape in the counters.
 *
 * Deliberately NOT a threshold. "Thirty kills" is a goal and belongs in the
 * declared catalogue, where the panel can show progress toward it. These are
 * relations — a ratio between two tallies, or one at an extreme while another
 * sits at nothing — and they describe how somebody played rather than what
 * they set out to do.
 *
 * Each carries a floor as well as its relation, because a ratio over small
 * numbers is noise: two kills and no conversations is a Tuesday, not a
 * character. The floor is what makes the recognition mean something.
 *
 * The predicates live here beside `conditionMet` rather than in the generator,
 * so there is exactly one place that knows how a shape is TESTED. The
 * generator's business is naming and dressing them.
 */
export type Shape = {
  id: string;
  /** True when the shape holds. `n` reads a counter; `level` is the character's. */
  holds: (n: (counter: string) => number, level: number) => boolean;
};

export const SHAPES: readonly Shape[] = [
  {
    // Killed far more than you have talked to.
    id: 'unspeaking',
    holds: (n) => n(COUNTERS.kills) >= 15 && n(COUNTERS.kills) > n(COUNTERS.peopleMet) * 3,
  },
  {
    // Deep into the tower without ever having slept properly.
    id: 'sleepless',
    holds: (n) => n(COUNTERS.deepestFloor) >= 5 && n(COUNTERS.longRests) === 0,
  },
  {
    // Beaten repeatedly, and winning anyway.
    id: 'stubborn',
    holds: (n) => n(COUNTERS.fightsLost) >= 3 && n(COUNTERS.fightsWon) > n(COUNTERS.fightsLost) * 2,
  },
  {
    // Losing more than winning, and still climbing.
    id: 'ground_down',
    holds: (n) => n(COUNTERS.fightsLost) >= 4 && n(COUNTERS.fightsLost) >= n(COUNTERS.fightsWon),
  },
  {
    // Carrying everything and using none of it.
    id: 'hoarder',
    holds: (n) => n(COUNTERS.placesFound) >= 20 && n(COUNTERS.itemsUsed) * 5 <= n(COUNTERS.placesFound),
  },
  {
    // Spending faster than you fight.
    id: 'spendthrift',
    holds: (n) => n(COUNTERS.itemsUsed) >= 25 && n(COUNTERS.itemsUsed) > n(COUNTERS.kills),
  },
  {
    // Climbing faster than you rest.
    id: 'headlong',
    holds: (n) => n(COUNTERS.floorsClimbed) >= 8 && n(COUNTERS.floorsClimbed) > n(COUNTERS.shortRests),
  },
  {
    // Known widely, and hardly killing at all.
    id: 'unbloodied',
    holds: (n) => n(COUNTERS.peopleMet) >= 12 && n(COUNTERS.kills) * 2 <= n(COUNTERS.peopleMet),
  },
  {
    // Deep for how young you are.
    id: 'out_of_depth',
    holds: (n, level) => n(COUNTERS.deepestFloor) >= 6 && n(COUNTERS.deepestFloor) > level,
  },
];

export const shapeById = (id: string): Shape | null => SHAPES.find((s) => s.id === id) ?? null;

/* -------------------------------------------------------------------------- */
/* Evaluating                                                                  */
/* -------------------------------------------------------------------------- */

export type TraitContext = {
  sheet: CharacterSheet;
  inventory: Inventory;
  counters: Counters;
  personality: Personality;
};

export function conditionMet(condition: TraitCondition, ctx: TraitContext): boolean {
  switch (condition.kind) {
    case 'ability':
      return derive(ctx.sheet, ctx.inventory).abilities[condition.ability] >= condition.atLeast;
    case 'counter':
      return counterOf(ctx.counters, condition.counter) >= condition.atLeast;
    case 'personality': {
      const value = ctx.personality[condition.axis];
      if (condition.atLeast !== undefined && value < condition.atLeast) return false;
      if (condition.atMost !== undefined && value > condition.atMost) return false;
      return true;
    }
    case 'level':
      return Math.max(1, ctx.sheet.level) >= condition.atLeast;
    case 'carries':
      return countOf(ctx.inventory, condition.item) >= condition.atLeast;
    case 'shape': {
      const shape = shapeById(condition.shape);
      // An unknown shape is FALSE, not a crash. A save written before a shape
      // existed must still fold, and a trait nobody can earn is better than a
      // session that will not load.
      return shape ? shape.holds((c) => counterOf(ctx.counters, c), Math.max(1, ctx.sheet.level)) : false;
    }
  }
}

export const traitMet = (trait: Trait, ctx: TraitContext): boolean =>
  trait.requires.every((c) => conditionMet(c, ctx));

/**
 * How close a trait is, for the panel.
 *
 * Progress is shown per condition rather than as one percentage, because "kill
 * 30 things" and "have 20 strength" do not average into anything meaningful.
 */
export type ConditionProgress = { condition: TraitCondition; met: boolean; have: number; need: number; label: string };

export function progressOf(trait: Trait, ctx: TraitContext): ConditionProgress[] {
  return trait.requires.map((condition) => {
    const met = conditionMet(condition, ctx);
    switch (condition.kind) {
      case 'ability':
        return { condition, met, have: derive(ctx.sheet, ctx.inventory).abilities[condition.ability], need: condition.atLeast, label: `${condition.ability} ${condition.atLeast}+` };
      case 'counter':
        return { condition, met, have: counterOf(ctx.counters, condition.counter), need: condition.atLeast, label: `${condition.counter.replace(/_/g, ' ')} ${condition.atLeast}` };
      case 'personality':
        return { condition, met, have: ctx.personality[condition.axis], need: condition.atLeast ?? condition.atMost ?? 0, label: describeAxis(condition) };
      case 'level':
        return { condition, met, have: Math.max(1, ctx.sheet.level), need: condition.atLeast, label: `level ${condition.atLeast}` };
      case 'shape':
        /*
         * No numbers, deliberately.
         *
         * A shape has no progress to show, and giving it one would destroy the
         * thing it is. The moment "you have killed more than you have spoken
         * to" appears in the panel as 18/24, it stops being a recognition of
         * how somebody played and becomes a target they are aiming at — and
         * the aiming is precisely what it claims they did not do.
         */
        return { condition, met, have: met ? 1 : 0, need: 1, label: '' };
      case 'carries':
        return { condition, met, have: countOf(ctx.inventory, condition.item), need: condition.atLeast, label: `carry ${condition.atLeast}` };
    }
  });
}

const describeAxis = (c: Extract<TraitCondition, { kind: 'personality' }>): string =>
  c.atLeast !== undefined ? `${c.axis} ${c.atLeast}+` : `${c.axis} ${c.atMost} or less`;

/**
 * Everything newly earned this turn.
 *
 * Returns only what is NEW, so the caller can narrate an unlock once rather
 * than every turn after it.
 */
export function newlyEarned(catalogue: readonly Trait[], held: readonly string[], ctx: TraitContext): Trait[] {
  const has = new Set(held);
  return catalogue.filter((t) => !has.has(t.id) && traitMet(t, ctx));
}

/* -------------------------------------------------------------------------- */
/* Awarding                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * What the held traits are worth, summed.
 *
 * Kept alongside the trait list on the sheet rather than recomputed inside
 * `derive`, because the trait book lives here and `derive` lives in the module
 * this one imports.
 */
export function traitBonusesOf(catalogue: readonly Trait[], held: readonly string[]): Partial<Record<Ability, number>> {
  const has = new Set(held);
  const total: Partial<Record<Ability, number>> = {};

  for (const trait of catalogue) {
    if (!has.has(trait.id)) continue;
    for (const [ability, bonus] of Object.entries(trait.grants?.ability ?? {})) {
      const key = ability as Ability;
      total[key] = (total[key] ?? 0) + (bonus ?? 0);
    }
  }
  return total;
}

export type TraitAward = { sheet: CharacterSheet; earned: Trait[] };

/**
 * Check every trait and take the ones that have come true.
 *
 * Called once per turn inside the fold, so replaying a log earns the same
 * traits in the same order. Returns what is NEW so the caller can announce an
 * unlock once rather than every turn afterwards.
 */
export function awardTraits(
  catalogue: readonly Trait[],
  sheet: CharacterSheet,
  inventory: Inventory,
): TraitAward {
  const ctx: TraitContext = {
    sheet,
    inventory,
    counters: sheet.counters,
    personality: dispositionOf(sheet),
  };

  const earned = newlyEarned(catalogue, sheet.traits, ctx);
  if (earned.length === 0) return { sheet, earned: [] };

  const traits = [...sheet.traits, ...earned.map((t) => t.id)];
  return {
    sheet: { ...sheet, traits, traitBonuses: traitBonusesOf(catalogue, traits) },
    earned,
  };
}
