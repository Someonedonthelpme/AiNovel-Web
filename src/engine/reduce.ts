import type { Bible, ClueId, GameEvent, GameState, StateDelta, TurnEvent } from './types.ts';
import { TRUST_MAX, TRUST_MIN } from './types.ts';

/**
 * State is a fold over the append-only event log — the log is the source of
 * truth, not the state. Dice are recorded in the events rather than re-rolled,
 * so replaying a log always yields the identical state.
 */

export const START_TIME = 12;

export function initialState(bible: Bible): GameState {
  const npcs: GameState['npcs'] = {};
  for (const npc of bible.cast) {
    npcs[npc.id] = { trust: clampTrust(npc.relationships.toPC), mood: 'neutral', present: false };
  }
  return {
    turn: 0,
    beat: bible.beats[0]?.id ?? '',
    clock: bible.beats[0]?.leash ?? 3,
    clockSpent: 0,
    location: bible.startLocation,
    pc: {
      stats: { ...bible.pc.stats },
      resources: { time: START_TIME, suspicion: 0, cash: 0 },
      selfPronoun: bible.pc.voice.selfPronoun,
    },
    npcs,
    playerFacts: [],
    flags: {},
    pressureFired: {},
    ended: null,
  };
}

const clampTrust = (n: number) => Math.max(TRUST_MIN, Math.min(TRUST_MAX, n));

export type TurnEffects = {
  learned: ClueId[];
  beatAdvanced: boolean;
  /** The diegetic pressure line the world just applied, if any. */
  firedPressure: string | null;
  ended: GameState['ended'];
};

/** Apply only what the Director is permitted to change. */
function applyDelta(bible: Bible, prev: GameState, delta: StateDelta): { state: GameState; learned: ClueId[] } {
  const known = new Set(bible.clues.map((c) => c.id));
  const facts = new Set(prev.playerFacts);
  const learned: ClueId[] = [];
  for (const c of delta.learnClues ?? []) {
    if (known.has(c) && !facts.has(c)) {
      facts.add(c);
      learned.push(c);
    }
  }

  const npcs = { ...prev.npcs };
  for (const [id, d] of Object.entries(delta.trust ?? {})) {
    if (npcs[id]) npcs[id] = { ...npcs[id], trust: clampTrust(npcs[id].trust + d) };
  }
  for (const [id, mood] of Object.entries(delta.mood ?? {})) {
    if (npcs[id]) npcs[id] = { ...npcs[id], mood };
  }
  for (const [id, present] of Object.entries(delta.present ?? {})) {
    if (npcs[id]) npcs[id] = { ...npcs[id], present };
  }

  const spend = Math.max(0, delta.clockSpend ?? 0);

  return {
    learned,
    state: {
      ...prev,
      turn: prev.turn + 1,
      clock: prev.clock - spend,
      clockSpent: prev.clockSpent + spend,
      location: delta.location ?? prev.location,
      pc: {
        ...prev.pc,
        resources: {
          time: Math.max(0, prev.pc.resources.time - spend),
          suspicion: Math.max(0, prev.pc.resources.suspicion + (delta.suspicion ?? 0)),
          cash: Math.max(0, prev.pc.resources.cash + (delta.cash ?? 0)),
        },
      },
      npcs,
      playerFacts: [...facts],
      flags: { ...prev.flags, ...(delta.flags ?? {}) },
    },
  };
}

/**
 * Engine-owned consequences the Director does not get a vote on: beat
 * advancement, pressure moves, and the ending.
 */
export function applyTurn(bible: Bible, prev: GameState, event: TurnEvent): { state: GameState; effects: TurnEffects } {
  if (prev.ended) return { state: prev, effects: { learned: [], beatAdvanced: false, firedPressure: null, ended: prev.ended } };

  const applied = applyDelta(bible, prev, event.delta);
  let state = applied.state;

  // Beat advancement is COMPUTED from state, never decided by the model.
  let beatAdvanced = false;
  const facts = new Set(state.playerFacts);
  for (;;) {
    const idx = bible.beats.findIndex((b) => b.id === state.beat);
    const beat = bible.beats[idx];
    if (!beat || !facts.has(beat.exitWhen)) break;
    const next = bible.beats[idx + 1];
    beatAdvanced = true;
    if (!next) {
      state = { ...state, ended: { reason: 'solved' } };
      break;
    }
    state = { ...state, beat: next.id, clock: next.leash };
  }

  // The leash: wandering is always allowed, but it costs, and when the cost is
  // paid the world moves on its own. Never "you can't do that".
  let firedPressure: string | null = null;
  if (!state.ended && !beatAdvanced && state.clock <= 0) {
    const beat = bible.beats.find((b) => b.id === state.beat);
    if (beat) {
      const fired = state.pressureFired[beat.id] ?? 0;
      if (fired < beat.pressure.length) {
        firedPressure = beat.pressure[fired];
        state = {
          ...state,
          pressureFired: { ...state.pressureFired, [beat.id]: fired + 1 },
          clock: beat.leash,
        };
      } else {
        state = { ...state, ended: { reason: 'out_of_time' } };
      }
    }
  }

  if (!state.ended && state.pc.resources.time <= 0) {
    state = { ...state, ended: { reason: 'out_of_time' } };
  }

  return { state, effects: { learned: applied.learned, beatAdvanced, firedPressure, ended: state.ended } };
}

export function fold(bible: Bible, events: readonly GameEvent[]): GameState {
  let state = initialState(bible);
  for (const event of events) {
    if (event.kind === 'turn') state = applyTurn(bible, state, event).state;
  }
  return state;
}
