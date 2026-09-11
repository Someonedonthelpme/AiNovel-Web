import test from 'node:test';
import assert from 'node:assert/strict';
import { compressExcept, compressRegion, deriveSummary, footprint, peopleOf, rehydrationBrief } from './lod.ts';
import { firstFloor, groundFloor, world } from './fixtures.ts';
import { isFull } from './types.ts';
import type { Fact } from './types.ts';

test('compression drops the map and keeps the people', () => {
  const gaz = compressRegion(groundFloor(), 7);
  assert.equal(gaz.detail, 'gazetteer');
  assert.equal('places' in gaz, false, 'geometry is gone');
  assert.deepEqual(gaz.knownPeople.sort(), ['smith', 'warden']);
  assert.equal(gaz.name, 'Ashfall', 'identity survives');
  assert.equal(gaz.floor, 0);
  assert.equal(gaz.compressedAtTurn, 7);
});

test('a person mentioned in two places is listed once', () => {
  // The smith appears in both the town and the market.
  assert.deepEqual(peopleOf(groundFloor()).sort(), ['smith', 'warden']);
});

test('the derived summary names settlements so rehydration stays consistent', () => {
  const summary = deriveSummary(groundFloor());
  assert.match(summary, /Ashfall/);
  assert.match(summary, /ash plain/);
  assert.match(summary, /floor 0/);
});

test('an authored summary and threads override the derived ones', () => {
  const gaz = compressRegion(groundFloor(), 2, {
    summary: 'The town shut its gates after the fire.',
    openThreads: ['the warden still owes you'],
    reputation: 3,
  });
  assert.equal(gaz.summary, 'The town shut its gates after the fire.');
  assert.deepEqual(gaz.openThreads, ['the warden still owes you']);
  assert.equal(gaz.reputation, 3);
});

test('compressExcept spares only the regions named', () => {
  const w = world({ regions: { 'floor-0': groundFloor(), 'floor-1': firstFloor() } });
  const next = compressExcept(w, ['floor-1'], 4);
  assert.equal(isFull(next.regions['floor-1']), true);
  assert.equal(isFull(next.regions['floor-0']), false);
});

test('compressing is idempotent — an already-compressed region is left alone', () => {
  const w = world({ regions: { 'floor-0': groundFloor() } });
  const once = compressExcept(w, [], 4);
  const twice = compressExcept(once, [], 9);
  assert.deepEqual(twice.regions['floor-0'], once.regions['floor-0'], 'the original turn stamp is kept');
});

test('a rehydration brief carries the gazetteer, its people in voice, and its facts', () => {
  const facts: Fact[] = [
    { id: 'f1', text: 'The well ran dry in spring.', region: 'floor-0', people: [], establishedAtTurn: 1 },
    { id: 'f2', text: 'The grove eats light.', region: 'floor-1', people: [], establishedAtTurn: 2 },
  ];
  const w = world({ facts });
  const brief = rehydrationBrief(w, compressRegion(groundFloor(), 3));

  assert.equal(brief.gazetteer.name, 'Ashfall');
  assert.deepEqual(brief.people.map((p) => p.id).sort(), ['smith', 'warden']);
  assert.equal(brief.people.find((p) => p.id === 'smith')?.oneLine, 'sells iron, trusts no one');
  assert.deepEqual(brief.facts, ['The well ran dry in spring.'], 'only facts belonging to this region');
});

test('a brief skips people who have been purged from the registry', () => {
  const w = world({ people: {} });
  const brief = rehydrationBrief(w, compressRegion(groundFloor(), 3));
  assert.deepEqual(brief.people, []);
});

test('the footprint shows tiering actually holding', () => {
  const w = world({ regions: { 'floor-0': groundFloor(), 'floor-1': firstFloor() } });
  assert.deepEqual(footprint(w), { full: 2, gazetteer: 0, people: 3, facts: 0 });

  const tiered = compressExcept(w, ['floor-1'], 5);
  assert.deepEqual(footprint(tiered), { full: 1, gazetteer: 1, people: 3, facts: 0 });
});

test('a hundred floors compress to a bounded number of full regions', () => {
  // The point of tiering: full detail stays constant however far you climb.
  let w = world({ regions: {} });
  for (let floor = 0; floor < 100; floor++) {
    const region = { ...firstFloor(), id: `floor-${floor}`, floor };
    w = { ...w, regions: { ...w.regions, [region.id]: region } };
    w = compressExcept(w, [region.id, `floor-${floor - 1}`], floor);
  }
  const f = footprint(w);
  assert.equal(f.full, 2, 'only the current floor and the one below stay in full detail');
  assert.equal(f.gazetteer, 98);
});

test('a static stratum is never compressed, which is what frozen means', () => {
  // "Static floor = authored once by the model, then FROZEN. Never rehydrated."
  // Compression is the only thing that throws detail away, so declining to
  // compress IS the freeze — the floor stays exactly as it was authored and no
  // second generation event is ever needed.
  const frozen = world({
    strata: { vault: { id: 'vault', name: 'The Vault', kind: 'static', from: 0, to: 5 } },
    regions: { 'floor-0': groundFloor(), 'floor-1': { ...groundFloor(), id: 'floor-1', floor: 1 } },
    currentRegion: 'floor-0',
  });

  const after = compressExcept(frozen, ['floor-0'], 9);
  assert.equal(after.regions['floor-1'].detail, 'full', 'a frozen floor keeps its geometry');

  const ordinary = world({
    regions: { 'floor-0': groundFloor(), 'floor-1': { ...groundFloor(), id: 'floor-1', floor: 1 } },
    currentRegion: 'floor-0',
  });
  assert.equal(
    compressExcept(ordinary, ['floor-0'], 9).regions['floor-1'].detail, 'gazetteer',
    'while an ordinary floor still compresses behind you',
  );
});
