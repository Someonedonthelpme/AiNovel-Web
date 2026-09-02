import type { AdvantageState, Combatant, Condition } from './types.ts';
import { combineAdvantage } from './dice.ts';

export function hasCondition(c: Combatant, kind: Condition): boolean {
  return c.conditions.some((x) => x.kind === kind);
}

export function addCondition(c: Combatant, kind: Condition, roundsLeft: number | null = null): Combatant {
  if (hasCondition(c, kind)) {
    // Re-applying refreshes the duration; a permanent one stays permanent.
    return {
      ...c,
      conditions: c.conditions.map((x) =>
        x.kind === kind ? { kind, roundsLeft: x.roundsLeft === null ? null : roundsLeft } : x,
      ),
    };
  }
  return { ...c, conditions: [...c.conditions, { kind, roundsLeft }] };
}

export function removeCondition(c: Combatant, kind: Condition): Combatant {
  return { ...c, conditions: c.conditions.filter((x) => x.kind !== kind) };
}

/** Called at the end of a combatant's turn. Null durations never expire. */
export function tickConditions(c: Combatant): Combatant {
  const next = c.conditions
    .map((x) => (x.roundsLeft === null ? x : { ...x, roundsLeft: x.roundsLeft - 1 }))
    .filter((x) => x.roundsLeft === null || x.roundsLeft > 0);
  return { ...c, conditions: next };
}

/** Incapacitated creatures take no actions at all. */
export function isIncapacitated(c: Combatant): boolean {
  return c.dead || c.dying || hasCondition(c, 'stunned') || hasCondition(c, 'unconscious');
}

export function effectiveSpeed(c: Combatant): number {
  if (isIncapacitated(c)) return 0;
  if (hasCondition(c, 'restrained') || hasCondition(c, 'grappled')) return 0;
  return c.speed;
}

export type AttackModifiers = { advantage: AdvantageState; autoCrit: boolean };

/**
 * The 5e advantage web, in one place.
 *
 * Prone is the interesting one: it helps melee attackers and hurts ranged ones,
 * so the same condition swings the roll in opposite directions depending on
 * range.
 */
export function attackModifiers(attacker: Combatant, target: Combatant, distance: number): AttackModifiers {
  const melee = distance <= 1;

  const attackerImpaired =
    hasCondition(attacker, 'blinded') ||
    hasCondition(attacker, 'poisoned') ||
    hasCondition(attacker, 'restrained') ||
    // Deliberately impairs and does NOT expose: being frightened makes you
    // worse at fighting, it does not make you easier to hit. That is what
    // separates a CHA hinder from a DEX one.
    hasCondition(attacker, 'frightened') ||
    hasCondition(attacker, 'prone');

  const targetExposed =
    hasCondition(target, 'blinded') ||
    hasCondition(target, 'restrained') ||
    hasCondition(target, 'stunned') ||
    hasCondition(target, 'unconscious') ||
    target.dying;

  const proneHelps = hasCondition(target, 'prone') && melee;
  const proneHinders = hasCondition(target, 'prone') && !melee;

  return {
    advantage: combineAdvantage(targetExposed || proneHelps, attackerImpaired || proneHinders),
    // A hit on a helpless creature within reach is automatically a critical.
    autoCrit: melee && (hasCondition(target, 'unconscious') || target.dying),
  };
}
