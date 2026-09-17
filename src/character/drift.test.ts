import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDrift, describeChanges, PERSONALITY_THRESHOLD } from './drift.ts';
import type { DriftCause } from './drift.ts';
import { NEED_MAX, clampNeeds, clampTemperament, emptyPersona, metNeeds, neutralTemperament } from './persona.ts';
import type { Persona } from './persona.ts';
import { defaultVoice } from '../world/fixtures.ts';

const persona = (over: Partial<Persona> = {}): Persona => ({ ...emptyPersona(defaultVoice()), ...over });

/** Apply the same thing repeatedly, as a relationship actually would. */
function repeat(start: Persona, cause: DriftCause, times: number) {
  let current = start;
  const changes = [];
  for (let i = 0; i < times; i++) {
    const result = applyDrift(current, [cause]);
    current = result.persona;
    changes.push(...result.changed);
  }
  return { persona: current, changes };
}

/* -------------------------------------------------------------------------- */
/* The fast clock: needs                                                       */
/* -------------------------------------------------------------------------- */

test('needs move immediately', () => {
  const r = applyDrift(persona(), [{ kind: 'check', tier: 'miss' }]);
  assert.equal(r.persona.needs.safety, NEED_MAX - 1);
  assert.equal(r.persona.needs.purpose, NEED_MAX - 1);
});

test('succeeding steadies you; failing wears you down', () => {
  const worn = persona({ needs: clampNeeds({ safety: 4, purpose: 4 }) });
  const won = applyDrift(worn, [{ kind: 'check', tier: 'hit' }]);
  assert.equal(won.persona.needs.safety, 5);
  assert.equal(won.persona.needs.purpose, 5);
});

test('needs stay inside their bounds however bad the day', () => {
  const r = repeat(persona(), { kind: 'check', tier: 'miss' }, 40);
  assert.equal(r.persona.needs.safety, 0, 'safety bottoms out rather than going negative');
  assert.equal(r.persona.needs.purpose, 0);
});

// Respecified by 7.1e-iv: `travel` became `time`, the hour marks a turn crossed.
test('rest recovers what danger and time cost', () => {
  const worn = applyDrift(persona(), [{ kind: 'danger', level: 12 }, { kind: 'time', food: 1, rest: 3 }]);
  assert.ok(worn.persona.needs.safety < NEED_MAX, 'danger costs safety');
  assert.ok(worn.persona.needs.rest < NEED_MAX, 'time awake costs rest');

  const rested = applyDrift(worn.persona, [{ kind: 'rest', quality: 3 }]);
  assert.ok(rested.persona.needs.safety > worn.persona.needs.safety);
  assert.ok(rested.persona.needs.rest > worn.persona.needs.rest);
});

test('a need never exceeds met, however long you sleep', () => {
  const r = applyDrift(persona(), [{ kind: 'rest', quality: 9 }]);
  assert.equal(r.persona.needs.rest, NEED_MAX);
  assert.equal(r.persona.needs.safety, NEED_MAX);
});

test('making camp feeds you, but it does not keep you company', () => {
  // A short rest spends a ration, so food belongs to resting rather than to a
  // cause of its own. Company does not: sleeping is not a friend.
  const hungry = persona({ needs: clampNeeds({ food: 2, company: 2 }) });
  const r = applyDrift(hungry, [{ kind: 'rest', quality: 3 }]);
  assert.ok(r.persona.needs.food > 2, 'you eat when you make camp');
  assert.equal(r.persona.needs.company, 2, 'nor is it a friend');
});

/* -------------------------------------------------------------------------- */
/* The slow clock: temperament                                                 */
/* -------------------------------------------------------------------------- */

test('one rude exchange does not change who someone is', () => {
  // The whole point of hysteresis: a character is not a mood ring.
  const r = applyDrift(persona(), [{ kind: 'address', tone: 'crude' }]);
  assert.deepEqual(r.changed, []);
  assert.deepEqual(r.persona.temperament, neutralTemperament());
});

test('being spoken to badly, again and again, eventually hardens someone', () => {
  const r = repeat(persona(), { kind: 'address', tone: 'crude' }, 8);
  assert.ok(r.changes.some((c) => c.axis === 'feeling' && c.to < c.from), 'feeling should have fallen');
  assert.ok(r.persona.temperament.feeling < 0);
});

test('temperament moves one step at a time, however hard it is pushed', () => {
  const r = applyDrift(persona({ pressure: clampTemperament({ feeling: 3 }) }), [
    { kind: 'trust', change: 1 }, { kind: 'trust', change: 1 }, { kind: 'trust', change: 1 },
    { kind: 'trust', change: 1 }, { kind: 'trust', change: 1 }, { kind: 'trust', change: 1 },
  ]);
  const feeling = r.changed.filter((c) => c.axis === 'feeling');
  assert.equal(feeling.length, 1, 'a single turn cannot rewrite a personality');
  assert.equal(r.persona.temperament.feeling, 1);
});

test('pressure bleeds off, so isolated moments never accumulate', () => {
  let current = persona();
  // One slight, then a long stretch of nothing.
  current = applyDrift(current, [{ kind: 'address', tone: 'crude' }]).persona;
  // Respecified by 7.1e-iv: `travel` became `time`, the hour marks a turn crossed.
  const after = repeat(current, { kind: 'time', food: 0, rest: 0 }, 6);
  assert.equal(after.persona.pressure.feeling, 0, 'the grudge faded');
  assert.deepEqual(after.changes.filter((c) => c.axis === 'feeling'), []);
});

test('someone already at the extreme does not fire a change every turn', () => {
  const settled = persona({ temperament: clampTemperament({ feeling: 10 }) });
  const r = repeat(settled, { kind: 'trust', change: 2 }, 30);
  assert.equal(r.persona.temperament.feeling, 10, 'still capped');
  assert.deepEqual(r.changes.filter((c) => c.axis === 'feeling'), [], 'and silent about it');
});

test('the threshold is what stops a character flipping scene to scene', () => {
  const justUnder = repeat(persona(), { kind: 'address', tone: 'crude' }, 2);
  assert.deepEqual(justUnder.changes, [], 'two slights should not cross the threshold');
  assert.ok(PERSONALITY_THRESHOLD > 2);
});

test('the wide scale makes drift gradual rather than a sixth of a person', () => {
  // On the old -3..+3 range one step was a sixth of the whole range.
  const r = repeat(persona(), { kind: 'address', tone: 'crude' }, 8);
  assert.equal(r.persona.temperament.feeling, -1, 'one crossing, one point out of ten');
});

test('drift is deterministic', () => {
  const causes: DriftCause[] = [
    { kind: 'check', tier: 'partial' }, { kind: 'trust', change: -1 }, { kind: 'danger', level: 6 },
  ];
  assert.deepEqual(applyDrift(persona(), causes), applyDrift(persona(), causes));
});

test('nothing happening changes nothing', () => {
  const before = persona();
  const r = applyDrift(before, []);
  assert.deepEqual(r.persona, before);
  assert.deepEqual(r.changed, []);
});

/* -------------------------------------------------------------------------- */
/* Narration                                                                   */
/* -------------------------------------------------------------------------- */

test('a shifted temperament reads as something that happened, not a number', () => {
  const said = describeChanges([
    { axis: 'nerve', from: 1, to: 0 },
    { axis: 'discipline', from: 0, to: 1 },
  ]);
  assert.deepEqual(said, ['is losing their nerve', 'has tightened their grip on themselves']);
});

test('kindness and cruelty push in opposite directions', () => {
  const kind = repeat(persona(), { kind: 'trust', change: 1 }, 8);
  const cruel = repeat(persona(), { kind: 'trust', change: -1 }, 8);
  assert.ok(kind.persona.temperament.feeling > 0);
  assert.ok(cruel.persona.temperament.feeling < 0);
});

test('kindness meets the need other people exist to meet', () => {
  const alone = persona({ needs: clampNeeds({ company: 2 }) });
  const r = applyDrift(alone, [{ kind: 'trust', change: 1 }]);
  assert.ok(r.persona.needs.company > 2);
});

test('a deep floor wears down nerve even when nothing attacks you', () => {
  const shallow = repeat(persona(), { kind: 'danger', level: 2 }, 8);
  const deep = repeat(persona(), { kind: 'danger', level: 20 }, 8);
  assert.equal(shallow.persona.temperament.nerve, 0);
  assert.ok(deep.persona.temperament.nerve < 0, 'the tower itself should mark people');
});

test('a persona untouched by drift keeps every need met', () => {
  assert.deepEqual(applyDrift(persona(), []).persona.needs, metNeeds());
});
