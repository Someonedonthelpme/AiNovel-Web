import { openingEdges, trustToward } from '../social/edge.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeProvider } from '../llm/provider.ts';
import { sheet } from '../session/fixtures.ts';
import { placeBudget } from './budget.ts';
import { floorSchema, generateFloor } from './floorgen.ts';
import type { GeneratedFloor } from './floorgen.ts';
import { compressRegion } from './lod.ts';
import { firstFloor, person, world } from './fixtures.ts';
import { activeRegion } from './travel.ts';
import { validateRegion } from './validate.ts';
import { isFull } from './types.ts';

const pc = sheet();

const generated = (over: Partial<GeneratedFloor> = {}): GeneratedFloor => ({
  bonds: [],
  name: 'The Grey Grove',
  biome: 'dead forest',
  culture: 'poachers and worse',
  places: [
    { id: 'landing', name: 'the landing', kind: 'gate', description: 'stone steps', connections: ['grove'], people: [], affordances: ['catch your breath'] },
    { id: 'grove', name: 'the grove', kind: 'wild', description: 'grey trees', connections: ['landing', 'rise'], people: ['kell'], affordances: ['search the undergrowth'] },
    { id: 'rise', name: 'the second stair', kind: 'gate', description: 'a spiral', connections: ['grove'], people: [], affordances: ['climb'] },
  ],
  entrance: 'landing',
  exit: 'rise',
  people: [{
    id: 'kell', name: 'Kell', oneLine: 'knows the grove', tags: ['poacher'], trust: 0, status: 'peer',
    selfPronoun: 'ข้า', underStress: 'กู',
    addressDistant: 'เจ้า', addressWarm: 'เอ็ง', particleDistant: 'วะ', particleWarm: 'นะ',
    intuition: 1, feeling: 2, nerve: 2, discipline: -1,
  }],
  creatures: ['หมาป่าเงา'],
  ...over,
});

const provider = (floor = generated()) => new FakeProvider({ structured: [floor] });

test('a generated floor is valid and playable', async () => {
  const r = await generateFloor(provider(), world(), 1, pc);
  assert.deepEqual(validateRegion(r.region, r.people).errors, []);
  assert.equal(r.region.id, 'floor-1');
  assert.equal(r.region.floor, 1);
  assert.equal(r.creatures[0], 'หมาป่าเงา');
});

test('the code decides what the model must not', async () => {
  const r = await generateFloor(provider(), world(), 7, pc);
  assert.equal(r.region.detail, 'full');
  assert.equal(r.region.floor, 7);
  assert.equal(r.region.danger, 7, 'danger comes from depth, never from the model');
  assert.equal(r.region.id, 'floor-7');
});

test('the way up is never the way you came in', async () => {
  const trapped = generated({ exit: 'landing' });
  const r = await generateFloor(provider(trapped), world(), 3, pc);
  assert.notEqual(r.region.exit, r.region.entrance, 'otherwise the floor is a dead end');
  assert.ok(r.repairs.some((m) => /way up/.test(m)));
});

test('a floor with a broken map is repaired rather than rejected', async () => {
  const broken = generated();
  broken.places = [
    { ...broken.places[0], connections: ['grove'] },
    { ...broken.places[1], connections: ['landing'] },
    { ...broken.places[2], connections: [] },
  ];
  const r = await generateFloor(provider(broken), world(), 2, pc);
  const check = validateRegion(r.region, r.people);
  assert.equal(check.ok, true, check.errors.map((e) => e.message).join('; '));
  assert.ok(check.reachable.includes('rise'), 'the stair can be walked to');
});

test('people the model never defined are dropped, not fatal', async () => {
  const g = generated();
  g.places = g.places.map((p) => (p.id === 'grove' ? { ...p, people: ['kell', 'phantom'] } : p));
  const r = await generateFloor(provider(g), world(), 2, pc);
  assert.deepEqual(r.region.places.find((p) => p.id === 'grove')?.people, ['kell']);
  assert.ok(r.repairs.some((m) => /phantom/.test(m)));
});

test('a slash-joined voice form is repaired on generated people too', async () => {
  const g = generated();
  g.people = [{ ...g.people[0], particleDistant: 'ครับ/ค่ะ' }];
  const r = await generateFloor(provider(g), world(), 2, pc);
  assert.equal(r.people['kell'].voice.particleBands['-3'], 'ครับ');
});

test('the tower starts at floor 1 — the ground town is not generated this way', async () => {
  await assert.rejects(() => generateFloor(provider(), world(), 0, pc), /not inside the tower/);
});

test('the schema grows with depth', () => {
  const shallow = floorSchema(1) as unknown as { properties: { places: { maxItems: number } } };
  const deep = floorSchema(30) as unknown as { properties: { places: { maxItems: number } } };
  assert.ok(deep.properties.places.maxItems > shallow.properties.places.maxItems);
  assert.equal(shallow.properties.places.maxItems, placeBudget(1).max);
});

/* -------------------------------------------------------------------------- */
/* Returning is rehydration, not regeneration                                  */
/* -------------------------------------------------------------------------- */

test('a revisited floor keeps its name and biome, whatever the model says', async () => {
  const gaz = compressRegion(firstFloor(), 5);
  const w = world({ regions: { 'floor-1': gaz } });
  const drifted = generated({ name: 'Somewhere Else Entirely', biome: 'lava' });

  const r = await generateFloor(provider(drifted), w, 1, pc, gaz);
  assert.equal(r.region.name, 'The Grey Grove', 'the gazetteer is canon');
  assert.equal(r.region.biome, 'dead forest');
});

test('a person you already know keeps the relationship you built with them', async () => {
  // The whole point of persistence: come back at trust 3 and they remember you.
  const kell = person('kell', { name: 'Kell', homeRegion: 'floor-1', oneLine: 'owes you a debt' });
  const gaz = { ...compressRegion(firstFloor(), 5), knownPeople: ['kell'] };
  const w = world({ regions: { 'floor-1': gaz }, people: { kell }, edges: openingEdges({}, [{ id: 'kell', trust: 3 }]) });

  const reset = generated();
  reset.people = [{ ...reset.people[0], trust: 0, oneLine: 'a stranger' }];

  const r = await generateFloor(provider(reset), w, 1, pc, gaz);
  assert.equal(r.people['kell'].oneLine, 'owes you a debt');
  // A returning face opens NO edge, so what they already felt survives — the
  // model proposing "a stranger, trust 0" cannot reset it.
  assert.equal(trustToward(r.edges, 'kell'), 0, 'no fresh edge is minted for somebody you know');
  assert.equal(trustToward(w.edges, 'kell'), 3, 'and the one you earned is untouched');
});

test('people the model forgets on a return visit are restored from the registry', async () => {
  const kell = person('kell', { name: 'Kell', homeRegion: 'floor-1' });
  const gaz = { ...compressRegion(firstFloor(), 5), knownPeople: ['kell'] };
  const w = world({ regions: { 'floor-1': gaz }, people: { kell } });

  const forgot = generated({ people: [] });
  forgot.places = forgot.places.map((p) => ({ ...p, people: [] }));

  const r = await generateFloor(provider(forgot), w, 1, pc, gaz);
  assert.ok(r.people['kell'], 'a known person does not vanish because the model omitted them');
});

test('the rehydration brief puts the established canon in front of the model', async () => {
  const gaz = { ...compressRegion(firstFloor(), 5), openThreads: ['the snare you never checked'] };
  const w = world({ regions: { 'floor-1': gaz } });
  const p = provider();
  await generateFloor(p, w, 1, pc, gaz);

  const sent = p.allSentText();
  assert.match(sent, /same place/);
  assert.match(sent, /the snare you never checked/);
  assert.match(sent, /The Grey Grove/);
});
