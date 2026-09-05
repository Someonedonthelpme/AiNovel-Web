import { TEMPER_MAX } from '../character/persona.ts';
import type { Temperament, TemperamentAxis } from '../character/persona.ts';
import { purposes } from './effect.ts';
import type { Effect } from './effect.ts';

/**
 * Whether an action SUITS the person taking it.
 *
 * The join between the two halves of this work: temperament is stored, skills
 * are built from components, and this is what makes the first bear on the
 * second. A bold person throws a bigger blow for less; a cautious one throwing
 * the same blow pays more for a smaller one.
 *
 * TWO PROPERTIES MATTER, and they are what make this a mechanism rather than a
 * bonus.
 *
 * IT IS DERIVED FROM THE COMPONENTS. Nothing is authored per skill, so every
 * generated skill gets a suitability free and none can be authored wrong — the
 * same argument that put the grammar on the stat rather than on the skill.
 *
 * IT IS SIGNED, AND ONE BUDGET. A mismatched action is costlier AND weaker AND
 * slower, all from the same number. That needs no upside cap, because mismatches
 * are what pay for matches: a character who only ever does what suits them is
 * spending the budget they built, not finding free power. It is what turns
 * personality into a build constraint instead of a decoration.
 */

/**
 * Which axis each component leans on, and how hard.
 *
 * Deliberately short. Every entry has to be defensible as "somebody wired this
 * way genuinely does this better", or it is a number pretending to be a
 * characterisation.
 */
type Leaning = { axis: TemperamentAxis; weight: number };

function leaningOf(e: Effect): Leaning | null {
  /*
   * ORDER MATTERS, and the first version had it wrong: a standing bonus on
   * yourself is `plus` and `own`, so the "helping somebody" arm claimed it and
   * a held thing read as feeling rather than discipline. What something IS
   * outranks who it points at.
   */

  // Something held is maintained rather than thrown, for as long as it lasts.
  if (e.duration.kind === 'sustained') return { axis: 'discipline', weight: 1.5 };

  // Reaching out to hurt somebody is nerve, and catching a crowd is more of it.
  if (e.sign === 'minus' && (e.who === 'foe' || e.who === 'everyone')) {
    const wide = e.shape.kind === 'burst' || e.who === 'everyone';
    return { axis: 'nerve', weight: wide ? 1.5 : 1 };
  }

  // Putting somebody back together is values over ledger.
  if (e.sign === 'plus' && (e.who === 'friend' || e.who === 'own')) {
    return { axis: 'feeling', weight: e.who === 'friend' ? 1.5 : 1 };
  }

  // Anything else that has to be kept up for a while.
  if (e.duration.kind === 'rounds') return { axis: 'discipline', weight: 1 };

  // A verb rather than a number moving is indirect work.
  if (e.channel === 'special' || e.channel === 'stat') return { axis: 'intuition', weight: 1 };

  return null;
}

/**
 * How well a set of effects suits a temperament, from −1 to +1.
 *
 * The mean of the leanings its purposes have, each scaled by where that axis
 * sits. Purposes only: what an action takes out of YOU is not something your
 * wiring has an opinion about.
 */
export function suitOf(effects: readonly Effect[], temperament: Temperament | undefined): number {
  if (!temperament) return 0;

  let total = 0;
  let weight = 0;
  for (const e of purposes(effects)) {
    const lean = leaningOf(e);
    if (!lean) continue;
    total += (temperament[lean.axis] / TEMPER_MAX) * lean.weight;
    weight += lean.weight;
  }
  return weight === 0 ? 0 : Math.max(-1, Math.min(1, total / weight));
}

/**
 * What the budget is worth on one channel.
 *
 * `swing` is the fraction the best possible match moves a number by, and the
 * worst possible match moves it the other way by the same. Zero is the identity
 * value: the same code runs and personality presses on nothing.
 */
export const scaleBy = (amount: number, suit: number, swing: number): number =>
  amount * (1 + suit * swing);

/** The other direction: what suits you costs LESS, so the sign inverts. */
export const shrinkBy = (amount: number, suit: number, swing: number): number =>
  amount * (1 - suit * swing);
