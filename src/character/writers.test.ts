import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDrift } from './drift.ts';
import type { DriftCause } from './drift.ts';
import { NEEDS, TEMPERAMENT, clampNeeds, emptyPersona } from './persona.ts';
import type { Need, Persona, TemperamentAxis } from './persona.ts';
import { defaultVoice } from '../world/fixtures.ts';

/**
 * EVERY STORED FIELD HAS A WRITER.
 *
 * The generalisation of the counter-writer proof in `counters.test.ts`, and the
 * single most useful test in this codebase. Its history is a list of fields that
 * were generated, stored, displayed — and moved by nothing:
 *
 *   `people_met`            a counter with no writer
 *   `sheet.mental`          gated nothing at all until the pools read it
 *   `Signet.grant`          generated and read by nobody, three commits running
 *   `agenda.ts`             complete, correct, imported by nobody
 *   `Gazetteer.openThreads` read by the rehydration prompt, written by nothing
 *   `Gazetteer.reputation`  defaulted to 0 and never touched
 *   `personality.loyalty`   documented as deciding whether an order is obeyed;
 *                           nothing ever asked
 *
 * A field nothing writes is worse than a missing one: it looks like a mechanic,
 * it survives review, and it quietly does nothing for months.
 *
 * This test caught two of its own the moment it was written — `intuition` and
 * `discipline` were introduced as temperament axes that no `DriftCause` pushed.
 */

const persona = (over: Partial<Persona> = {}): Persona => ({ ...emptyPersona(defaultVoice()), ...over });

/** Everything the engine can actually emit, at the magnitudes it emits them. */
const EVERY_CAUSE: DriftCause[] = [
  { kind: 'check', tier: 'hit' },
  { kind: 'check', tier: 'partial' },
  { kind: 'check', tier: 'miss' },
  { kind: 'trust', change: 1 },
  { kind: 'trust', change: -1 },
  { kind: 'address', tone: 'crude' },
  { kind: 'address', tone: 'formal' },
  { kind: 'travel', cost: 4 },
  { kind: 'danger', level: 12 },
  { kind: 'rest', quality: 3 },
];

/** Start mid-range so a need can be seen moving in either direction. */
const midway = () => persona({ needs: clampNeeds({ rest: 5, food: 5, safety: 5, company: 5, purpose: 5 }) });

test('every NEED is moved by something that can actually happen', () => {
  const unwritten: Need[] = [];

  for (const need of NEEDS) {
    const moved = EVERY_CAUSE.some((cause) => applyDrift(midway(), [cause]).persona.needs[need] !== 5);
    if (!moved) unwritten.push(need);
  }

  assert.deepEqual(unwritten, [], 'these needs are stored, shown, and moved by nothing');
});

test('every need can be both worn down and restored', () => {
  // A need that only ever falls is a countdown, not a need.
  const oneWay: string[] = [];

  for (const need of NEEDS) {
    const fell = EVERY_CAUSE.some((c) => applyDrift(midway(), [c]).persona.needs[need] < 5);
    const rose = EVERY_CAUSE.some((c) => applyDrift(midway(), [c]).persona.needs[need] > 5);
    if (!fell) oneWay.push(`${need} never falls`);
    if (!rose) oneWay.push(`${need} never recovers`);
  }

  assert.deepEqual(oneWay, [], 'a need must be able to move in both directions');
});

test('every TEMPERAMENT axis is pushed by something', () => {
  const unwritten: TemperamentAxis[] = [];

  for (const axis of TEMPERAMENT) {
    const pushed = EVERY_CAUSE.some((cause) => applyDrift(persona(), [cause]).persona.pressure[axis] !== 0);
    if (!pushed) unwritten.push(axis);
  }

  assert.deepEqual(unwritten, [], 'these axes are stored and drift can never change them');
});

test('every temperament axis can be pushed in both directions', () => {
  // An axis that only ever rises is a ratchet: every character in the world
  // ends up at the same extreme given enough turns.
  const oneWay: string[] = [];

  for (const axis of TEMPERAMENT) {
    const up = EVERY_CAUSE.some((c) => applyDrift(persona(), [c]).persona.pressure[axis] > 0);
    const down = EVERY_CAUSE.some((c) => applyDrift(persona(), [c]).persona.pressure[axis] < 0);
    if (!up) oneWay.push(`${axis} is never pushed up`);
    if (!down) oneWay.push(`${axis} is never pushed down`);
  }

  assert.deepEqual(oneWay, [], 'an axis that only moves one way is a ratchet, not a character');
});
