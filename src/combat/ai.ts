import type { Rng } from '../engine/roll.ts';
import { attack, attackOptions, currentActor, endTurn, movementOptions, moveTo } from './combat.ts';
import { distance } from './grid.ts';
import type { CombatState, Combatant, Vec } from './types.ts';

/**
 * How a combatant acts when nobody is steering it.
 *
 * Deliberately simple and deterministic: close with the nearest enemy, hit the
 * one closest to dropping. It drives foes during play, and it is also what makes
 * the difficulty curve measurable — a fight can be simulated thousands of times
 * to see whether floor 12 is actually harder than floor 8.
 */

const livingEnemies = (state: CombatState, actor: Combatant): Combatant[] =>
  Object.values(state.combatants).filter((c) => !c.dead && c.side !== actor.side);

/**
 * Finish the wounded first: it removes attackers from the board fastest.
 *
 * UNLESS SOMEBODY HAS MADE THEMSELVES THE PROBLEM. A taunt overrides the
 * choice outright rather than nudging a score — that is what makes it worth
 * spending a turn on, and it is the reason `taunt` is stored WITH a name on it
 * instead of being one more condition.
 */
function pickTarget(candidates: Combatant[], actor?: Combatant): Combatant | null {
  if (candidates.length === 0) return null;

  const pulled = actor?.taunt && candidates.find((c) => c.id === actor.taunt!.by);
  if (pulled) return pulled;

  return [...candidates].sort((a, b) => a.hp - b.hp || a.id.localeCompare(b.id))[0];
}

/** The reachable square that gets closest to the chosen enemy. */
function stepToward(state: CombatState, target: Vec): Vec | null {
  const actor = currentActor(state);
  if (!actor) return null;

  let best: { cell: Vec; distance: number } | null = null;
  for (const cell of movementOptions(state)) {
    const d = distance(cell, target);
    if (!best || d < best.distance) best = { cell, distance: d };
  }
  if (!best) return null;
  return best.distance < distance(actor.pos, target) ? best.cell : null;
}

/**
 * Play one combatant's whole turn.
 *
 * Bounded by construction: each branch either spends the action, spends
 * movement, or ends the turn, so it always terminates.
 */
export function autoTurn(rng: Rng, state: CombatState): CombatState {
  let current = state;
  const actor = currentActor(current);
  if (!actor || current.over) return current;

  const weapon = actor.attacks[0];
  if (!weapon) return endTurn(rng, current).state;

  // Strike first if anything is already in reach.
  const inReach = pickTarget(attackOptions(current, weapon.id).filter((c) => c.side !== actor.side), actor);
  if (inReach) {
    const struck = attack(rng, current, inReach.id, weapon.id);
    if (!struck.error) current = struck.state;
    return current.over ? current : endTurn(rng, current).state;
  }

  // Otherwise close the distance, then strike if that brought anyone in reach.
  const quarry = pickTarget(livingEnemies(current, actor), actor);
  if (quarry) {
    const step = stepToward(current, quarry.pos);
    if (step) {
      const moved = moveTo(current, step);
      if (!moved.error) current = moved.state;
    }
    const nowInReach = pickTarget(attackOptions(current, weapon.id).filter((c) => c.side !== actor.side), actor);
    if (nowInReach) {
      const struck = attack(rng, current, nowInReach.id, weapon.id);
      if (!struck.error) current = struck.state;
    }
  }

  return current.over ? current : endTurn(rng, current).state;
}
