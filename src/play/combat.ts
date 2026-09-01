import { autoTurn } from '../combat/ai.ts';
import { attack, attackOptions, currentActor, endTurn, movementOptions, moveTo, startCombat } from '../combat/combat.ts';
import { buildEncounter, kindForFloor } from '../combat/encounter.ts';
import { cellKey } from '../combat/grid.ts';
import type { CombatEvent, CombatState, Combatant, Grid, Vec } from '../combat/types.ts';
import { bumpCounter } from '../character/persona.ts';
import { mulberry32 } from '../engine/roll.ts';
import type { Rng } from '../engine/roll.ts';
import { toCombatant } from '../session/sheet.ts';
import { activeRegion } from '../world/travel.ts';
import type { PlayState } from './state.ts';

/**
 * Combat, as it appears inside the play loop.
 *
 * The engine already resolves fights; this is the seam that lets one start, lets
 * the player act, and folds the result back into the world.
 *
 * Two rules shape it. The player's action is CHOSEN FROM A LEGAL LIST rather
 * than parsed from prose, so no model call is needed to swing a sword — which
 * keeps a fight fast and free. And every roll is derived from state, so a
 * replayed log produces the identical fight rather than a differently unlucky
 * one.
 */

export const ARENA_SIZE = 12;

/**
 * The ground you fight on.
 *
 * Deterministic from the seed: the same encounter must lay out the same way on
 * replay, and a few obstacles make position matter without turning it into a
 * maze.
 */
export function arenaFor(seed: number, danger: number): Grid {
  const rng = mulberry32(seed * 31 + danger);
  const walls = new Set<string>();
  const obstacles = Math.min(6, 1 + Math.floor(danger / 6));

  for (let i = 0; i < obstacles; i++) {
    // Kept off the edges so neither side can be spawned into a corner it
    // cannot leave.
    const x = 3 + Math.floor(rng() * (ARENA_SIZE - 6));
    const y = 3 + Math.floor(rng() * (ARENA_SIZE - 6));
    walls.add(cellKey({ x, y }));
  }
  return { width: ARENA_SIZE, height: ARENA_SIZE, walls };
}

/** Every roll in a fight comes from here, so a replay reproduces it exactly. */
export function combatRng(state: PlayState): Rng {
  const length = state.combat?.log.length ?? 0;
  return mulberry32(state.world.seed + state.world.turn * 7919 + length);
}

/** The player character as they currently stand — wounds and all. */
export function playerCombatant(state: PlayState): Combatant {
  const base = toCombatant(state.sheet, 'pc');
  return {
    ...base,
    hp: Math.min(state.pc.hp, base.maxHp),
    conditions: state.pc.conditions,
    pos: { x: 1, y: Math.floor(ARENA_SIZE / 2) },
  };
}

/**
 * Start a fight on the current floor.
 *
 * The Director says *that* a fight breaks out; depth decides *what* shows up,
 * because the difficulty curve is the whole progression and cannot be
 * re-invented per encounter by a model.
 */
export function beginEncounter(state: PlayState): PlayState {
  if (state.combat && !state.combat.over) return state;

  const region = activeRegion(state.world);
  const danger = region?.danger ?? 0;
  const grid = arenaFor(state.world.seed + state.world.turn, danger);

  const foes = buildEncounter({
    danger,
    kind: kindForFloor(danger),
    names: region?.creatures,
    grid,
    origin: { x: ARENA_SIZE - 2, y: Math.floor(ARENA_SIZE / 2) },
  });

  const rng = combatRng(state);
  let combat = startCombat(rng, [playerCombatant(state), ...foes], grid);

  // If something faster went first, let it act. Otherwise the fight opens with
  // nobody able to move and the player waiting on a turn that is not theirs.
  let guard = 0;
  while (!combat.over && currentActor(combat)?.side !== 'party' && guard++ < 64) {
    combat = autoTurn(rng, { ...combat });
  }

  return { ...state, combat };
}

/* -------------------------------------------------------------------------- */
/* What the player may do                                                      */
/* -------------------------------------------------------------------------- */

export type CombatAction =
  | { kind: 'attack'; target: string; attack: string }
  | { kind: 'move'; to: Vec }
  | { kind: 'end' };

export type CombatOption = { action: CombatAction; label: string };

/** Legal moves only — the same invariant the engine's option lists already hold. */
export function combatOptions(state: PlayState): CombatOption[] {
  const combat = state.combat;
  if (!combat || combat.over) return [];
  const actor = currentActor(combat);
  if (!actor || actor.side !== 'party') return [];

  const options: CombatOption[] = [];

  for (const weapon of actor.attacks) {
    for (const target of attackOptions(combat, weapon.id)) {
      if (target.side === actor.side) continue;
      options.push({
        action: { kind: 'attack', target: target.id, attack: weapon.id },
        label: `${weapon.name} → ${target.name} (${target.hp}/${target.maxHp})`,
      });
    }
  }

  for (const cell of movementOptions(combat)) {
    options.push({ action: { kind: 'move', to: cell }, label: `move to ${cell.x},${cell.y}` });
  }

  options.push({ action: { kind: 'end' }, label: 'end turn' });
  return options;
}

/** Is it the player's move? */
export const awaitingPlayer = (state: PlayState): boolean => {
  const combat = state.combat;
  if (!combat || combat.over) return false;
  return currentActor(combat)?.side === 'party';
};

/* -------------------------------------------------------------------------- */
/* Taking a turn                                                               */
/* -------------------------------------------------------------------------- */

export type CombatStep = {
  state: PlayState;
  /** Everything that happened since the player last acted. */
  events: CombatEvent[];
  error: string | null;
};

/**
 * Apply the player's action, then let everyone else act until it is their move
 * again (or the fight ends). One call per player decision, however many foes
 * are on the board.
 */
export function takeCombatAction(state: PlayState, action: CombatAction): CombatStep {
  const combat = state.combat;
  if (!combat || combat.over) return { state, events: [], error: 'no fight is happening' };
  if (!awaitingPlayer(state)) return { state, events: [], error: 'it is not your move' };

  const before = combat.log.length;
  let next: CombatState = combat;
  let error: string | null = null;

  const rng = combatRng(state);
  if (action.kind === 'attack') {
    const result = attack(rng, next, action.target, action.attack);
    error = result.error;
    next = result.state;
    if (!error) next = endTurn(rng, next).state;
  } else if (action.kind === 'move') {
    const result = moveTo(next, action.to);
    error = result.error;
    next = result.state;
  } else {
    next = endTurn(rng, next).state;
  }

  if (error) return { state, events: [], error };

  // Everyone else acts. Bounded so a board of stalled combatants cannot spin.
  let guard = 0;
  while (!next.over && currentActor(next)?.side !== 'party' && guard++ < 64) {
    next = autoTurn(rng, { ...next });
  }

  return {
    state: { ...state, combat: next },
    events: next.log.slice(before),
    error: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Folding the result back into the world                                      */
/* -------------------------------------------------------------------------- */

export type CombatOutcome = {
  state: PlayState;
  victor: 'party' | 'foe' | 'draw' | null;
  /** Named foes put down, for the tallies traits will read. */
  killed: string[];
};

/**
 * End the fight and carry its consequences out into the world.
 *
 * Wounds persist, kills are counted, and the fight itself is discarded — a
 * finished encounter is not state, it is something that happened.
 */
export function concludeCombat(state: PlayState): CombatOutcome {
  const combat = state.combat;
  if (!combat) return { state, victor: null, killed: [] };

  const pc = combat.combatants['pc'];
  const killed = Object.values(combat.combatants)
    .filter((c) => c.side === 'foe' && c.dead)
    .map((c) => c.name);

  let counters = state.sheet.counters;
  for (const _ of killed) counters = bumpCounter(counters, 'kills');
  if (combat.victor === 'party') counters = bumpCounter(counters, 'fights_won');
  if (combat.victor === 'foe') counters = bumpCounter(counters, 'fights_lost');

  return {
    state: {
      ...state,
      combat: null,
      sheet: { ...state.sheet, counters },
      pc: {
        ...state.pc,
        hp: pc ? Math.max(0, pc.hp) : state.pc.hp,
        conditions: pc?.conditions ?? state.pc.conditions,
      },
      // Losing is not an instant death: you go down, and the run is over.
      ended: combat.victor === 'foe' ? { reason: 'defeated' } : state.ended,
    },
    victor: combat.victor,
    killed,
  };
}

/* -------------------------------------------------------------------------- */
/* What is worth narrating                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The moments a reader cares about.
 *
 * Narrating every swing is both expensive and dull; a fight reads better as its
 * turning points. Misses and ordinary hits are left to the numbers.
 */
export function notableEvents(events: CombatEvent[]): string[] {
  const notable: string[] = [];

  for (const event of events) {
    if (event.kind === 'attack') {
      if (event.killedTarget) notable.push(`${event.attacker} kills ${event.target}`);
      else if (event.droppedTarget) notable.push(`${event.target} goes down`);
      else if (event.critical) notable.push(`${event.attacker} lands a devastating ${event.attackName} on ${event.target}`);
      else if (event.hit && event.targetHpAfter <= event.targetHpBefore / 4) {
        notable.push(`${event.target} is barely standing`);
      }
    } else if (event.kind === 'deathSave' && event.died) {
      notable.push(`${event.actor} stops moving`);
    } else if (event.kind === 'deathSave' && event.outcome === 'criticalSuccess') {
      notable.push(`${event.actor} drags themselves back up`);
    } else if (event.kind === 'combatEnd') {
      notable.push(event.victor === 'party' ? 'the fight is over and you are standing' : 'the fight is lost');
    }
  }

  return notable;
}
