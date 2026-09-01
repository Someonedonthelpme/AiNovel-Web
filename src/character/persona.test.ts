import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AXES, bumpCounter, clampMental, clampPersonality, counterOf,
  describeMental, describePersonality, emptyPersona, neutralPersonality,
  registerTrust, restingMind,
} from './persona.ts';
import { defaultVoice } from '../world/fixtures.ts';

/* -------------------------------------------------------------------------- */
/* Personality                                                                 */
/* -------------------------------------------------------------------------- */

test('a neutral personality has every axis at zero', () => {
  const p = neutralPersonality();
  for (const axis of AXES) assert.equal(p[axis], 0, `${axis} was not neutral`);
});

test('axes are clamped into the same band trust uses', () => {
  const p = clampPersonality({ warmth: 99, nerve: -99, discipline: 2 });
  assert.equal(p.warmth, 3);
  assert.equal(p.nerve, -3);
  assert.equal(p.discipline, 2);
});

test('a missing or nonsensical axis defaults to neutral rather than NaN', () => {
  const p = clampPersonality({ warmth: Number.NaN, nerve: undefined } as never);
  assert.equal(p.warmth, 0);
  assert.equal(p.nerve, 0);
  assert.equal(p.loyalty, 0);
});

test('fractional axes are rounded', () => {
  assert.equal(clampPersonality({ candour: 1.6 }).candour, 2);
});

/* -------------------------------------------------------------------------- */
/* Mental state                                                                */
/* -------------------------------------------------------------------------- */

test('a rested mind is calm, level and unhurt', () => {
  assert.deepEqual(restingMind(), { stress: 0, morale: 0, fatigue: 0 });
});

test('mental state is clamped to its own ranges, not personality ranges', () => {
  const m = clampMental({ stress: 99, morale: 99, fatigue: -5 });
  assert.equal(m.stress, 10, 'stress runs 0..10');
  assert.equal(m.morale, 3, 'morale runs on the -3..+3 band');
  assert.equal(m.fatigue, 0, 'fatigue cannot go negative');
});

/* -------------------------------------------------------------------------- */
/* Counters                                                                    */
/* -------------------------------------------------------------------------- */

test('counters accumulate and read back', () => {
  let counters = bumpCounter({}, 'kills_beast');
  counters = bumpCounter(counters, 'kills_beast', 29);
  assert.equal(counterOf(counters, 'kills_beast'), 30, 'the tally a trait condition would check');
  assert.equal(counterOf(counters, 'never_happened'), 0);
});

test('bumping a counter does not mutate the original', () => {
  const before = { floors: 1 };
  bumpCounter(before, 'floors');
  assert.equal(before.floors, 1);
});

/* -------------------------------------------------------------------------- */
/* Description                                                                 */
/* -------------------------------------------------------------------------- */

test('only pronounced traits are worth saying', () => {
  const said = describePersonality({ warmth: -3, nerve: 3, discipline: 1, candour: 0, loyalty: 0 });
  assert.deepEqual(said, ['cold', 'bold'], 'a middling axis is not a character trait');
});

test('condition is described only when it is worth remarking on', () => {
  assert.deepEqual(describeMental(restingMind()), []);
  assert.deepEqual(describeMental({ stress: 8, morale: -2, fatigue: 5 }), [
    'badly rattled', 'tired', 'demoralised',
  ]);
});

/* -------------------------------------------------------------------------- */
/* Register — where personality becomes audible                                */
/* -------------------------------------------------------------------------- */

test('a warm person opens up sooner than the bare number says', () => {
  const warm = clampPersonality({ warmth: 3 });
  const cold = clampPersonality({ warmth: -3 });
  assert.ok(registerTrust(1, warm, restingMind()) > registerTrust(1, cold, restingMind()));
});

test('someone badly rattled retreats into formality', () => {
  const calm = registerTrust(2, neutralPersonality(), restingMind());
  const rattled = registerTrust(2, neutralPersonality(), { stress: 9, morale: 0, fatigue: 0 });
  assert.ok(rattled < calm, 'fear should pull the register back, not push it forward');
});

test('a neutral, calm person is read at their literal trust', () => {
  assert.equal(registerTrust(2, neutralPersonality(), restingMind()), 2);
});

test('warmth cannot swing the band more than one step', () => {
  // Disposition colours the relationship; it must not replace it.
  const shifted = registerTrust(0, clampPersonality({ warmth: 3 }), restingMind());
  assert.equal(shifted, 1);
});

test('an empty persona is usable and neutral', () => {
  const persona = emptyPersona(defaultVoice());
  assert.equal(persona.status, 'peer');
  assert.deepEqual(persona.personality, neutralPersonality());
  assert.deepEqual(persona.mental, restingMind());
  assert.deepEqual(persona.counters, {});
});
