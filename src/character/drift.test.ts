import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDrift, describeChanges, PERSONALITY_THRESHOLD } from './drift.ts';
import type { DriftCause } from './drift.ts';
import { clampPersonality, emptyPersona, neutralPersonality, restingMind } from './persona.ts';
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
/* The fast clock                                                              */
/* -------------------------------------------------------------------------- */

test('state of mind moves immediately', () => {
  const r = applyDrift(persona(), [{ kind: 'check', tier: 'miss' }]);
  assert.equal(r.persona.mental.stress, 1);
  assert.equal(r.persona.mental.morale, -1);
});

test('succeeding steadies you; failing wears you down', () => {
  const won = applyDrift(persona({ mental: { stress: 4, morale: 0, fatigue: 0 } }), [{ kind: 'check', tier: 'hit' }]);
  assert.equal(won.persona.mental.stress, 3);
  assert.equal(won.persona.mental.morale, 1);
});

test('mental state stays inside its bounds however bad the day', () => {
  const r = repeat(persona(), { kind: 'check', tier: 'miss' }, 40);
  assert.equal(r.persona.mental.stress, 10, 'stress caps');
  assert.equal(r.persona.mental.morale, -3, 'morale bottoms out on the same band as trust');
});

test('rest recovers what danger costs', () => {
  const worn = applyDrift(persona(), [{ kind: 'danger', level: 12 }, { kind: 'travel', cost: 3 }]);
  assert.ok(worn.persona.mental.stress > 0);
  assert.ok(worn.persona.mental.fatigue > 0);

  const rested = applyDrift(worn.persona, [{ kind: 'rest', quality: 3 }]);
  assert.ok(rested.persona.mental.stress < worn.persona.mental.stress);
  assert.ok(rested.persona.mental.fatigue < worn.persona.mental.fatigue);
});

test('fatigue never goes negative from over-resting', () => {
  const r = applyDrift(persona(), [{ kind: 'rest', quality: 9 }]);
  assert.equal(r.persona.mental.fatigue, 0);
  assert.equal(r.persona.mental.stress, 0);
});

/* -------------------------------------------------------------------------- */
/* The slow clock                                                              */
/* -------------------------------------------------------------------------- */

test('one rude exchange does not change who someone is', () => {
  // The whole point of hysteresis: a character is not a mood ring.
  const r = applyDrift(persona(), [{ kind: 'address', tone: 'crude' }]);
  assert.deepEqual(r.changed, []);
  assert.deepEqual(r.persona.personality, neutralPersonality());
});

test('being spoken to badly, again and again, eventually hardens someone', () => {
  const r = repeat(persona(), { kind: 'address', tone: 'crude' }, 8);
  assert.ok(r.changes.some((c) => c.axis === 'warmth' && c.to < c.from), 'warmth should have fallen');
  assert.ok(r.persona.personality.warmth < 0);
});

test('disposition moves one step at a time, however hard it is pushed', () => {
  const r = applyDrift(persona({ pressure: clampPersonality({ warmth: 3 }) }), [
    { kind: 'trust', change: 1 }, { kind: 'trust', change: 1 }, { kind: 'trust', change: 1 },
    { kind: 'trust', change: 1 }, { kind: 'trust', change: 1 }, { kind: 'trust', change: 1 },
  ]);
  const warmth = r.changed.filter((c) => c.axis === 'warmth');
  assert.equal(warmth.length, 1, 'a single turn cannot rewrite a personality');
  assert.equal(r.persona.personality.warmth, 1);
});

test('pressure bleeds off, so isolated moments never accumulate', () => {
  let current = persona();
  // One slight, then a long stretch of nothing.
  current = applyDrift(current, [{ kind: 'address', tone: 'crude' }]).persona;
  const after = repeat(current, { kind: 'travel', cost: 1 }, 6);
  assert.equal(after.persona.pressure.warmth, 0, 'the grudge faded');
  assert.deepEqual(after.changes.filter((c) => c.axis === 'warmth'), []);
});

test('someone already at the extreme does not fire a change every turn', () => {
  const devoted = persona({ personality: clampPersonality({ loyalty: 3 }) });
  const r = repeat(devoted, { kind: 'trust', change: 2 }, 30);
  assert.equal(r.persona.personality.loyalty, 3, 'still capped');
  assert.deepEqual(r.changes.filter((c) => c.axis === 'loyalty'), [], 'and silent about it');
});

test('the threshold is what stops a character flipping scene to scene', () => {
  const justUnder = repeat(persona(), { kind: 'address', tone: 'crude' }, 2);
  assert.deepEqual(justUnder.changes, [], `two slights should not cross ${PERSONALITY_THRESHOLD}`);
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

test('a shifted disposition reads as something that happened, not a number', () => {
  const said = describeChanges([
    { axis: 'warmth', from: 1, to: 0 },
    { axis: 'loyalty', from: 0, to: 1 },
  ]);
  assert.deepEqual(said, ['has grown colder toward you', 'is more committed to you than before']);
});

test('kindness and cruelty push warmth in opposite directions', () => {
  const kind = repeat(persona(), { kind: 'trust', change: 1 }, 8);
  const cruel = repeat(persona(), { kind: 'trust', change: -1 }, 8);
  assert.ok(kind.persona.personality.warmth > 0);
  assert.ok(cruel.persona.personality.warmth < 0);
});

test('a deep floor wears down nerve even when nothing attacks you', () => {
  const shallow = repeat(persona(), { kind: 'danger', level: 2 }, 8);
  const deep = repeat(persona(), { kind: 'danger', level: 20 }, 8);
  assert.equal(shallow.persona.personality.nerve, 0);
  assert.ok(deep.persona.personality.nerve < 0, 'the tower itself should mark people');
});
