import { mulberry32 } from '../engine/roll.ts';
import type { Ability } from '../combat/types.ts';
import { instanceOf, PRISTINE, RARITIES } from './instance.ts';
import type { ItemInstance, Rarity } from './instance.ts';

/**
 * Making a thing better, three ways, and the trade between them.
 *
 * `ItemInstance.refine`, `.enchants` and `.rarity` have been stored since
 * instances existed and read by nobody. This is what they are for.
 *
 *   REFINE   a level on the object. Every level is worth something slightly
 *            different — the RO reading — and what it is worth is fixed by the
 *            object, so refining this axe to +4 always gives these numbers.
 *   ENCHANT  bought at refine MILESTONES: a named option, from a closed list.
 *   ENHANCE  raises RARITY, grants something lasting, AND RESETS BOTH OF THE
 *            ABOVE.
 *
 * THE RESET IS THE WHOLE DESIGN. Enhancing is a rebirth: you trade everything
 * you put into a thing for a rarity and a new power. That makes WHEN to enhance
 * a real decision, rather than enhance being one more upgrade you take the
 * moment you can afford it — which is what every straight-line upgrade path
 * turns into.
 *
 * Everything here is deterministic from the object's own id, never from the
 * world seed or a live roll. A refine that came out differently on replay would
 * break the fold; one that came out differently after an enhance reset would
 * mean re-rolling until you liked it.
 */

export type Bonus = {
  /** Ability grants, folded in with everything else a worn thing gives. */
  ability: Partial<Record<Ability, number>>;
  /** Armour, on top of what the suit itself sets. */
  armour: number;
};

const NOTHING: Bonus = { ability: {}, armour: 0 };

const add = (a: Bonus, b: Bonus): Bonus => {
  const ability = { ...a.ability };
  for (const [k, v] of Object.entries(b.ability)) {
    ability[k as Ability] = (ability[k as Ability] ?? 0) + (v ?? 0);
  }
  return { ability, armour: a.armour + b.armour };
};

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/* -------------------------------------------------------------------------- */
/* Refine                                                                      */
/* -------------------------------------------------------------------------- */

/** Which score a refine level happens to sharpen. */
const REFINE_STATS: Ability[] = ['str', 'dex', 'agi', 'vit', 'int', 'wis', 'luk'];

/**
 * What ONE level is worth on this particular object.
 *
 * Seeded from the instance and the level, so it is the same every time it is
 * asked — on a replay, and again after an enhance has reset the object back to
 * nothing. Without that second property, enhancing would be a way to re-roll a
 * disappointing refine, and nobody would ever keep a bad one.
 */
export function stepOf(instanceId: string, level: number): Bonus {
  const rng = mulberry32(hash(`${instanceId}|refine|${level}`));
  // Most levels sharpen a score; some thicken the thing instead.
  if (rng() < 0.3) return { ability: {}, armour: 1 };
  return { ability: { [REFINE_STATS[Math.floor(rng() * REFINE_STATS.length)]]: 1 }, armour: 0 };
}

/** Everything the levels so far add up to. */
export function refineBonus(instanceId: string, level: number): Bonus {
  let total = NOTHING;
  for (let at = 1; at <= Math.max(0, level); at++) total = add(total, stepOf(instanceId, at));
  return total;
}

/* -------------------------------------------------------------------------- */
/* Enchant                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The options a milestone buys.
 *
 * Closed, and each is a plain bonus rather than a special rule, because an
 * enchantment nothing reads would be a word on a sheet — which is what these
 * fields already were.
 */
export const ENCHANTS: Record<string, Bonus> = {
  keen: { ability: { dex: 1 }, armour: 0 },
  heavy: { ability: { str: 1 }, armour: 0 },
  quick: { ability: { agi: 1 }, armour: 0 },
  true: { ability: { wis: 1 }, armour: 0 },
  warded: { ability: {}, armour: 2 },
  lucky: { ability: { luk: 1 }, armour: 0 },
};

export const ENCHANT_NAMES = Object.keys(ENCHANTS);

/** A milestone every this many levels; only then may an option be bought. */
export const ENCHANT_EVERY = 4;

/** How many options this object has EARNED, whether or not they are taken. */
export const milestonesAt = (level: number): number => Math.floor(Math.max(0, level) / ENCHANT_EVERY);

/** Whether there is a milestone going spare right now. */
export const canEnchant = (inst: ItemInstance): boolean =>
  milestonesAt(inst.refine ?? 0) > (inst.enchants?.length ?? 0);

/* -------------------------------------------------------------------------- */
/* Enhance                                                                     */
/* -------------------------------------------------------------------------- */

export const nextRarity = (rarity: Rarity | undefined): Rarity | null => {
  const at = RARITIES.indexOf(rarity ?? 'common');
  return at >= 0 && at < RARITIES.length - 1 ? RARITIES[at + 1] : null;
};

/**
 * What a rarity is worth, on this object.
 *
 * Keyed on the object and the rarity, so the thing you traded your refine
 * levels for is a fixed property of what you were holding rather than a fresh
 * roll — you are told what you get, and the decision is whether it is worth it.
 */
export function rarityBonus(instanceId: string, rarity: Rarity | undefined): Bonus {
  const at = RARITIES.indexOf(rarity ?? 'common');
  if (at <= 0) return NOTHING;

  let total = NOTHING;
  for (let step = 1; step <= at; step++) {
    const rng = mulberry32(hash(`${instanceId}|rarity|${RARITIES[step]}`));
    total = add(total, rng() < 0.35
      ? { ability: {}, armour: 2 }
      : { ability: { [REFINE_STATS[Math.floor(rng() * REFINE_STATS.length)]]: 2 }, armour: 0 });
  }
  return total;
}

/* -------------------------------------------------------------------------- */
/* What a thing is worth, all in                                               */
/* -------------------------------------------------------------------------- */

/**
 * Everything the three of them add up to on one object.
 *
 * ONE READER for all three, which is what keeps them from each needing their
 * own plumbing into combat: they are folded in wherever a worn thing's grants
 * and armour are already asked for.
 */
export function bonusOf(inst: ItemInstance): Bonus {
  let total = add(refineBonus(inst.id, inst.refine ?? 0), rarityBonus(inst.id, inst.rarity));
  for (const name of inst.enchants ?? []) total = add(total, ENCHANTS[name] ?? NOTHING);
  return total;
}

/* -------------------------------------------------------------------------- */
/* Doing it                                                                    */
/* -------------------------------------------------------------------------- */

/** What the next level, the next option and the next rarity cost. */
export const refineCost = (level: number): number => 20 + level * 15;
export const enchantCost = (taken: number): number => 60 + taken * 40;
export const enhanceCost = (rarity: Rarity | undefined): number =>
  120 * (RARITIES.indexOf(rarity ?? 'common') + 1);

/**
 * What came of trying.
 *
 * `attempted` is the load-bearing field, and separating it from `item` is what
 * keeps three different things apart: a REFUSAL costs nothing and is an error
 * ("it will take no more"); a FAILURE happened, cost the fee, and may have left
 * the thing worse; and DESTRUCTION happened and left no thing at all. Reading
 * those three off `item === null` alone would let a refused attempt charge you
 * and a destroyed object survive.
 */
export type Attempt = {
  /** The object after. Null means it is GONE, not that nothing happened. */
  item: ItemInstance | null;
  /** Whether it was tried at all. False is a refusal, and free. */
  attempted: boolean;
  note: string;
};

export type RefineRules = { maxRefine: number; refineRisk: number; refineLoss: number };

/**
 * Try to raise a refine level.
 *
 * FAILURE IS TWO NUMBERS RATHER THAN A MODE, so there is one code path and no
 * switch on a rule. `refineRisk` at nought never fails, which is Genshin; a
 * `refineLoss` of nought is a stall where the fee is gone and the object is
 * untouched; one level lost is the middle case; and a loss larger than the
 * ceiling destroys the thing outright, which is what RO does.
 *
 * The roll is seeded from the object and the attempt, so a replay refines and
 * fails in exactly the same places.
 */
export function refine(inst: ItemInstance, rules: RefineRules): Attempt {
  const level = inst.refine ?? 0;
  if (level >= rules.maxRefine) return { item: inst, attempted: false, note: 'it will take no more' };

  /*
   * SEEDED ON THE ATTEMPT, not on the level.
   *
   * Keying the roll to `(object, level)` alone gave the same input the same
   * answer for ever, so a level that failed once could never be passed — an
   * object sat at +2 through two dozen attempts and every coin spent on it.
   * Counting tries keeps the replay exact while making each try its own.
   */
  const tries = (inst.tries ?? 0) + 1;
  const rng = mulberry32(hash(`${inst.id}|attempt|${tries}`));
  const paid = { ...inst, tries };

  if (rng() >= rules.refineRisk) {
    return { item: { ...paid, refine: level + 1 }, attempted: true, note: `refined to +${level + 1}` };
  }

  if (rules.refineLoss > rules.maxRefine) {
    return { item: null, attempted: true, note: 'it came apart in your hands' };
  }

  const lost = Math.min(level, rules.refineLoss);
  return {
    item: { ...paid, refine: level - lost },
    attempted: true,
    note: lost === 0 ? 'nothing took, and the fee is gone' : `it slipped back to +${level - lost}`,
  };
}

/** Buy one of the options a milestone earned. */
export function enchant(inst: ItemInstance, name: string): Attempt {
  const no = (note: string): Attempt => ({ item: inst, attempted: false, note });
  if (!ENCHANTS[name]) return no('no such working');
  if (!canEnchant(inst)) return no('it has earned no working yet');
  if ((inst.enchants ?? []).includes(name)) return no('it already carries that');

  return {
    item: { ...inst, enchants: [...(inst.enchants ?? []), name] },
    attempted: true,
    note: `${name}, worked in`,
  };
}

/**
 * Raise the rarity, AND THROW AWAY EVERYTHING THAT WAS PUT IN.
 *
 * The reset is not a penalty bolted on to make enhancing costly. It is what
 * makes enhancing a decision: a +9 blade with two workings on it is a real
 * thing to give up, and the question of whether the rarity is worth more than
 * what you already have is the only interesting question an upgrade path can
 * ask.
 *
 * Wear is kept. Rebirth is not repair.
 */
export function enhance(inst: ItemInstance): Attempt {
  const next = nextRarity(inst.rarity);
  if (!next) return { item: inst, attempted: false, note: 'nothing is finer than this' };

  return {
    item: { ...inst, rarity: next, refine: 0, enchants: [] },
    attempted: true,
    note: `${next} now — and everything it carried is gone`,
  };
}

/** A pristine copy at a given rarity, for tests and for generated finds. */
export const at = (id: string, typeId: string, rarity: Rarity): ItemInstance =>
  ({ ...instanceOf(id, typeId), rarity, condition: PRISTINE });
