import { abilityMod } from './types.ts';
import { STANDARD } from '../rules/ruleset.ts';
import type { Ruleset } from '../rules/ruleset.ts';
import type { Combatant } from './types.ts';

/**
 * Tempo: how much a turn is worth, and what an action takes out of it.
 *
 * Combat used to run on a boolean. `actionUsed` meant one action per round for
 * everybody, which made AGILITY meaningless — "faster" cannot mean anything
 * when everyone acts exactly once. It was the last stat still doing no work,
 * and the reason its attack-speed job kept getting deferred.
 *
 * So a round hands out a BUDGET OF TICKS and every action costs some. A quick
 * combatant spends less per swing and therefore swings more often; a slow one
 * acts rarely and hits harder for it. Rounds, initiative and the whole log
 * survive unchanged — this replaces the boolean, not the structure.
 *
 * THE UNIT IS DELIBERATELY ABSTRACT. Everything is ticks and `TURN_LENGTH` is
 * one number to tune by playtest; whether a tick ends up reading as a second or
 * a breath is a question for the fiction, later, once it has been played.
 */

/** What a round is worth. The one number the whole tempo system turns on. */
export const TURN_LENGTH = STANDARD.combat.turnLength;

/** Nothing is instant, however quick you are. */
export const MIN_ACTION_TICKS = STANDARD.combat.minActionTicks;

/**
 * What one swing costs you.
 *
 * AGI buys speed directly: every point of modifier is a tick off, floored so
 * that no score makes an action free. At AGI 10 a round is exactly one action,
 * which keeps the old behaviour as the baseline everything is measured from.
 */
export function actionTicks(who: Combatant, rules: Ruleset = STANDARD): number {
  return Math.max(rules.combat.minActionTicks, rules.combat.turnLength - abilityMod(who.abilities.agi));
}

/**
 * What bringing off a skill costs you.
 *
 * DEX shortens it, which is that stat's third distinct job — it hits, it keeps
 * damage consistent, and it gets the difficult thing out faster. Reading
 * "reduces magic casting time" as TURNS rather than seconds is what finally
 * gives it a home in an engine where a turn is a turn.
 */
export function castTicks(who: Combatant, base: number, rules: Ruleset = STANDARD): number {
  return Math.max(rules.combat.minActionTicks, base - abilityMod(who.abilities.dex));
}

/**
 * Whether there is anything left to act with.
 *
 * A budget at or below nothing means the round is spent. It may be NEGATIVE,
 * because a heavy action is allowed to overrun into the round after it — that
 * is what makes slow and heavy a build rather than a penalty. You commit, it
 * lands, and then you stand there recovering.
 */
export const canAct = (who: Combatant): boolean => who.ticks > 0;

/** Spend, allowing the overrun. */
export const spendTicks = (who: Combatant, ticks: number): Combatant =>
  ({ ...who, ticks: who.ticks - ticks });

/**
 * A new round's worth, added to whatever was left.
 *
 * Added rather than assigned, so an overrun is genuinely paid back and a
 * careful combatant banks a little toward an extra action later. Capped at one
 * spare round so nothing can save up indefinitely and open with four swings.
 */
export const refillTicks = (who: Combatant, rules: Ruleset = STANDARD): Combatant => ({
  ...who,
  ticks: Math.min(rules.combat.turnLength * 2, who.ticks + rules.combat.turnLength),
});
