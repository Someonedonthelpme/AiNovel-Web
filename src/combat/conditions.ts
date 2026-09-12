import type { AdvantageState, Combatant, Condition } from './types.ts';
import { STANDARD } from '../rules/ruleset.ts';
import type { Ruleset } from '../rules/ruleset.ts';
import { abilityMod } from './types.ts';
import { combineAdvantage } from './dice.ts';

export function hasCondition(c: Combatant, kind: Condition): boolean {
  return c.conditions.some((x) => x.kind === kind);
}

/**
 * Which stat shrugs a condition off, and by how much.
 *
 * Resistance shortens a DURATION rather than rolling a save, for two reasons.
 * `resolveSave` exists and is called by nothing but its own tests, so
 * conditions have always landed unconditionally — and `addCondition` is a pure
 * function with no `Rng`, so a save here would mean threading dice through
 * every call site. Shortening is deterministic, replays for free, and reads the
 * same at the table: a tough person is stunned for less time, never for none.
 *
 * VIT is the body — being knocked down, held, or rattled senseless.
 * CON is the mind holding on — poison, fear, and losing your bearings.
 */
const RESISTED_BY: Partial<Record<Condition, 'vit' | 'con'>> = {
  stunned: 'vit', prone: 'vit', grappled: 'vit', restrained: 'vit',
  poisoned: 'con', frightened: 'con', blinded: 'con',
};

/** Never immunity: something always lands for at least this long. */
export const MIN_ROUNDS = STANDARD.combat.conditionFloor;

export function resistedRounds(
  c: Combatant, kind: Condition, rounds: number, rules: Ruleset = STANDARD,
): number {
  const stat = RESISTED_BY[kind];
  if (!stat) return rounds;
  const shrug = Math.max(0, abilityMod(c.abilities[stat]));
  return Math.max(rules.combat.conditionFloor, rounds - shrug);
}

export function addCondition(
  c: Combatant, kind: Condition, roundsLeft: number | null = null, rules: Ruleset = STANDARD,
): Combatant {
  // A permanent condition is not shortened — being unconscious is a state, not
  // a timer somebody tough gets less of.
  const rounds = roundsLeft === null ? null : resistedRounds(c, kind, roundsLeft, rules);
  if (hasCondition(c, kind)) {
    // Re-applying refreshes the duration; a permanent one stays permanent.
    return {
      ...c,
      conditions: c.conditions.map((x) =>
        x.kind === kind ? { kind, roundsLeft: x.roundsLeft === null ? null : rounds } : x,
      ),
    };
  }
  return { ...c, conditions: [...c.conditions, { kind, roundsLeft: rounds }] };
}

export function removeCondition(c: Combatant, kind: Condition): Combatant {
  return { ...c, conditions: c.conditions.filter((x) => x.kind !== kind) };
}

/** Called at the end of a combatant's turn. Null durations never expire. */
export function tickConditions(c: Combatant): Combatant {
  const next = c.conditions
    .map((x) => (x.roundsLeft === null ? x : { ...x, roundsLeft: x.roundsLeft - 1 }))
    .filter((x) => x.roundsLeft === null || x.roundsLeft > 0);

  // A taunt is not a condition — it names WHO — but it wears off on the same
  // clock, because two countdowns that could drift apart is one too many.
  const { taunt, ...rest } = c;
  const held = taunt && taunt.roundsLeft > 1 ? { ...taunt, roundsLeft: taunt.roundsLeft - 1 } : undefined;
  return held ? { ...rest, conditions: next, taunt: held } : { ...(rest as Combatant), conditions: next };
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

  /*
   * AND WHETHER THIS IS WHAT IT HUNTS. The whole of the predator mechanic, and
   * advantage rather than a bonus because the engine already has advantage — a
   * flat `+n` to hit has no reader anywhere in `resolve.ts`, which is why
   * `treeBonuses.attack` has been dead since it was written.
   */
  const hunting = Boolean(attacker.hunts) && attacker.hunts === target.group;

  const proneHelps = hasCondition(target, 'prone') && melee;
  const proneHinders = hasCondition(target, 'prone') && !melee;

  return {
    advantage: combineAdvantage(targetExposed || proneHelps || hunting, attackerImpaired || proneHinders),
    // A hit on a helpless creature within reach is automatically a critical.
    autoCrit: melee && (hasCondition(target, 'unconscious') || target.dying),
  };
}
