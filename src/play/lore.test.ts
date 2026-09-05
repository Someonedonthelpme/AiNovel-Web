import test from 'node:test';
import assert from 'node:assert/strict';
import {
  knowsLore, learn, MOVING_DEPTH, resonanceOf, SHARED_COMPANY, tell, unreachableWants,
} from './lore.ts';
import type { Lore } from './lore.ts';
import { clampNeeds, emptyPersona, NEED_MAX } from '../character/persona.ts';
import type { Persona } from '../character/persona.ts';
import { defaultVoice } from '../world/fixtures.ts';
import { subjectsFor, SUBJECT_KINDS } from '../world/subjects.ts';

const who = (over: Partial<Persona> = {}): Persona => ({
  ...emptyPersona(defaultVoice()),
  drive: { want: 'sub_1', fear: 'sub_2' },
  needs: clampNeeds({ purpose: 4, company: 4 }),
  ...over,
});

const lore = (over: Partial<Lore> = {}): Lore =>
  ({ id: 'l1', text: '', about: ['sub_1'], depth: 1, ...over });

/* -------------------------------------------------------------------------- */
/* A world's subjects                                                          */
/* -------------------------------------------------------------------------- */

test('a world mints its own subjects, and the same seed mints the same ones', () => {
  assert.deepEqual(subjectsFor(7), subjectsFor(7));
  assert.notDeepEqual(subjectsFor(7).map((s) => s.name), subjectsFor(99).map((s) => s.name));
});

test('kinds are dealt, so a world uses every kind before repeating one', () => {
  const kinds = subjectsFor(42).map((s) => s.kind);
  assert.equal(new Set(kinds).size, Math.min(kinds.length, SUBJECT_KINDS.length));
});

test('no two subjects share a name', () => {
  const names = subjectsFor(11).map((s) => s.name);
  assert.equal(new Set(names).size, names.length, 'two subjects under one label are one subject');
});

/* -------------------------------------------------------------------------- */
/* What lore means to somebody                                                 */
/* -------------------------------------------------------------------------- */

test('lore about nothing you care for does nothing', () => {
  assert.equal(resonanceOf(lore({ about: ['sub_9'] }), who()).hit, false);
});

test('the same history moves one person and not another', () => {
  // The whole point: an item can matter for a reason its numbers do not say.
  const moved = resonanceOf(lore(), who());
  const indifferent = resonanceOf(lore(), who({ drive: { want: 'sub_7', fear: 'sub_8' } }));
  assert.equal(moved.hit, true);
  assert.equal(indifferent.hit, false);
});

test('a want is worth more than a fear, but a fear still counts', () => {
  const wanted = resonanceOf(lore({ about: ['sub_1'] }), who());
  const feared = resonanceOf(lore({ about: ['sub_2'] }), who());
  assert.ok(wanted.purpose > feared.purpose);
  assert.equal(feared.hit, true, 'what you ran from is still about you');
});

test('depth is how much of a thing it is', () => {
  const passing = resonanceOf(lore({ depth: 1 }), who());
  const whole = resonanceOf(lore({ depth: 3 }), who());
  assert.ok(whole.purpose > passing.purpose);
});

test('only a DEEP match moves who somebody is', () => {
  assert.deepEqual(resonanceOf(lore({ depth: 1 }), who()).pressure, {});
  assert.ok(Object.keys(resonanceOf(lore({ depth: MOVING_DEPTH }), who()).pressure).length > 0);
});

test('a deep truth about what you feared steadies you less than one about what you wanted', () => {
  const wanted = resonanceOf(lore({ about: ['sub_1'], depth: 3 }), who());
  const feared = resonanceOf(lore({ about: ['sub_2'], depth: 3 }), who());
  assert.ok((wanted.pressure.nerve ?? 0) > (feared.pressure.nerve ?? 0));
});

test('somebody with no drive is moved by nothing', () => {
  assert.equal(resonanceOf(lore(), who({ drive: undefined })).hit, false);
});

/* -------------------------------------------------------------------------- */
/* Learning                                                                    */
/* -------------------------------------------------------------------------- */

test('learning meets purpose, and is remembered', () => {
  const before = who();
  const after = learn(before, lore());
  assert.equal(after.wasNew, true);
  assert.ok(after.who.needs.purpose > before.needs.purpose);
  assert.equal(knowsLore(after.who, 'l1'), true);
});

test('the same paragraph cannot be read twice for the same comfort', () => {
  const once = learn(who(), lore()).who;
  const twice = learn(once, lore());
  assert.equal(twice.wasNew, false);
  assert.equal(twice.who.needs.purpose, once.needs.purpose, 'nothing to farm here');
});

test('purpose never exceeds met', () => {
  const full = who({ needs: clampNeeds({ purpose: NEED_MAX }) });
  assert.equal(learn(full, lore({ depth: 3 })).who.needs.purpose, NEED_MAX);
});

test('learning something that means nothing still counts as knowing it', () => {
  // You have read it. You simply were not moved — and you can still tell it on.
  const after = learn(who(), lore({ about: ['sub_9'] }));
  assert.equal(after.resonance.hit, false);
  assert.equal(knowsLore(after.who, 'l1'), true);
});

/* -------------------------------------------------------------------------- */
/* Telling                                                                     */
/* -------------------------------------------------------------------------- */

test('telling meets company on BOTH sides', () => {
  const teller = learn(who(), lore()).who;
  const listener = who({ drive: { want: 'sub_1', fear: 'sub_5' } });
  const out = tell(teller, listener, lore());

  assert.equal(out.told, true);
  assert.equal(out.teller.needs.company, teller.needs.company + SHARED_COMPANY);
  assert.equal(out.listener.needs.company, listener.needs.company + SHARED_COMPANY);
});

test('the listener gains what it means to THEM, which may be nothing', () => {
  // The asymmetry is the point: a history that moved you may bore the person
  // you hand it to — but the company still counts for both.
  const teller = learn(who(), lore()).who;
  const bored = who({ drive: { want: 'sub_7', fear: 'sub_8' }, needs: clampNeeds({ purpose: 4, company: 4 }) });
  const out = tell(teller, bored, lore());

  assert.equal(out.resonance.hit, false);
  assert.equal(out.listener.needs.purpose, 4, 'it did not touch them');
  assert.ok(out.listener.needs.company > 4, 'but being told something did');
});

test('you cannot tell what you do not know', () => {
  assert.equal(tell(who(), who(), lore()).told, false);
});

test('telling somebody what they already know is not telling them anything', () => {
  const teller = learn(who(), lore()).who;
  const listener = learn(who(), lore()).who;
  assert.equal(tell(teller, listener, lore()).told, false);
});

/* -------------------------------------------------------------------------- */
/* The proof                                                                   */
/* -------------------------------------------------------------------------- */

test('every want a world can hand out must have lore that speaks to it', () => {
  // The reason the vocabulary is generated per world rather than free text:
  // drives and lore come from the SAME pool, so this is provable rather than
  // hoped for — the same argument `admissible` makes for Signets.
  const subjects = subjectsFor(3);
  const catalogue = subjects.map((s, i) => lore({ id: `l${i}`, about: [s.id] }));
  assert.deepEqual(unreachableWants(subjects, catalogue), []);
});

test('and a subject nothing speaks to is reported, not silently unreachable', () => {
  const subjects = subjectsFor(3);
  const partial = subjects.slice(1).map((s, i) => lore({ id: `l${i}`, about: [s.id] }));
  assert.deepEqual(unreachableWants(subjects, partial), [subjects[0].id]);
});
