import { d20 } from './dice.ts';
import { abilityMod } from './types.ts';
import type { Combatant } from './types.ts';
import type { Rng } from '../engine/roll.ts';

/**
 * Wind-up casts: the things too big to bring off inside one round.
 *
 * A skill you can pay for out of this round's ticks resolves at once, as
 * everything did before. One you CANNOT begins a wind-up — declared now, fed by
 * your budget over the rounds that follow, and vulnerable the whole time.
 *
 * WHETHER SOMETHING TELEGRAPHS IS THEREFORE A BUILD DECISION, not a property of
 * the skill. The same effect is instant for a deft caster and a two-round
 * commitment for a slow one, because DEX shortens the tick cost. That is a far
 * better answer than tagging skills "fast" and "slow" by hand, and it is what
 * makes DEX worth raising for something other than accuracy.
 *
 * AND IT GIVES CON ITS SECOND JOB. Taking damage mid-cast forces a check to
 * hold it — "maintain focus on spells", which is what the stat was described as
 * doing from the beginning and never did. CON already sets the mana ceiling;
 * this makes it decide whether the big thing actually lands.
 */

export type PendingCast = {
  skillId: string;
  /** Who it was aimed at when it was declared. A wind-up commits to a target. */
  targetId: string | null;
  /** Ticks the cast needs in total. */
  total: number;
  /** Ticks fed into it so far. */
  done: number;
  /** What was paid up front, and out of where, so a break can give some back. */
  paid: number;
  pool: 'stamina' | 'mana';
};

/**
 * The check to hold a cast when something hits you.
 *
 * Ten, or half the damage, whichever is worse — the rule 5e settled on, and it
 * scales the right way: a scratch rarely breaks concentration and a serious
 * blow usually does.
 */
export const holdDC = (damage: number): number => Math.max(10, Math.floor(damage / 2));

export const isCasting = (who: Combatant): boolean => Boolean(who.pendingCast);

/** Begin one. The pool was already charged; this records what for. */
export const beginCast = (
  who: Combatant,
  skillId: string,
  targetId: string | null,
  total: number,
  paid: number,
  pool: 'stamina' | 'mana',
): Combatant => ({ ...who, pendingCast: { skillId, targetId, total, done: 0, paid, pool } });

/** Feed this round's ticks into it. */
export function advanceCast(who: Combatant, ticks: number): { who: Combatant; ready: boolean } {
  const cast = who.pendingCast;
  if (!cast || ticks <= 0) return { who, ready: false };

  const done = cast.done + ticks;
  if (done >= cast.total) return { who: { ...who, pendingCast: { ...cast, done: cast.total } }, ready: true };
  return { who: { ...who, pendingCast: { ...cast, done } }, ready: false };
}

/** Clear it once it has resolved. Nothing is refunded — it was spent as intended. */
export const finishCast = (who: Combatant): Combatant => {
  const { pendingCast: _gone, ...rest } = who;
  return rest as Combatant;
};

export type BreakResult = { who: Combatant; broken: boolean; refunded: number };

/**
 * Something hit you mid-cast. Hold it, or lose it.
 *
 * WHAT COMES BACK IS THE PART YOU DID NOT GET THROUGH. A cast eight ticks long
 * that was broken two ticks in returns three quarters of what it cost; one
 * broken on the last tick returns almost nothing. Paying for a whole thing and
 * losing it entirely would make interruption feel like a dice-roll robbery,
 * and refunding it in full would make interrupting a caster pointless — the
 * proportion is what makes both sides of that exchange worth playing.
 */
export function breakCast(rng: Rng, who: Combatant, damage: number): BreakResult {
  const cast = who.pendingCast;
  if (!cast) return { who, broken: false, refunded: 0 };

  const roll = d20(rng, abilityMod(who.abilities.con));
  if (roll.total >= holdDC(damage)) return { who, broken: false, refunded: 0 };

  const unused = Math.max(0, cast.total - cast.done) / Math.max(1, cast.total);
  const refunded = Math.round(cast.paid * unused);
  const cleared = finishCast(who);

  return {
    who: cast.pool === 'mana'
      ? { ...cleared, mana: Math.min(cleared.maxMana, cleared.mana + refunded) }
      : { ...cleared, stamina: Math.min(cleared.maxStamina, cleared.stamina + refunded) },
    broken: true,
    refunded,
  };
}
