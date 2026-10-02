import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmLasting } from './director.ts';
import { FakeProvider } from './provider.ts';
import { playState } from '../play/fixtures.ts';
import type { WorldDelta } from '../play/state.ts';

/*
 * The second-pass CHECK on lasting effects (DESIGN 6c 3k-ii, 2026-10-02). The Director has 25 required delta fields and
 * fills them on remarks that fit no option; a law verb, a collect and a deed are lasting state, so each is applied
 * only if one tiny separate call confirms the player's own words clearly do it. The real model is judged live; these
 * pin what the engine does with whatever answer comes back.
 */

const state = playState(); // 'smith' is "Ora the smith"
const SAID = 'I greet the smith and ask about the forge.';
const answering = (confirmed: unknown) => new FakeProvider({ structured: [{ confirmed }] });
const BOTH: WorldDelta = { adoptLaw: 'theft', deed: { kind: 'threatened', toward: 'smith' } };

test('a delta with no lasting field makes no call and comes back unchanged', async () => {
  const provider = answering([1]);
  const delta: WorldDelta = { moveTo: 'market', learnFacts: ['the forge runs at night'] };
  const out = await confirmLasting(provider, state, SAID, delta);
  assert.equal(provider.calls.length, 0);
  assert.deepEqual(out, { delta, refused: [] });
});

test('a confirmed effect is kept and an unconfirmed one dropped, with a note naming it', async () => {
  const out = await confirmLasting(answering([1]), state, SAID, BOTH);
  assert.equal(out.delta.adoptLaw, 'theft', 'the first effect was confirmed');
  assert.equal(out.delta.deed, undefined, 'the second was not');
  assert.equal(out.refused.length, 1);
  assert.match(out.refused[0], /not recorded/i);
  assert.match(out.refused[0], /Ora the smith/);
});

test('confirming nothing drops every lasting effect, and each drop is named', async () => {
  const out = await confirmLasting(answering([]), state, SAID, BOTH);
  assert.equal(out.delta.adoptLaw, undefined);
  assert.equal(out.delta.deed, undefined);
  assert.equal(out.refused.length, 2);
});

test('confirming everything changes nothing', async () => {
  const out = await confirmLasting(answering([1, 2]), state, SAID, BOTH);
  assert.deepEqual(out, { delta: BOTH, refused: [] });
});

test('a number that names no effect confirms nothing (no off-by-one, no duplicates)', async () => {
  const out = await confirmLasting(answering([7, 7, 0]), state, SAID, BOTH);
  assert.equal(out.delta.adoptLaw, undefined);
  assert.equal(out.delta.deed, undefined);
  assert.equal(out.refused.length, 2);
});

test('an unreadable answer or a failing call drops every lasting effect and says it could not check', async () => {
  for (const provider of [new FakeProvider({ structured: [{ nonsense: true }] }), new FakeProvider({}) /* throws */]) {
    const out = await confirmLasting(provider, state, SAID, BOTH);
    assert.equal(out.delta.adoptLaw, undefined);
    assert.equal(out.delta.deed, undefined);
    assert.equal(out.refused.length, 2);
    for (const note of out.refused) assert.match(note, /could not be checked/i);
  }
});

test('the prompt carries the player\'s words and one plain sentence per effect, and nothing else lasting', async () => {
  const provider = answering([1, 2, 3]);
  const delta: WorldDelta = {
    adoptLaw: 'theft', deed: { kind: 'threatened', toward: 'smith' },
    collect: { building: 'smithy-1', category: 'material' }, learnFacts: ['the forge runs at night'],
  };
  await confirmLasting(provider, state, SAID, delta);
  const sent = provider.allSentText();
  assert.match(sent, /I greet the smith and ask about the forge\./);
  assert.match(sent, /declare a law making theft a crime/i);
  assert.match(sent, /threaten Ora the smith/i);
  assert.match(sent, /take the material stored in smithy-1/i);
  assert.doesNotMatch(sent, /forge runs at night/, 'a fact is not a lasting effect and is not asked about');
});

test('everything that is not a lasting effect passes through untouched', async () => {
  const delta: WorldDelta = { ...BOTH, moveTo: 'market', learnFacts: ['x'], trust: { smith: 1 } };
  const out = await confirmLasting(answering([]), state, SAID, delta);
  assert.deepEqual(out.delta, { moveTo: 'market', learnFacts: ['x'], trust: { smith: 1 } });
});

test('repeal and succession are described and checked like the rest', async () => {
  const provider = answering([]);
  const out = await confirmLasting(provider, state, SAID, { repealLaw: 'assault', setSuccession: 'elective' });
  assert.match(provider.allSentText(), /repeal the law against assault/i);
  assert.match(provider.allSentText(), /elective/i);
  assert.equal(out.delta.repealLaw, undefined);
  assert.equal(out.delta.setSuccession, undefined);
  assert.equal(out.refused.length, 2);
});
