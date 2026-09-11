import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDrift } from './drift.ts';
import { emptyPersona, NEED_MAX } from './persona.ts';
import { defaultVoice } from '../world/fixtures.ts';
import { FOLK, readSpecies, speciesFor, speciesIdFor, TYPES } from './species.ts';
import { ABILITIES } from '../combat/types.ts';
import { FakeProvider } from '../llm/provider.ts';
import { runDirector } from '../llm/director.ts';
import { playState } from '../play/fixtures.ts';

const someone = () => emptyPersona(defaultVoice());

/** A hard march: the cause that takes food and rest off anybody who has them. */
const MARCH = [{ kind: 'travel' as const, cost: 3 }];

test('every world has the ordinary kind, and the rest are its own', () => {
  const kinds = speciesFor(11);
  assert.equal(kinds[0].id, FOLK.id, 'most people are ordinary, so the ordinary kind is always there');
  assert.deepEqual(speciesFor(11).map((k) => k.id), kinds.map((k) => k.id), 'the same seed, the same world');
  assert.equal(new Set(kinds.map((k) => k.id)).size, kinds.length, 'no kind is dealt twice');
});

test('no species is simply stronger — every template sums to zero, and they differ', () => {
  const seen = new Set<string>();
  for (let seed = 0; seed < 50; seed++) {
    for (const s of speciesFor(seed)) {
      assert.ok(TYPES.some((t) => t.id === s.type), `seed ${seed}: ${s.id} has no known type`);
      const total = ABILITIES.reduce((sum, a) => sum + (s.template[a] ?? 0), 0);
      assert.equal(total, 0, `seed ${seed}: ${s.id} sums to ${total}`);
      seen.add(JSON.stringify(s.template));
    }
  }
  assert.ok(seen.size > 8, 'templates must actually differ, not all be zero');
});

test('a world stored before types reads exactly as one dealt today', () => {
  for (let seed = 0; seed < 50; seed++) {
    for (const s of speciesFor(seed)) {
      const { type, template, ...stored } = s;   // what an older world saved
      assert.deepEqual(readSpecies(seed, stored), s, `seed ${seed}: ${s.id}`);
    }
  }
});

test('an untyped species nobody ever stored is refused, not guessed', () => {
  assert.throws(() => readSpecies(1, { id: 'gnoll', name: 'gnolls' }), /gnoll/);
});

test('a construct does not eat', () => {
  // The whole point of the axis, and the reason it is a MULTIPLIER on the one
  // place needs move rather than a special case anywhere else.
  const made = { id: 'made', name: 'the made', needs: { food: 0 } };

  const ordinary = applyDrift(someone(), MARCH).persona;
  assert.ok(ordinary.needs.food < NEED_MAX, 'an ordinary person marches on their stomach');

  const construct = applyDrift(someone(), MARCH, undefined, made).persona;
  assert.equal(construct.needs.food, NEED_MAX, 'and a construct has no stomach to march on');
  assert.equal(construct.needs.rest, ordinary.needs.rest, 'while everything else wears on it the same');
});

test('a kind that feels a need twice over is worn down twice as fast', () => {
  const frail = { id: 'frail', name: 'the frail', needs: { rest: 2 } };
  const ordinary = applyDrift(someone(), MARCH).persona;
  const weary = applyDrift(someone(), MARCH, undefined, frail).persona;

  assert.equal(NEED_MAX - weary.needs.rest, (NEED_MAX - ordinary.needs.rest) * 2);
});

test('who is what is decided by the seed, and most people are ordinary', () => {
  const kinds = speciesFor(11);
  const drawn = Array.from({ length: 200 }, (_, i) => speciesIdFor(11, `p${i}`, kinds));

  assert.equal(speciesIdFor(11, 'p7', kinds), speciesIdFor(11, 'p7', kinds), 'the same person is always the same kind');
  const folk = drawn.filter((id) => id === FOLK.id).length;
  assert.ok(folk > drawn.length / 2, 'a town is mostly ordinary people, not a menagerie');
  assert.ok(folk < drawn.length, 'but the other kinds are actually reachable');
});

test('the Director is told when somebody is not the ordinary kind', async () => {
  // Otherwise the prose writes a construct complaining of hunger. The kind is
  // named only when it is worth naming: everybody being "folk" in every brief
  // is noise the model has to read past on every turn.
  const made = { id: 'made', name: 'the made', needs: { food: 0 } };
  const base = playState();
  const smith = base.world.people['smith'];
  const world = {
    ...base.world,
    species: [FOLK, made],
    people: { ...base.world.people, smith: { ...smith, species: 'made' } },
  };

  const p = new FakeProvider({ structured: [] });
  await runDirector(p, { ...base, world }, 'look around', 'exploration', []).catch(() => {});
  assert.match(p.allSentText(), /the made/);

  const plain = new FakeProvider({ structured: [] });
  await runDirector(plain, base, 'look around', 'exploration', []).catch(() => {});
  assert.doesNotMatch(plain.allSentText(), /folk/, 'the ordinary kind is not worth a word');
});
