import test from 'node:test';
import assert from 'node:assert/strict';
import { forbids, STANDARD } from './ruleset.ts';
import type { Law } from './ruleset.ts';
import { groupOf, leavesOf, speciesFor } from '../character/species.ts';
import { playerSubject } from '../play/signetbook.ts';
import { playState } from '../play/fixtures.ts';
import { validateDelta } from '../play/delta.ts';
import { FakeProvider } from '../llm/provider.ts';
import { runDirector, toWorldDelta } from '../llm/director.ts';
import { directorOutput, emptyDelta } from '../play/fixtures.ts';

const kinds = speciesFor(11);
const leaves = leavesOf(kinds);
const mine = leaves[0];
const theirs = leaves.find((k) => groupOf(kinds, k.id) !== groupOf(kinds, mine.id))!;
const group = groupOf(kinds, mine.id)!;

const law: Law = { axis: 'economy', constraint: 'takeLoot', binds: { group } };

const asKind = (species: string) => {
  const base = playState();
  return {
    ...base,
    sheet: { ...base.sheet, species },
    world: { ...base.world, seed: 11, species: kinds, rules: { ...STANDARD, laws: [law] } },
  };
};

test('a law can name a group, and binds only that group', () => {
  const ours = asKind(mine.id);
  const other = asKind(theirs.id);

  assert.ok(forbids(ours.world, playerSubject(ours), 'takeLoot'), `a ${group} may not take loot here`);
  assert.equal(forbids(other.world, playerSubject(other), 'takeLoot'), null, 'and nobody else is bound by it');
});

test('a law naming a group this world does not hold is refused', () => {
  const state = asKind(mine.id);
  const bad = validateDelta(state, { amendLaw: { constraint: 'takeLoot', binds: { group: 'no_such_group' } } });
  assert.equal(bad.delta.amendLaw, undefined, 'a rule about nobody enforces nothing');
  assert.match(bad.rejected.join(' '), /no_such_group/);

  const good = validateDelta(state, { amendLaw: { constraint: 'takeLoot', binds: { group } } });
  assert.deepEqual(good.delta.amendLaw, { constraint: 'takeLoot', binds: { group } });
  assert.deepEqual(good.rejected, []);
});

test('a law naming a SPECIES rather than a group is refused too', () => {
  // A group is the unit that carries what a kind is treated as: body, habitat,
  // kinship and standing in law. Binding a lineage would make four vocabularies.
  const state = asKind(mine.id);
  const r = validateDelta(state, { amendLaw: { constraint: 'takeLoot', binds: { group: mine.id } } });
  assert.equal(r.delta.amendLaw, undefined, `${mine.id} is a subspecies, not a group`);
});

test('the Director can declare a law about a kind of being, and is told which kinds exist', async () => {
  const state = asKind(mine.id);
  const provider = new FakeProvider({
    structured: [directorOutput({
      delta: { ...emptyDelta(), amendLaw: 'takeLoot', amendBinds: 'none', amendGroup: group },
    })],
  });

  const out = await runDirector(provider, state, 'the warden bars our sort from the tower', 'conversation', []);
  assert.deepEqual(toWorldDelta(out.delta).amendLaw, { constraint: 'takeLoot', binds: { group } });
  assert.ok(provider.allSentText().includes(group), 'the model cannot name a group it was never shown');
});
