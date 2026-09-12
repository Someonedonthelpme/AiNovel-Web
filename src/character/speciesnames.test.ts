import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeProvider } from '../llm/provider.ts';
import { applySpeciesNames, nameSpecies } from './speciesnames.ts';
import { speciesFor } from './species.ts';

const nodes = () => speciesFor(11);

test('the model names the tree, and the ids never move', async () => {
  const tree = nodes();
  const provider = new FakeProvider({
    structured: [{ kinds: tree.map((n, i) => ({ id: n.id, name: `name ${i}` })) }],
  });

  const named = await nameSpecies(provider, tree, 'a drowned coast', 'en');
  assert.deepEqual(named.map((n) => n.id), tree.map((n) => n.id), 'ids are what everything else matches on');
  assert.deepEqual(named.map((n) => n.name), tree.map((_, i) => `name ${i}`));
  assert.deepEqual(named.map((n) => n.template), tree.map((n) => n.template), 'naming touches no numbers');
});

test('the model is shown the shape it is naming', async () => {
  const tree = nodes();
  const provider = new FakeProvider({ structured: [{ kinds: [] }] });
  await nameSpecies(provider, tree, 'a drowned coast', 'en');

  const sent = provider.allSentText();
  const leaf = tree.find((n) => n.level === 'subspecies')!;
  assert.match(sent, /subspecies/, 'which level each node is');
  assert.ok(sent.includes(leaf.parent!), 'and what it belongs to, so a variant can be named as one');
});

test('a word it invents for nobody is ignored, and a node it skips keeps what it had', () => {
  const tree = nodes();
  const named = applySpeciesNames(tree, [
    { id: tree[0].id, name: 'the drowned' },
    { id: 'no_such_node', name: 'nonsense' },
  ]);
  assert.equal(named[0].name, 'the drowned');
  assert.equal(named[1].name, tree[1].name, 'unnamed keeps its placeholder');
  assert.equal(named.length, tree.length, 'and nothing is added');
});

test('two kinds under one word are one kind, so the second keeps its own', () => {
  const tree = nodes();
  const named = applySpeciesNames(tree, [
    { id: tree[0].id, name: 'the drowned' },
    { id: tree[1].id, name: 'The Drowned' },
  ]);
  assert.equal(named[0].name, 'the drowned');
  assert.equal(named[1].name, tree[1].name, 'a repeated word is refused, however it is cased');
});

test('a world whose model is down is playable with duller words', async () => {
  const tree = nodes();
  const broken = new FakeProvider();   // throws: nothing scripted
  const named = await nameSpecies(broken, tree, 'a drowned coast', 'en');
  assert.deepEqual(named, tree, 'every kind keeps the word it had');
});
