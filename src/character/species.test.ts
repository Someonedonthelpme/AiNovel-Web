import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDrift } from './drift.ts';
import { emptyPersona, NEED_MAX } from './persona.ts';
import { defaultVoice } from '../world/fixtures.ts';
import { FOLK, leavesOf, readSpecies, speciesFor, speciesIdFor, TYPES } from './species.ts';
import { ABILITIES } from '../combat/types.ts';
import { FakeProvider } from '../llm/provider.ts';
import { runDirector } from '../llm/director.ts';
import { playState } from '../play/fixtures.ts';

const someone = () => emptyPersona(defaultVoice());

/** A hard march: the cause that takes food and rest off anybody who has them. */
const MARCH = [{ kind: 'travel' as const, cost: 3 }];

/*
 * RESPECIFIED 2026-09-12, 6b stage 3e. Was: "every world has the ordinary kind,
 * and the rest are its own" — `kinds[0]` was FOLK and a world held 2–4 flat
 * kinds. A world now holds a four-level tree and every living thing sits at a
 * subspecies, so "the ordinary kind is always there" is no longer what is true;
 * a DOMINANT subspecies replaces folk at 3g.
 */
test('a world holds a four-level tree, dealt the same way twice', () => {
  const nodes = speciesFor(11);
  assert.deepEqual(nodes.map((n) => n.id), speciesFor(11).map((n) => n.id), 'the same seed, the same world');
  assert.equal(new Set(nodes.map((n) => n.id)).size, nodes.length, 'nothing is dealt twice');

  const at = (level: string) => nodes.filter((n) => n.level === level);
  assert.ok(at('type').length >= 3 && at('type').length <= 5, `types: ${at('type').length}`);
  for (const type of at('type')) assert.ok(TYPES.some((t) => t.id === type.id), `${type.id} is not a known type`);
  for (const level of ['group', 'species', 'subspecies']) {
    assert.ok(at(level).length > 0, `no ${level} was dealt`);
    for (const node of at(level)) {
      assert.ok(nodes.some((p) => p.id === node.parent), `${node.id} has no parent in the tree`);
    }
  }
  assert.ok(leavesOf(nodes).every((n) => n.level === 'subspecies'), 'every leaf is a subspecies');
});

test('a group categorises and adds nothing to the body', () => {
  for (let seed = 0; seed < 20; seed++) {
    const nodes = speciesFor(seed);
    for (const group of nodes.filter((n) => n.level === 'group')) {
      assert.deepEqual(group.delta, {}, `${group.id} moved a stat`);
      const type = nodes.find((n) => n.id === group.parent)!;
      assert.deepEqual(group.template, type.template, `${group.id} differs from its type`);
    }
  }
});

test('a template is the sum down its path', () => {
  const nodes = speciesFor(3);
  for (const node of nodes) {
    let expected: Record<string, number> = {};
    for (let at: typeof node | undefined = node; at; at = nodes.find((n) => n.id === at!.parent)) {
      for (const [ability, by] of Object.entries(at.delta)) expected[ability] = (expected[ability] ?? 0) + (by ?? 0);
    }
    assert.deepEqual(node.template, Object.fromEntries(Object.entries(expected).filter(([, v]) => v !== 0)), node.id);
  }
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

/*
 * RESPECIFIED 2026-09-12, 6b stage 3e. Was: "a lean trades within one group, and
 * no template ever touches vit" — that rule existed to keep species FAIR, and
 * fairness is no longer the goal: a single-player game is allowed to hand out a
 * body that is worse in a fight, so long as the picker shows it. What replaces it
 * is a BOUND, so nothing is unplayable, and the chart reports the spread.
 */
test('a lean may touch any stat, and no ability on any node passes ±4', () => {
  const touched = new Set<string>();
  for (let seed = 0; seed < 50; seed++) {
    for (const node of speciesFor(seed)) {
      for (const [ability, by] of Object.entries(node.template)) {
        touched.add(ability);
        assert.ok(Math.abs(by ?? 0) <= 4, `seed ${seed}: ${node.id} has ${ability} ${by}`);
      }
    }
  }
  assert.ok(touched.has('vit'), 'vit is no longer fenced off');
  assert.ok(touched.size >= 7, `only ${touched.size} of nine stats ever move`);
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

/*
 * RESPECIFIED 2026-09-12, 6b stage 3e. Was "most people are ordinary", meaning
 * FOLK. There is no folk in a tree: everybody sits at a subspecies, so what has
 * to be true is that most of a town shares ONE of them. Which one is arbitrary
 * here and becomes the world's DOMINANT subspecies at 3g.
 */
test('who is what is decided by the seed, and most of a town shares one kind', () => {
  const kinds = speciesFor(11);
  const drawn = Array.from({ length: 200 }, (_, i) => speciesIdFor(11, `p${i}`, kinds));

  assert.equal(speciesIdFor(11, 'p7', kinds), speciesIdFor(11, 'p7', kinds), 'the same person is always the same kind');
  assert.ok(leavesOf(kinds).some((leaf) => leaf.id === drawn[0]), 'a person is a SUBSPECIES, not a type');

  const commonest = Math.max(...new Set(drawn).size ? [...new Set(drawn)].map((id) => drawn.filter((d) => d === id).length) : [0]);
  assert.ok(commonest > drawn.length / 2, 'a town is mostly one kind of people, not a menagerie');
  assert.ok(commonest < drawn.length, 'but the others are actually reachable');
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
