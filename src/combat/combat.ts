import type { Rng } from '../engine/roll.ts';
import { d20 } from './dice.ts';
import { effectiveSpeed, isIncapacitated, tickConditions } from './conditions.ts';
import { cellKey, distance, hasLineOfSight, occupancyFor, reachableStops } from './grid.ts';
import { resolveAttack, rollDeathSave } from './resolve.ts';
import type { CombatEvent, CombatState, Combatant, Grid, ParleyEffect, Side, Vec } from './types.ts';
import { abilityMod } from './types.ts';
import { actionTicks, canAct, refillTicks, spendTicks } from './tempo.ts';

/**
 * The encounter state machine.
 *
 * Every action returns a NEW state plus an `error` when the action was illegal,
 * so an invalid proposal from the Director is rejected cleanly instead of
 * corrupting the encounter. Nothing here consults a model.
 */

export type ActionResult = { state: CombatState; error: string | null };

const ok = (state: CombatState): ActionResult => ({ state, error: null });
const fail = (state: CombatState, error: string): ActionResult => ({ state, error });

const log = (state: CombatState, ...events: CombatEvent[]): CombatState => ({
  ...state,
  log: [...state.log, ...events],
});

const put = (state: CombatState, c: Combatant): CombatState => ({
  ...state,
  combatants: { ...state.combatants, [c.id]: c },
});

export const currentActor = (state: CombatState): Combatant | null =>
  state.combatants[state.order[state.turn]] ?? null;

export const living = (state: CombatState, side: Side): Combatant[] =>
  Object.values(state.combatants).filter((c) => c.side === side && !c.dead);

/** A side is beaten when nobody on it is still up and fighting. */
function standing(state: CombatState, side: Side): Combatant[] {
  return living(state, side).filter((c) => !c.dying);
}

export function checkVictory(state: CombatState): Side | 'draw' | null {
  const party = standing(state, 'party').length;
  const foes = standing(state, 'foe').length;
  if (party > 0 && foes === 0) return 'party';
  if (foes > 0 && party === 0) return 'foe';
  if (party === 0 && foes === 0) return 'draw';
  return null;
}

/**
 * FOES AT THEIR BREAK LINE LEAVE THE BOARD (DESIGN 6b stage 6).
 *
 * One that somebody is standing on — a party member up and within a square —
 * YIELDS; one with nobody on it FLEES. Taken off the board rather than flagged,
 * so every check that asks who is still fighting keeps asking `dead` and needs
 * no second rule. Deterministic in the board, so a replay breaks the same foes.
 *
 * `ponytail: "somebody within a square" stands in for "cornered", and a fleeing
 * foe is simply gone — no path out is simulated. Model escape routes when being
 * cornered needs to mean walls.`
 */
export function settle(state: CombatState): CombatState {
  let next = state;
  for (const who of Object.values(state.combatants)) {
    if (who.side !== 'foe' || who.dead || who.breaksAt === undefined) continue;
    if (who.hp <= 0 || who.hp > who.breaksAt) continue;

    const cornered = standing(next, 'party').some((c) => distance(c.pos, who.pos) <= 1);
    const as = cornered ? 'yielded' : 'fled';
    const { [who.id]: _gone, ...combatants } = next.combatants;
    next = log(
      { ...next, combatants, broken: { ...next.broken, [who.id]: { who, as } } },
      { kind: 'broke', actor: who.id, as },
    );
  }
  return next;
}

/** Whether this foe has already been spoken to this fight — it hears you once (6b stage 8). */
export const heard = (state: CombatState, id: string): boolean =>
  state.log.some((e) => e.kind === 'parley' && e.target === id);

/**
 * A foe answers a word (6b stage 8). Yielding and leaving are stage 6's two ways
 * off the board, so everything after — a fate, a survivor, a deed — is the same
 * machinery; refusing changes nothing. The verdict is decided elsewhere: this
 * only carries it out.
 */
export function hear(state: CombatState, targetId: string, verdict: ParleyEffect): ActionResult {
  const actor = currentActor(state);
  const who = state.combatants[targetId];
  if (!actor || !who || who.dead || who.side === actor.side) return fail(state, `${targetId} is not someone to talk to`);
  if (heard(state, targetId)) return fail(state, `${who.name} has already heard you`);

  const said = log(state, { kind: 'parley', actor: actor.id, target: targetId, verdict });
  if (verdict === 'refuses') return ok(said);
  const as = verdict === 'yields' ? 'yielded' : 'fled';
  const { [targetId]: _gone, ...combatants } = said.combatants;
  return ok(log(
    { ...said, combatants, broken: { ...said.broken, [targetId]: { who, as } } },
    { kind: 'broke', actor: targetId, as },
  ));
}

function settleIfOver(state: CombatState): CombatState {
  if (state.over) return state;
  const settled = settle(state);
  const victor = checkVictory(settled);
  if (!victor) return settled;
  return log({ ...settled, over: true, victor }, { kind: 'combatEnd', victor });
}

/**
 * Move the turn pointer to the next combatant who can actually act.
 *
 * Dead combatants are skipped outright; dying ones roll a death save and then
 * lose their turn, which is where most of the drama in a fight comes from.
 */
function advanceToNextActor(rng: Rng, state: CombatState): CombatState {
  let next = state;
  // Bounded so a table of corpses can never spin forever.
  const limit = state.order.length * 4 + 8;

  for (let i = 0; i < limit; i++) {
    next = settleIfOver(next);
    if (next.over) return next;

    const turn = next.turn + 1;
    const wrapped = turn >= next.order.length;
    next = {
      ...next,
      turn: wrapped ? 0 : turn,
      round: wrapped ? next.round + 1 : next.round,
    };
    if (wrapped) next = log(next, { kind: 'roundStart', round: next.round });

    const actor = currentActor(next);
    if (!actor || actor.dead) continue;

    if (actor.dying) {
      const save = rollDeathSave(rng, actor);
      next = log(put(next, save.actor), save.event);
      continue;
    }

    if (isIncapacitated(actor)) {
      // Conscious but unable to act still burns the turn.
      next = log(put(next, tickConditions(actor)), { kind: 'turnStart', actor: actor.id });
      continue;
    }

    /*
     * A round hands out TICKS rather than clearing a boolean.
     *
     * `actionUsed` meant one action each for everybody, which made AGILITY
     * meaningless — "faster" cannot mean anything when everyone acts exactly
     * once. Refilled rather than assigned, so a heavy action that overran into
     * this round is genuinely paid back.
     */
    return log(
      { ...put(next, refillTicks(actor)), movementLeft: effectiveSpeed(actor) },
      { kind: 'turnStart', actor: actor.id },
    );
  }
  return settleIfOver(next);
}

export function startCombat(
  rng: Rng,
  roster: Combatant[],
  grid: Grid,
  /** The side that struck first, which acts before the other whatever it rolled. */
  ambusher?: Side,
): CombatState {
  /*
   * AGILITY rolls initiative, not dexterity.
   *
   * DEX is the steady hand — it hits and it keeps damage consistent. AGI is
   * how fast you are off the mark, which is the whole of what initiative asks.
   * Splitting them is why AGI exists at all; leaving initiative on DEX would
   * have made it the stat that did everything and AGI the stat that did
   * nothing until the combat pass.
   */
  const rolled = roster.map((c) => ({ c, init: d20(rng, abilityMod(c.abilities.agi)).total }));

  // Ties break on agility then id, so initiative order is fully deterministic.
  // Everybody still rolls in an ambush, so the dice after it fall the same.
  const edge = (c: Combatant) => (c.side === ambusher ? 1 : 0);
  rolled.sort(
    (a, b) =>
      edge(b.c) - edge(a.c) ||
      b.init - a.init ||
      abilityMod(b.c.abilities.agi) - abilityMod(a.c.abilities.agi) ||
      a.c.id.localeCompare(b.c.id),
  );

  /*
   * Everybody enters a fight with an EMPTY tick budget.
   *
   * Not cosmetic: `advanceToNextActor` refills at the start of a turn, so
   * carrying a full budget in would have the first actor refill to double and
   * open the fight with two swings. Whatever a combatant was carrying around
   * the tower is not a head start in the fight.
   */
  const combatants: Record<string, Combatant> = {};
  for (const entry of rolled) combatants[entry.c.id] = { ...entry.c, ticks: 0 };

  const base: CombatState = {
    round: 1,
    turn: -1,
    order: rolled.map((r) => r.c.id),
    combatants,
    grid,
    movementLeft: 0,
    over: false,
    victor: null,
    log: [{ kind: 'roundStart', round: 1 }],
  };

  return advanceToNextActor(rng, base);
}

export function moveTo(state: CombatState, to: Vec): ActionResult {
  if (state.over) return fail(state, 'combat is over');
  const actor = currentActor(state);
  if (!actor) return fail(state, 'no active combatant');

  const occ = occupancyFor(Object.values(state.combatants), actor.side);
  const stops = reachableStops(state.grid, actor.pos, state.movementLeft, occ);
  const cost = stops.get(cellKey(to));
  if (cost === undefined) {
    return fail(state, `cannot reach ${cellKey(to)} with ${state.movementLeft} movement`);
  }

  const moved = put({ ...state, movementLeft: state.movementLeft - cost }, { ...actor, pos: to });
  return ok(log(moved, { kind: 'move', actor: actor.id, from: actor.pos, to, cost }));
}

export function attack(rng: Rng, state: CombatState, targetId: string, attackId: string): ActionResult {
  if (state.over) return fail(state, 'combat is over');
  const actor = currentActor(state);
  if (!actor) return fail(state, 'no active combatant');
  if (!canAct(actor)) return fail(state, 'no time left this round');

  const target = state.combatants[targetId];
  if (!target) return fail(state, `no such target: ${targetId}`);
  if (target.dead) return fail(state, `${targetId} is already dead`);
  if (target.id === actor.id) return fail(state, 'cannot attack yourself');

  const weapon = actor.attacks.find((a) => a.id === attackId);
  if (!weapon) return fail(state, `${actor.id} has no attack "${attackId}"`);

  const dist = distance(actor.pos, target.pos);
  if (dist > weapon.range) return fail(state, `${targetId} is out of range (${dist} > ${weapon.range})`);
  if (!hasLineOfSight(state.grid, actor.pos, target.pos)) {
    return fail(state, `no line of sight to ${targetId}`);
  }

  const result = resolveAttack(rng, actor, target, attackId);
  /*
   * Spending happens on the ATTACKER and landing on the target, so both go into
   * the same put. A heavy swing may take the budget negative — that is the
   * overrun, and it is what makes slow-and-heavy a build rather than a penalty.
   */
  const spent = spendTicks(result.attacker ?? actor, actionTicks(actor));
  const next = log(put(put({ ...state }, spent), result.target), result.event);
  return ok(settleIfOver(next));
}

export function endTurn(rng: Rng, state: CombatState): ActionResult {
  if (state.over) return fail(state, 'combat is over');
  const actor = currentActor(state);
  const ticked = actor ? put(state, tickConditions(actor)) : state;
  return ok(advanceToNextActor(rng, ticked));
}

/** Squares the active combatant could legally stop on this turn. */
export function movementOptions(state: CombatState): Vec[] {
  const actor = currentActor(state);
  if (!actor || state.over) return [];
  const occ = occupancyFor(Object.values(state.combatants), actor.side);
  return [...reachableStops(state.grid, actor.pos, state.movementLeft, occ).keys()].map((k) => {
    const parts = k.split(',').map(Number);
    return { x: parts[0], y: parts[1] };
  });
}

/** Targets the active combatant could legally attack right now. */
export function attackOptions(state: CombatState, attackId: string): Combatant[] {
  const actor = currentActor(state);
  if (!actor || state.over || !canAct(actor)) return [];
  const weapon = actor.attacks.find((a) => a.id === attackId);
  if (!weapon) return [];
  return Object.values(state.combatants).filter(
    (t) =>
      !t.dead &&
      t.id !== actor.id &&
      distance(actor.pos, t.pos) <= weapon.range &&
      hasLineOfSight(state.grid, actor.pos, t.pos),
  );
}
