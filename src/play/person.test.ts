import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeProvider } from '../llm/provider.ts';
import { directorOutput, playState } from './fixtures.ts';
import { playTurn } from './turn.ts';
import { validateDelta } from './delta.ts';
import { person } from '../world/fixtures.ts';
import type { PlayState } from './state.ts';

/*
 * A person the model NAMES is resolved to who they are (approved 2026-09-19).
 * Live, nine "helped" deeds in ten and every trust change were refused as
 * "no such person": the Director wrote "Kaelen Gearwright", "KaelenGearwright"
 * and "Silas" where the engine wanted an id — so helping somebody earned nothing,
 * and an unresolved `addressed` left the Writer with no speaker to bind a
 * register to. The vocabulary stays closed: only people who exist resolve.
 */

const inTown = (): PlayState => playState({ currentPlace: 'town' });
const twoNamedAlike = (): PlayState => {
  const s = inTown();
  return { ...s, world: { ...s.world, people: {
    ...s.world.people,
    ora1: person('ora1', { name: 'Ora' }),
    ora2: person('ora2', { name: 'Ora' }),
  } } };
};

test('a name is resolved to its person', () => {
  assert.deepEqual(validateDelta(inTown(), { trust: { 'Warden Bex': 1 } }).delta.trust, { warden: 1 });
  assert.deepEqual(validateDelta(inTown(), { deed: { kind: 'helped', toward: 'wardenbex' } }).delta.deed, { kind: 'helped', toward: 'warden' });
});

test('an id still works, and a stranger is still refused', () => {
  assert.deepEqual(validateDelta(inTown(), { trust: { warden: 1 } }).delta.trust, { warden: 1 });
  assert.match(validateDelta(inTown(), { trust: { 'Nobody Atall': 1 } }).rejected.join(' '), /no such person/);
});

test('an ambiguous name is refused, not guessed', () => {
  assert.match(validateDelta(twoNamedAlike(), { trust: { Ora: 1 } }).rejected.join(' '), /ambiguous/);
});

test('the addressed person resolves too, so the register binds to them', async () => {
  const deps = {
    director: new FakeProvider({ structured: [directorOutput({ addressedPerson: 'Warden Bex' })] }),
    writer: new FakeProvider({ text: ['"ครับ ผมเข้าใจครับ"'] }),
    rng: () => 0.5,
  };
  const r = await playTurn(deps, inTown(), 'good morning', 'conversation', []);
  assert.equal(r.record.addressed, 'warden');
});
