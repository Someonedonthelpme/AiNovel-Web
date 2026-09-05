import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AXES, NEEDS, NEED_MAX, TEMPERAMENT, bandOf, bumpCounter, clampNeeds, clampTemperament,
  counterOf, describeMental, describePersonality, dispositionOf, emptyPersona,
  metNeeds, neutralTemperament, registerTrust, unmet,
} from './persona.ts';
import { defaultVoice } from '../world/fixtures.ts';

const who = (temperament = {}, needs = {}) =>
  ({ temperament: clampTemperament(temperament), needs: clampNeeds(needs) });

/* -------------------------------------------------------------------------- */
/* Temperament — what is stored                                                */
/* -------------------------------------------------------------------------- */

test('a neutral temperament has every axis at zero', () => {
  const t = neutralTemperament();
  for (const axis of TEMPERAMENT) assert.equal(t[axis], 0, `${axis} was not neutral`);
});

test('temperament is stored wide, so drift has room to be gradual', () => {
  const t = clampTemperament({ intuition: 99, feeling: -99, nerve: 4 });
  assert.equal(t.intuition, 10);
  assert.equal(t.feeling, -10);
  assert.equal(t.nerve, 4, 'the wide scale is the point — 4 is not rounded to a band');
});

test('a missing or nonsensical axis defaults to neutral rather than NaN', () => {
  const t = clampTemperament({ intuition: Number.NaN, nerve: undefined } as never);
  assert.equal(t.intuition, 0);
  assert.equal(t.nerve, 0);
  assert.equal(t.discipline, 0);
});

test('the wide scale bands down to the narrow one a sentence is written on', () => {
  assert.equal(bandOf(10), 3);
  assert.equal(bandOf(-10), -3);
  assert.equal(bandOf(0), 0);
});

/* -------------------------------------------------------------------------- */
/* Needs — satisfaction, not deficit                                           */
/* -------------------------------------------------------------------------- */

test('a person on a good day has every need met', () => {
  const n = metNeeds();
  for (const need of NEEDS) assert.equal(n[need], NEED_MAX, `${need} was not met`);
});

test('needs are clamped to their own range', () => {
  const n = clampNeeds({ rest: 99, safety: -5 });
  assert.equal(n.rest, NEED_MAX);
  assert.equal(n.safety, 0);
});

test('unmet reports the shortfall anything costed reads', () => {
  assert.equal(unmet(clampNeeds({ rest: 4 }), 'rest'), 6);
  assert.equal(unmet(metNeeds(), 'rest'), 0);
});

/* -------------------------------------------------------------------------- */
/* Disposition — derived, never stored                                         */
/* -------------------------------------------------------------------------- */

test('disposition covers every axis a sentence or a trait can name', () => {
  const d = dispositionOf(who());
  for (const axis of AXES) assert.equal(typeof d[axis], 'number', `${axis} was not derived`);
});

test('warmth is values-led wiring plus the company you are actually getting', () => {
  const alone = dispositionOf(who({ feeling: 6 }, { company: 0 }));
  const kept = dispositionOf(who({ feeling: 6 }, { company: NEED_MAX }));
  assert.ok(kept.warmth > alone.warmth, 'the same person reads colder when nobody is around');
});

test('nerve is worn down by being unsafe, whatever you are made of', () => {
  const safe = dispositionOf(who({ nerve: 6 }, { safety: NEED_MAX }));
  const hunted = dispositionOf(who({ nerve: 6 }, { safety: 0 }));
  assert.ok(hunted.nerve < safe.nerve);
});

test('discipline frays when you have not slept', () => {
  const rested = dispositionOf(who({ discipline: 6 }, { rest: NEED_MAX }));
  const ragged = dispositionOf(who({ discipline: 6 }, { rest: 1 }));
  assert.ok(ragged.discipline < rested.discipline);
});

test('candour is the opposite of self-control, and only when it feels safe', () => {
  const guarded = dispositionOf(who({ discipline: 9 }, {}));
  const loose = dispositionOf(who({ discipline: -9 }, {}));
  assert.ok(loose.candour > guarded.candour);
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
  const said = describePersonality(dispositionOf(who({ nerve: 10 }, {})));
  assert.ok(said.includes('bold'), 'a pronounced axis should be said');
  assert.ok(!said.includes('imaginative'), 'a middling axis is not a character trait');
});

test('condition is described only when it is worth remarking on', () => {
  assert.deepEqual(describeMental(metNeeds()), ['in good heart']);
  assert.deepEqual(describeMental(clampNeeds({ safety: 2, rest: 5, food: 1 })), [
    'badly rattled', 'tired', 'starving',
  ]);
});

test('the scale finally has an upside half', () => {
  // The old stress/morale/fatigue triple could only ever report a deficit.
  assert.ok(describeMental(metNeeds()).length > 0, 'a person doing well should read as doing well');
});

/* -------------------------------------------------------------------------- */
/* Register — where personality becomes audible                                */
/* -------------------------------------------------------------------------- */

test('a warm person opens up sooner than the bare number says', () => {
  assert.ok(registerTrust(1, who({ feeling: 9 })) > registerTrust(1, who({ feeling: -9 })));
});

test('someone badly rattled retreats into formality', () => {
  const calm = registerTrust(2, who());
  const rattled = registerTrust(2, who({}, { safety: 1 }));
  assert.ok(rattled < calm, 'fear should pull the register back, not push it forward');
});

test('a neutral, contented person is read at their literal trust', () => {
  assert.equal(registerTrust(2, who()), 2);
});

test('warmth cannot swing the band more than one step', () => {
  // Disposition colours the relationship; it must not replace it.
  assert.equal(registerTrust(0, who({ feeling: 10 })), 1);
});

test('an empty persona is usable and neutral', () => {
  const persona = emptyPersona(defaultVoice());
  assert.equal(persona.status, 'peer');
  assert.deepEqual(persona.temperament, neutralTemperament());
  assert.deepEqual(persona.needs, metNeeds());
  assert.deepEqual(persona.counters, {});
});
