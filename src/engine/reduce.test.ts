import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTurn, fold, initialState, START_TIME } from './reduce.ts';
import { goodBible } from '../worldgen/fixtures.ts';
import type { GameEvent, StateDelta, TurnEvent } from './types.ts';

const turn = (delta: StateDelta): TurnEvent => ({
  kind: 'turn', input: 'x', mode: 'conversation', classification: 'NEUTRAL', roll: null, delta, prose: '',
});

test('initial state derives from the bible, not from anywhere else', () => {
  const b = goodBible();
  const s = initialState(b);
  assert.equal(s.beat, 'b1');
  assert.equal(s.clock, 3);
  assert.equal(s.location, 'clinic');
  assert.equal(s.pc.resources.time, START_TIME);
  assert.deepEqual(s.playerFacts, []);
  assert.equal(Object.keys(s.npcs).length, 3);
});

test('the fold is deterministic — same log, same state', () => {
  const b = goodBible();
  const log: GameEvent[] = [
    { kind: 'start' },
    turn({ clockSpend: 1, trust: { doctor: 2 } }),
    turn({ learnClues: ['c2'], clockSpend: 1 }),
    turn({ learnClues: ['c1'], clockSpend: 2, suspicion: 1 }),
    turn({ learnClues: ['c3'], clockSpend: 1 }),
  ];
  assert.deepEqual(fold(b, log), fold(b, log));
});

test('replaying a prefix then continuing equals replaying the whole log', () => {
  const b = goodBible();
  const log: GameEvent[] = [turn({ clockSpend: 1 }), turn({ learnClues: ['c2'] }), turn({ suspicion: 2, clockSpend: 1 })];
  const whole = fold(b, log);
  let s = fold(b, log.slice(0, 2));
  s = applyTurn(b, s, log[2] as TurnEvent).state;
  assert.deepEqual(s, whole);
});

test('beat advancement is computed from state, not decided by the model', () => {
  const b = goodBible();
  const s0 = initialState(b);
  const { state, effects } = applyTurn(b, s0, turn({ learnClues: ['c2'] }));
  assert.equal(effects.beatAdvanced, true);
  assert.equal(state.beat, 'b2');
  assert.equal(state.clock, 3, 'clock refills from the new beat leash');
});

test('learning several milestone clues at once cascades through beats', () => {
  const b = goodBible();
  const { state, effects } = applyTurn(b, initialState(b), turn({ learnClues: ['c2', 'c3', 'c4'] }));
  assert.equal(effects.beatAdvanced, true);
  assert.deepEqual(state.ended, { reason: 'solved' });
});

test('the leash fires a diegetic pressure move rather than blocking', () => {
  const b = goodBible();
  let s = initialState(b);
  let fired: string | null = null;
  for (let i = 0; i < 3; i++) {
    const r = applyTurn(b, s, turn({ clockSpend: 1 }));
    s = r.state;
    fired = r.effects.firedPressure;
  }
  assert.equal(fired, 'pressure-A for c2');
  assert.equal(s.pressureFired['b1'], 1);
  assert.equal(s.clock, 3, 'clock refills so the next pressure item can land later');
  assert.equal(s.ended, null, 'a miss must never be a dead end');
});

test('exhausting every pressure item ends the case on time', () => {
  const b = goodBible();
  let s = initialState(b);
  for (let i = 0; i < 12 && !s.ended; i++) s = applyTurn(b, s, turn({ clockSpend: 1 })).state;
  assert.equal(s.ended?.reason, 'out_of_time');
});

test('trust clamps to its band and never escapes', () => {
  const b = goodBible();
  let s = initialState(b);
  s = applyTurn(b, s, turn({ trust: { doctor: 99 } })).state;
  assert.equal(s.npcs['doctor'].trust, 4);
  s = applyTurn(b, s, turn({ trust: { doctor: -99 } })).state;
  assert.equal(s.npcs['doctor'].trust, -3);
});

test('the Director cannot invent clues that are not in the bible', () => {
  const b = goodBible();
  const { state, effects } = applyTurn(b, initialState(b), turn({ learnClues: ['c2', 'not_a_real_clue'] }));
  assert.deepEqual(state.playerFacts, ['c2']);
  assert.deepEqual(effects.learned, ['c2']);
});

test('relearning a clue is a no-op', () => {
  const b = goodBible();
  let s = initialState(b);
  s = applyTurn(b, s, turn({ learnClues: ['c1'] })).state;
  const r = applyTurn(b, s, turn({ learnClues: ['c1'] }));
  assert.deepEqual(r.effects.learned, []);
  assert.deepEqual(r.state.playerFacts, ['c1']);
});

test('an ended session is sticky', () => {
  const b = goodBible();
  let s = applyTurn(b, initialState(b), turn({ learnClues: ['c2', 'c3', 'c4'] })).state;
  const before = structuredClone(s);
  s = applyTurn(b, s, turn({ learnClues: ['c1'], suspicion: 5 })).state;
  assert.deepEqual(s, before, 'no further turns may mutate a finished session');
});

test('resources never go negative', () => {
  const b = goodBible();
  let s = initialState(b);
  s = applyTurn(b, s, turn({ cash: -500, suspicion: -500 })).state;
  assert.equal(s.pc.resources.cash, 0);
  assert.equal(s.pc.resources.suspicion, 0);
});
