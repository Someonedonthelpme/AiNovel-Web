import test from 'node:test';
import assert from 'node:assert/strict';
import { applyNames, nameSubjects } from './subjectnames.ts';
import { subjectsFor, subjectsOf } from './subjects.ts';
import { FakeProvider } from '../llm/provider.ts';

const base = () => subjectsFor(3);

test('the world supplies the words, and the code keeps the ids', () => {
  // The mechanical guarantee: naming is COSMETIC. A drive chosen before naming
  // and a history written after it still point at the same thing.
  const before = base();
  const after = applyNames(before, before.map((s) => ({ id: s.id, name: `the ${s.id} thing` })));

  assert.deepEqual(after.map((s) => s.id), before.map((s) => s.id));
  assert.deepEqual(after.map((s) => s.kind), before.map((s) => s.kind));
  assert.notDeepEqual(after.map((s) => s.name), before.map((s) => s.name));
});

test('a subject the model did not name keeps its fallback', () => {
  const before = base();
  const after = applyNames(before, [{ id: before[0].id, name: 'the flood' }]);
  assert.equal(after[0].name, 'the flood');
  assert.equal(after[1].name, before[1].name, 'the rest are untouched');
});

test('an empty or whitespace name is not a name', () => {
  const before = base();
  const after = applyNames(before, [{ id: before[0].id, name: '   ' }]);
  assert.equal(after[0].name, before[0].name);
});

test('a name for a subject this world does not have is ignored', () => {
  const before = base();
  const after = applyNames(before, [{ id: 'sub_9999', name: 'the invented thing' }]);
  assert.deepEqual(after.map((s) => s.name), before.map((s) => s.name));
});

test('two subjects are never given the same name', () => {
  // Two subjects under one label are one subject, and the whole point of the
  // vocabulary is that a want and a history can be told apart.
  const before = base();
  const after = applyNames(before, before.map((s) => ({ id: s.id, name: 'the flood' })));
  const names = after.map((s) => s.name.toLowerCase());
  assert.equal(new Set(names).size, names.length);
  assert.equal(after[0].name, 'the flood', 'the first claim wins');
});

test('a world that has been named keeps its words; one that has not falls back', () => {
  const named = applyNames(base(), [{ id: 'sub_0', name: 'the flood' }]);
  assert.equal(subjectsOf({ seed: 3, subjects: named })[0].name, 'the flood');
  assert.equal(subjectsOf({ seed: 3 })[0].name, base()[0].name, 'unnamed worlds still have subjects');
});

/* -------------------------------------------------------------------------- */
/* The call                                                                    */
/* -------------------------------------------------------------------------- */

test('the model is given the kinds and asked only for words', async () => {
  const p = new FakeProvider({ structured: [{ subjects: [] }] });
  await nameSubjects(p, base(), 'a drowned coast of rusted freeways', 'en');

  const sent = p.allSentText();
  assert.match(sent, /drowned coast/, 'it is told what the world is');
  assert.match(sent, /sub_0/, 'and which ids to answer for');
  assert.match(sent, /a war|a house|a craft|a place/, 'and the kind of each');
});

test('a model that returns nothing usable costs a world nothing but duller words', async () => {
  const p = new FakeProvider({ structured: [{ subjects: [] }] });
  assert.deepEqual(await nameSubjects(p, base(), 'anywhere', 'en'), base());
});

test('a model that fails outright is survivable', async () => {
  // A creation that will not finish because a model was down is a far worse
  // failure than a world whose subjects have generic names.
  const broken = new FakeProvider({ structured: [] });
  const out = await nameSubjects(broken, base(), 'anywhere', 'en');
  assert.equal(out.length, base().length);
  assert.deepEqual(out.map((s) => s.id), base().map((s) => s.id));
});
