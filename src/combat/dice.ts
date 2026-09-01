import type { Rng } from '../engine/roll.ts';
import type { AdvantageState, D20Roll, DamageRoll } from './types.ts';
import { abilityMod } from './types.ts';

export const die = (rng: Rng, sides: number): number => Math.floor(rng() * sides) + 1;

/**
 * A d20 check. Advantage and disadvantage roll two dice and keep the better or
 * worse one — both are recorded so the narration can mention the swing.
 */
export function d20(rng: Rng, modifier: number, advantage: AdvantageState = 'none'): D20Roll {
  const dice = advantage === 'none' ? [die(rng, 20)] : [die(rng, 20), die(rng, 20)];
  const natural =
    advantage === 'advantage' ? Math.max(...dice) : advantage === 'disadvantage' ? Math.min(...dice) : dice[0];
  return { dice, natural, modifier, total: natural + modifier, advantage };
}

/** Advantage and disadvantage cancel rather than stack, as in 5e. */
export function combineAdvantage(hasAdv: boolean, hasDis: boolean): AdvantageState {
  if (hasAdv && hasDis) return 'none';
  if (hasAdv) return 'advantage';
  if (hasDis) return 'disadvantage';
  return 'none';
}

export type DamageOutcome = { dice: number[]; total: number; type: string };

/**
 * A critical hit doubles the damage DICE, not the ability modifier — the 5e
 * rule, and the one people notice when it is wrong.
 */
export function rollDamage(
  rng: Rng,
  damage: DamageRoll,
  abilities: Record<string, number>,
  critical: boolean,
): DamageOutcome {
  const count = critical ? damage.count * 2 : damage.count;
  const dice: number[] = [];
  for (let i = 0; i < count; i++) dice.push(die(rng, damage.sides));
  const bonus = damage.bonusAbility ? abilityMod(abilities[damage.bonusAbility] ?? 10) : 0;
  // Damage never heals the target, however bad the modifier.
  const total = Math.max(0, dice.reduce((a, b) => a + b, 0) + bonus);
  return { dice, total, type: damage.type };
}
