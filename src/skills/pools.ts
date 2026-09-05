import { abilityMod } from '../combat/types.ts';
import type { Ability, Combatant } from '../combat/types.ts';
import { STANDARD } from '../rules/ruleset.ts';
import type { Ruleset } from '../rules/ruleset.ts';
import type { Temperament } from '../character/persona.ts';
import type { ActiveSkill } from './active.ts';
import { costs, magnitudeOf } from './effect.ts';
import { shrinkBy, suitOf } from './suit.ts';

/**
 * What a skill costs, and which pool it comes out of.
 *
 * This replaced `usesPerRest`, which was a weak lever for three reasons. Every
 * skill carried its own allowance independent of every other, so ten skills
 * meant forty uses and no scarcity at all. The count came from the SOURCE's
 * budget, so a deep book handed the same four uses to an INT-8 reader as to an
 * INT-18 one — the stat gated what you could do and said nothing about how long
 * you could keep doing it. And nothing ever traded off against anything: there
 * was no moment where spending on one skill cost you another.
 *
 * Two shared pools fix all three. The spread sets the ceiling, and every cast
 * is a decision between skills rather than a per-skill allowance being ticked
 * down.
 */

export type Pool = 'stamina' | 'mana';

/**
 * WHICH POOL FOLLOWS THE STAT, not the payload.
 *
 * One rule, and it is what makes the physical and mental halves of the stat
 * sheet structural rather than thematic. A `strike` on STR is exertion and a
 * `strike` on INT is concentration — the same payload, paid for out of
 * different reserves, which is the stat-grammar argument showing up again in
 * the economy.
 */
const MENTAL: readonly Ability[] = ['con', 'int', 'wis', 'cha', 'luk'];

export const poolFor = (stat: Ability): Pool => (MENTAL.includes(stat) ? 'mana' : 'stamina');

/**
 * What one use costs.
 *
 * Derived from the same prices the composer budgets against, so a skill worth
 * more costs more to throw — there is exactly one economy, not two that have to
 * be kept in step. A floor keeps anything from being free; a ceiling keeps a
 * single deep skill from being unusable at the level it is found.
 *
 * PROVISIONAL. The action economy — skills that take a turn to bring off, and
 * DEX shortening that — is still to be designed, and a skill that costs two
 * turns is a different balance object from one that costs eight mana. These
 * numbers expect to move once that lands.
 */
export const MIN_COST = 1;
export const MAX_COST = 12;

/**
 * What one use costs, and out of where.
 *
 * READ OFF THE SKILL rather than derived from its payload. The cost used to be
 * inferred every time anybody asked, which meant it could never be anything
 * but a pool — and a skill that pays in hp, or in a condition on yourself, is
 * exactly the thing the component model exists to allow. `composeSkill`
 * declares a cost; this reports it.
 *
 * A skill with no cost effect is free, which is what a standing bonus is.
 *
 * `who` is the one place the persona reaches the economy. Something that suits
 * you comes cheaper, and because the cast length is read off the price, it comes
 * FASTER by the same number — one budget, two channels, no second dial to keep
 * in step. The floor is what stops a perfect match ever making a skill free.
 */
export function priceOfUse(
  skill: ActiveSkill,
  who?: { temperament?: Temperament } | null,
  rules: Ruleset = STANDARD,
): { pool: Pool; cost: number } {
  const pool = poolFor(skill.ability);
  const paid = costs(skill.effects).find((e) => e.channel === 'stamina' || e.channel === 'mana');
  if (!paid) return { pool, cost: 0 };

  const suit = suitOf(skill.effects, who?.temperament);
  const asked = shrinkBy(magnitudeOf(paid), suit, rules.persona.suitSwing);
  return {
    pool: paid.channel === 'mana' ? 'mana' : 'stamina',
    cost: Math.max(MIN_COST, Math.min(MAX_COST, Math.round(asked))),
  };
}

/* -------------------------------------------------------------------------- */
/* Spending                                                                    */
/* -------------------------------------------------------------------------- */

export function canAfford(who: Combatant, skill: ActiveSkill, as?: { temperament?: Temperament } | null): boolean {
  const { pool, cost } = priceOfUse(skill, as);
  if (cost === 0) return true;
  return (pool === 'mana' ? who.mana : who.stamina) >= cost;
}

export function spend(who: Combatant, skill: ActiveSkill, as?: { temperament?: Temperament } | null): Combatant {
  const { pool, cost } = priceOfUse(skill, as);
  if (cost === 0) return who;
  return pool === 'mana'
    ? { ...who, mana: Math.max(0, who.mana - cost) }
    : { ...who, stamina: Math.max(0, who.stamina - cost) };
}

/**
 * What a pool comes back to.
 *
 * Kept here rather than in `sheet.ts` so a foe and a character recover on the
 * same rule; the sheet's version simply feeds it different numbers.
 */
export const poolCeiling = (stat: number, level: number, worn: number): number =>
  Math.max(1, 8 + abilityMod(stat) * 2 + (Math.max(1, level) - 1) * 2 - worn);
