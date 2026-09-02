import { abilityMod } from '../combat/types.ts';
import type { Ability, Combatant } from '../combat/types.ts';
import type { ActiveEffect, ActiveSkill } from './active.ts';

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

export function costOf(effect: ActiveEffect): number {
  const raw = (() => {
    switch (effect.kind) {
      case 'strike':
        return effect.damage / 2;
      case 'burst':
        return (effect.damage / 2) * (1 + effect.radius * 0.5);
      case 'hinder':
        return 1 + effect.rounds;
      case 'hex':
        return effect.damage / 2 + effect.rounds;
      case 'drain':
        return effect.damage / 2 + effect.heal / 3;
      case 'mend':
        return effect.amount / 3;
      case 'rally':
        return 2;
      case 'edge':
        // Always on and never thrown, so it is never paid for out of a pool.
        return 0;
    }
  })();

  if (effect.kind === 'edge') return 0;
  return Math.max(MIN_COST, Math.min(MAX_COST, Math.round(raw)));
}

/** What a whole skill costs to use once, and out of where. */
export const priceOfUse = (skill: ActiveSkill): { pool: Pool; cost: number } =>
  ({ pool: poolFor(skill.ability), cost: costOf(skill.effect) });

/* -------------------------------------------------------------------------- */
/* Spending                                                                    */
/* -------------------------------------------------------------------------- */

export function canAfford(who: Combatant, skill: ActiveSkill): boolean {
  const { pool, cost } = priceOfUse(skill);
  if (cost === 0) return true;
  return (pool === 'mana' ? who.mana : who.stamina) >= cost;
}

export function spend(who: Combatant, skill: ActiveSkill): Combatant {
  const { pool, cost } = priceOfUse(skill);
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
