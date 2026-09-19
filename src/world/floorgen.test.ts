import { openingEdges, trustToward } from '../social/edge.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeProvider } from '../llm/provider.ts';
import { sheet } from '../session/fixtures.ts';
import { placeBudget } from './budget.ts';
import { floorSchema, generateFloor } from './floorgen.ts';
import type { GeneratedFloor } from './floorgen.ts';
import { compressRegion } from './lod.ts';
import { firstFloor, generatedFloor, person, world } from './fixtures.ts';
import { activeRegion } from './travel.ts';
import { STANDARD } from '../rules/ruleset.ts';
import { validateRegion } from './validate.ts';
import { dangerAt } from './strata.ts';
import { isFull } from './types.ts';
import { groupOf, speciesFor } from '../character/species.ts';
import { packAt } from '../character/habitat.ts';

const pc = sheet();

const generated = generatedFloor;

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

test('the ground town is authored, never generated — but below it is fair game', async () => {
  await assert.rejects(() => generateFloor(provider(), world(), 0, pc), /authored ground/);

  // Floors below ground are a LAW question, not a generator one. `descend`
  // refuses unless the world permits it or the asker is exempt; if it does ask,
  // the generator must be able to answer.
  const r = await generateFloor(provider(), world(), -1, pc);
  assert.equal(r.region.floor, -1);
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

test('a generated floor takes its danger from the world, not from the default dial', async () => {
  // `dangerFor(floor)` was called here with NO ruleset, so a world's own danger
  // curve never reached the floors it was meant to shape — HARSH generated
  // exactly the same floor as PLAIN. The stratum has the first word, the
  // world's dials the second.
  const steep = world({ rules: { ...STANDARD, world: { ...STANDARD.world, dangerPerFloor: 3 } } });
  const sharp = await generateFloor(provider(), steep, 4, pc);
  assert.equal(sharp.region.danger, 12, "the world's own curve, not the default one");

  const wing = world({
    ...steep,
    strata: { quiet: { id: 'quiet', name: 'The Quiet Band', kind: 'dynamic', from: 3, to: 6, danger: { base: 1, perFloor: 0 } } },
  });
  const calm = await generateFloor(provider(), wing, 4, pc);
  assert.equal(calm.region.danger, 1, 'a quiet band deep in a tower is the whole point of the curve');
});

test('floors of one stratum are one place, not four unrelated ones', async () => {
  // A stratum could be DECLARED before this and its floors would still each
  // invent their own biome and culture, so a Sunken Wing spanning four floors
  // read as four unconnected places. The stratum's character is authored once
  // and every floor inside it inherits.
  const wing = {
    id: 'wing', name: 'The Sunken Wing', kind: 'static' as const, from: 3, to: 6,
    theme: { biome: 'flooded stone', culture: 'divers who do not speak', people: 'salvagers' },
  };
  const themed = world({ strata: { wing } });

  const lower = await generateFloor(provider(), themed, 4, pc);
  const upper = await generateFloor(provider(), themed, 5, pc);

  assert.equal(lower.region.biome, 'flooded stone');
  assert.equal(lower.region.culture, 'divers who do not speak');
  assert.equal(upper.region.biome, lower.region.biome, 'two floors of one wing are one place');

  // And a floor belonging to no stratum is exactly as it was: the model's own.
  const loose = await generateFloor(provider(), world(), 4, pc);
  assert.equal(loose.region.biome, 'dead forest');
  assert.equal(loose.region.culture, 'poachers and worse');
});

test('a stratum tells the model what it is building inside', async () => {
  // Inheriting the words is not enough on its own: a floor whose PROSE was
  // written for a dead forest and whose biome then says "flooded stone" is
  // worse than one that simply disagreed.
  const themed = world({ strata: { wing: {
    id: 'wing', name: 'The Sunken Wing', kind: 'static' as const, from: 3, to: 6,
    theme: { biome: 'flooded stone', culture: 'divers who do not speak', people: 'salvagers' },
  } } });

  const p = provider();
  await generateFloor(p, themed, 4, pc);
  assert.match(p.allSentText(), /Sunken Wing/);
  assert.match(p.allSentText(), /flooded stone/);
  assert.match(p.allSentText(), /salvagers/);
});

test('a region can be built somewhere that is not a floor number', async () => {
  // `regionIdFor(floor)` was the only source of a region id, which quietly made
  // every world a stack: two places at the same depth could not both exist.
  const r = await generateFloor(provider(), world(), 0, pc, null, 'outer-market');
  assert.equal(r.region.id, 'outer-market');
  assert.equal(r.region.floor, 0, 'depth is still depth');
  assert.deepEqual(validateRegion(r.region, r.people).errors, []);
});

test('a floor may begin a wing, and the engine decides its shape', async () => {
  // The model NAMES a wing and says roughly how far it runs; where it hangs in
  // the tree, how far it actually runs, and what it is called by are the
  // engine's — the same division as `deed` and `amendLaw`.
  const opening = generated({ wingName: 'The Sunken Wing', wingFloors: 40 });
  const inTower = world({
    strata: { tower: { id: 'tower', name: 'the tower', kind: 'dynamic', from: 0 } },
  });

  const r = await generateFloor(provider(opening), inTower, 4, pc);
  const wing = r.stratum;

  assert.ok(wing, 'the floor said it begins one');
  assert.equal(wing.name, 'The Sunken Wing');
  assert.equal(wing.parent, 'tower', 'it hangs inside whatever it was found in');
  assert.equal(wing.from, 4, 'and it starts here');
  assert.ok(wing.to !== undefined && wing.to - wing.from < 8, 'however many floors the model asked for');
  assert.equal(wing.theme?.biome, r.region.biome, 'a wing takes the character of the floor that opens it');

  const quiet = await generateFloor(provider(generated()), inTower, 4, pc);
  assert.equal(quiet.stratum, undefined, 'and most floors begin nothing at all');
});

test('a wing gets a seeded danger curve, and a loot profile from the closed list', async () => {
  // Stratum.danger and Stratum.loot had readers and no writer outside tests.
  // Danger is a number, so the seed decides it; what a wing is known for is a
  // word, so the model names it from LOOT_CATEGORIES and the engine weighs it.
  const opening = generated({ wingName: 'The Sunken Wing', wingFloors: 3, wingKnownFor: ['weapon', 'sword-of-doom'] });
  const inTower = world({ strata: { tower: { id: 'tower', name: 'the tower', kind: 'dynamic', from: 0 } } });

  const wing = (await generateFloor(provider(opening), inTower, 4, pc)).stratum!;
  const withWing = { ...inTower, strata: { ...inTower.strata, [wing.id]: wing } };
  const swing = dangerAt(withWing, 4) - dangerAt(inTower, 4);
  assert.ok(wing.danger, 'a wing has its own curve');
  assert.ok(swing >= -2 && swing <= 3, `a seeded swing on the danger where it opens, got ${swing}`);

  const again = (await generateFloor(provider(opening), inTower, 4, pc)).stratum!;
  assert.deepEqual(again.danger, wing.danger, 'same seed, same wing, same curve');

  assert.equal(wing.loot?.weights?.weapon, 3, 'known for what it named');
  assert.equal(wing.loot?.weights?.book, 0.5, 'and thinner in the rest');
  assert.ok(!('sword-of-doom' in (wing.loot?.weights ?? {})), 'a word outside the list is ignored');

  const plain = (await generateFloor(provider(generated({ wingName: 'The Cellar', wingFloors: 2 })), inTower, 4, pc)).stratum!;
  assert.equal(plain.loot, undefined, 'a wing known for nothing pays from the ordinary table');
});

/*
 * 6b stage 4 (approved 2026-09-14): a boss is a notable character the floor
 * creates before you meet it. The model NAMES it; the engine decides what it is.
 * No mutation yet — that arrives with the kin tree, after quests.
 */
const kinds = speciesFor(11);
const withKinds = () => ({ ...world({ seed: 11 }), species: kinds });
const withBoss = (name = 'the Warden of Ash') => generated({ bossName: name, bossOneLine: 'holds the tenth stair' });

test('a landmark floor is generated with exactly one boss, of the kind that lives there', async () => {
  const r = await generateFloor(provider(withBoss()), withKinds(), 10, pc);
  const boss = r.people[r.region.boss ?? ''];
  assert.ok(boss?.sheet, 'the floor holds a boss who can fight');
  assert.equal(groupOf(kinds, boss.sheet!.species!), packAt(11, kinds, 10), 'of the kind that lives on that floor');
});

test('only a landmark floor holds a boss, and the engine decides who it is', async () => {
  const seven = await generateFloor(provider(withBoss()), withKinds(), 7, pc);
  assert.equal(seven.region.boss, undefined, 'floor 7 is no landmark, whatever the model says');

  const one = await generateFloor(provider(withBoss()), withKinds(), 10, pc);
  const two = await generateFloor(provider(withBoss('another name')), withKinds(), 10, pc);
  assert.ok(one.region.boss && two.region.boss, 'both landmark floors hold a boss');
  assert.equal(
    two.people[two.region.boss].sheet!.species,
    one.people[one.region.boss].sheet!.species,
    'the model names it; the engine decides what it is',
  );
});

/*
 * 6c loop L2b (approved 2026-09-18): every floor of a loop band is HELD, because a
 * floor with no holder has nothing to clear and never loops. The tenth floor keeps
 * its landmark holder; the rest get one the same way.
 */
const inBand = () => ({
  ...withKinds(),
  strata: {
    tower: { id: 'tower', name: 'the tower', kind: 'dynamic' as const, from: 0 },
    loop: { id: 'loop', name: 'the loop', kind: 'dynamic' as const, parent: 'tower', from: 1, to: 10, laws: { reset: 'untilCleared' as const } },
  },
});

test('every floor of a loop band is held, not only the tenth', async () => {
  const three = await generateFloor(provider(withBoss('Ysolt')), inBand(), 3, pc);
  assert.equal(three.people[three.region.boss ?? '']?.name, 'Ysolt');
});

test('outside the band, only a landmark floor is held — as before', async () => {
  const thirteen = await generateFloor(provider(withBoss()), inBand(), 13, pc);
  assert.equal(thirteen.region.boss, undefined);
});

test('the model is asked to name who holds a loop floor', async () => {
  const p = provider(withBoss());
  await generateFloor(p, inBand(), 3, pc);
  assert.match(JSON.stringify(p.lastRequest('structured')), /somebody holds it/);
});

test('a loop floor the model named nobody for is still held, by a holder named for their kind', async () => {
  const r = await generateFloor(provider(withBoss('')), inBand(), 3, pc);
  const holder = r.people[r.region.boss ?? ''];
  assert.ok(holder, 'or the floor would silently never loop');
  assert.equal(holder.name, kinds.find((k) => k.id === holder.species)?.name);
});

/*
 * 6c era E3b: an era band is one land in different times, so the FIRST floor
 * built in it gives the band its land — the wing precedent, no model call.
 */
const eraLand = { biome: 'salt marsh', culture: 'reed-cutters', people: 'reed-cutters' };
const eraBanded = (theme?: typeof eraLand) => ({
  ...withKinds(),
  strata: {
    tower: { id: 'tower', name: 'the tower', kind: 'dynamic' as const, from: 0 },
    era: {
      id: 'era', name: 'the eras', kind: 'dynamic' as const, parent: 'tower', from: 21, to: 30,
      laws: { time: 'era' as const }, ...(theme ? { theme } : {}),
    },
  },
});

test('the first floor built in an era band gives the band its land', async () => {
  const first = await generateFloor(provider(), eraBanded(), 21, pc);
  assert.equal(first.band?.id, 'era');
  assert.deepEqual(first.band?.theme, { biome: first.region.biome, culture: first.region.culture, people: first.region.culture });
  assert.equal((await generateFloor(provider(), eraBanded(eraLand), 22, pc)).band, undefined, 'set once, never rewritten');
});

test('a floor that opens a wing and gives the band its land records both', async () => {
  const first = await generateFloor(provider(generated({ wingName: 'The Drowned Hall', wingFloors: 2 })), eraBanded(), 21, pc);
  assert.equal(first.stratum?.parent, 'era');
  assert.equal(first.band?.id, 'era');
});
