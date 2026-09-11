import test from 'node:test';
import assert from 'node:assert/strict';
import { activeRegion, ascend, currentPlace, descend, exitsFrom, installRegion, linksFrom, moveWithinRegion, traverse } from './travel.ts';
import { compressRegion } from './lod.ts';
import { firstFloor, groundFloor, link, place, world } from './fixtures.ts';
import { isFull, regionIdFor } from './types.ts';
import { STANDARD } from '../rules/ruleset.ts';
import type { Region, World } from './types.ts';

const atGround = (over: Partial<World> = {}) => world({ currentPlace: 'gate', ...over });

const secondFloor = (): Region => ({
  detail: 'full',
  id: 'floor-2',
  floor: 2,
  name: 'The Glass Terrace',
  biome: 'shattered glass',
  culture: 'silent',
  danger: 2,
  places: link(
    [place('arrival', { kind: 'gate' }), place('terrace', { kind: 'wild' }), place('spire', { kind: 'gate' })],
    [['arrival', 'terrace'], ['terrace', 'spire']],
  ),
  entrance: 'arrival',
  exit: 'spire',
  creatures: ['glass moth'],
});

test('exits list only the connections from where you stand', () => {
  assert.deepEqual(exitsFrom(atGround()), ['town']);
});

test('moving along an edge works, discovers the place and advances the turn', () => {
  const r = moveWithinRegion(atGround(), 'town');
  assert.equal(r.kind, 'moved');
  if (r.kind !== 'moved') return;
  assert.equal(r.world.currentPlace, 'town');
  assert.equal(r.world.turn, 1);
  assert.equal(currentPlace(r.world)?.discovered, true);
});

test('moving somewhere unconnected is refused', () => {
  const r = moveWithinRegion(atGround(), 'stair');
  assert.equal(r.kind, 'error');
  if (r.kind !== 'error') return;
  assert.match(r.reason, /no route/);
});

test('moving to a place that does not exist is refused', () => {
  const r = moveWithinRegion(atGround(), 'moon');
  assert.equal(r.kind, 'error');
});

test('climbing requires standing at a way up that has been found', () => {
  const notThere = ascend(atGround());
  assert.equal(notThere.kind, 'error');
  if (notThere.kind === 'error') assert.match(notThere.reason, /not at the way up/);

  const undiscovered = ascend(
    world({ currentPlace: 'stair', regions: { 'floor-0': { ...groundFloor(), exit: null } } }),
  );
  assert.equal(undiscovered.kind, 'error');
  if (undiscovered.kind === 'error') assert.match(undiscovered.reason, /has not been found/);
});

test('climbing to a floor that does not exist yet asks for it to be generated', () => {
  const r = ascend(world({ currentPlace: 'stair' }));
  assert.equal(r.kind, 'needsRegion');
  if (r.kind !== 'needsRegion') return;
  assert.equal(r.floor, 1);
  assert.equal(r.regionId, 'floor-1');
  assert.equal(r.gazetteer, null, 'nothing to rehydrate from');
});

test('returning to a compressed floor asks for rehydration, with the gazetteer as canon', () => {
  const gaz = compressRegion(firstFloor(), 5);
  const w = world({
    currentPlace: 'stair',
    regions: { 'floor-0': groundFloor(), 'floor-1': gaz },
  });
  const r = ascend(w);
  assert.equal(r.kind, 'needsRegion');
  if (r.kind !== 'needsRegion') return;
  assert.equal(r.gazetteer?.id, 'floor-1');
  assert.equal(r.gazetteer?.name, 'The Grey Grove');
});

test('climbing into a loaded floor lands at its entrance', () => {
  const w = world({ currentPlace: 'stair', regions: { 'floor-0': groundFloor(), 'floor-1': firstFloor() } });
  const r = ascend(w);
  assert.equal(r.kind, 'moved');
  if (r.kind !== 'moved') return;
  assert.equal(r.world.currentRegion, 'floor-1');
  assert.equal(r.world.currentPlace, 'landing');
  assert.equal(r.world.deepestFloor, 1);
  assert.equal(currentPlace(r.world)?.discovered, true);
});

test('you cannot descend from ground level', () => {
  const r = descend(atGround());
  assert.equal(r.kind, 'error');
  if (r.kind === 'error') assert.match(r.reason, /already at ground level/);
});

test('a world whose law does not forbid it can be dug below ground', () => {
  const r = descend(atGround({ rules: { ...STANDARD, laws: [] } }));
  assert.equal(r.kind, 'needsRegion');
  if (r.kind === 'needsRegion') assert.equal(r.floor, -1);
});

test('a world has a bottom, and it is geography rather than permission', () => {
  // The ponytail note left on `generateFloor`: with the law lifted, nothing at
  // all bounded how far down a run could dig, and every floor is a model call.
  // A DIAL rather than a law, because "how deep does this world go" is not a
  // question about who is asking — the exempt hit the bottom too.
  const undercroft = (floor: number): Region => ({ ...groundFloor(), id: regionIdFor(floor), floor });
  const dug = (floor: number) => world({
    currentPlace: 'gate',
    currentRegion: regionIdFor(floor),
    regions: { [regionIdFor(floor)]: undercroft(floor) },
    rules: { ...STANDARD, laws: [] },
  });

  const deeper = descend(dug(-2));
  assert.equal(deeper.kind, 'needsRegion', 'the world goes three below the ground by default');

  const bottom = descend(dug(-3));
  assert.equal(bottom.kind, 'error');
  if (bottom.kind === 'error') assert.match(bottom.reason, /nothing below/);

  // And the bottom is a dial: a world can be written with no undercroft at all.
  const solid = world({
    currentPlace: 'gate',
    rules: { ...STANDARD, laws: [], world: { ...STANDARD.world, depthBelowGround: 0 } },
  });
  assert.equal(descend(solid).kind, 'error');
});

test('descending requires standing at the way down', () => {
  const w = world({
    currentRegion: 'floor-1', currentPlace: 'grove',
    regions: { 'floor-0': groundFloor(), 'floor-1': firstFloor() },
  });
  const r = descend(w);
  assert.equal(r.kind, 'error');
  if (r.kind === 'error') assert.match(r.reason, /not at the way down/);
});

test('descending arrives at the lower floor at its way up', () => {
  const w = world({
    currentRegion: 'floor-1', currentPlace: 'landing',
    regions: { 'floor-0': groundFloor(), 'floor-1': firstFloor() },
  });
  const r = descend(w);
  assert.equal(r.kind, 'moved');
  if (r.kind !== 'moved') return;
  assert.equal(r.world.currentRegion, 'floor-0');
  assert.equal(r.world.currentPlace, 'stair', 'you come out where you went up');
});

test('crossing keeps the floor you left and the one you entered, and compresses the rest', () => {
  const w = world({
    currentRegion: 'floor-1', currentPlace: 'rise', deepestFloor: 1,
    regions: { 'floor-0': groundFloor(), 'floor-1': firstFloor(), 'floor-2': secondFloor() },
  });
  const r = ascend(w);
  assert.equal(r.kind, 'moved');
  if (r.kind !== 'moved') return;

  assert.equal(isFull(r.world.regions['floor-2']), true, 'the floor entered stays full');
  assert.equal(isFull(r.world.regions['floor-1']), true, 'the floor left stays full, so stepping back is free');
  assert.equal(isFull(r.world.regions['floor-0']), false, 'anything further away compresses');
  assert.equal(r.world.deepestFloor, 2);
});

test('people survive the compression that discards the map', () => {
  const w = world({
    currentRegion: 'floor-1', currentPlace: 'rise',
    regions: { 'floor-0': groundFloor(), 'floor-1': firstFloor(), 'floor-2': secondFloor() },
  });
  const r = ascend(w);
  assert.equal(r.kind, 'moved');
  if (r.kind !== 'moved') return;

  const compressed = r.world.regions['floor-0'];
  assert.equal(isFull(compressed), false);
  if (isFull(compressed)) return;
  assert.deepEqual(compressed.knownPeople.sort(), ['smith', 'warden']);
  assert.ok(r.world.people['smith'], 'and remain in the registry in full');
  assert.equal(r.world.people['smith'].name, 'Ora the smith');
});

test('a newly generated region can be installed and stepped into', () => {
  const w = world({ currentPlace: 'stair' });
  const next = installRegion(w, firstFloor(), 'landing');
  assert.equal(next.currentRegion, 'floor-1');
  assert.equal(next.currentPlace, 'landing');
  assert.equal(activeRegion(next)?.name, 'The Grey Grove');
});

test('installing with an unknown landing point falls back to the entrance', () => {
  const next = installRegion(world({ currentPlace: 'stair' }), firstFloor(), 'nowhere');
  assert.equal(next.currentPlace, 'landing');
});

test('nothing can be done while the current region is only a gazetteer', () => {
  const w = world({ regions: { 'floor-0': compressRegion(groundFloor(), 3) } });
  assert.equal(activeRegion(w), null);
  assert.equal(moveWithinRegion(w, 'town').kind, 'error');
  assert.equal(ascend(w).kind, 'error');
});

/* -------------------------------------------------------------------------- */
/* ADJACENCY IS NOT DEPTH                                                      */
/* -------------------------------------------------------------------------- */

test('a region can name its own ways out, and they are walked like any stair', () => {
  // `floor` meant two things at once: how deep (danger, budgets, depth xp, the
  // ground law) and what connects to what (`crossTo(floor ± 1)`). A structure
  // that is not a stack is impossible while those are the same number, so
  // adjacency becomes something a region can state.
  const hub: Region = {
    ...groundFloor(), id: 'outer-hub', floor: 0,
    exits: [{ to: 'outer-market', via: 'gate', floor: 0 }],
  };
  const market: Region = {
    ...groundFloor(), id: 'outer-market', floor: 0, name: 'The Salt Market',
    exits: [{ to: 'outer-hub', via: 'gate', floor: 0 }],
  };
  const outer = world({
    currentRegion: 'outer-hub',
    currentPlace: 'gate',
    regions: { 'outer-hub': hub, 'outer-market': market },
  });

  const there = traverse(outer, 'outer-market');
  assert.equal(there.kind, 'moved');
  if (there.kind !== 'moved') return;
  assert.equal(there.world.currentRegion, 'outer-market');
  assert.equal(there.world.currentPlace, 'gate', 'you arrive at the region entrance');

  // And back the way you came — neither of these is up or down.
  const back = traverse({ ...there.world, currentPlace: 'gate' }, 'outer-hub');
  assert.equal(back.kind, 'moved');
  if (back.kind === 'moved') assert.equal(back.world.currentRegion, 'outer-hub');
});

test('a way out you are not standing at is refused, and one that does not exist too', () => {
  const hub: Region = {
    ...groundFloor(), id: 'outer-hub', floor: 0,
    exits: [{ to: 'outer-market', via: 'gate', floor: 0 }],
  };
  const outer = world({ currentRegion: 'outer-hub', currentPlace: 'town', regions: { 'outer-hub': hub } });

  const wrongPlace = traverse(outer, 'outer-market');
  assert.equal(wrongPlace.kind, 'error');

  const nowhere = traverse({ ...outer, currentPlace: 'gate' }, 'the-moon');
  assert.equal(nowhere.kind, 'error');
});

test('a stack still derives its ways out from depth, and nothing had to say so', () => {
  // The compatibility claim in one assertion: every world ever saved has no
  // `exits` at all, and its stairs must keep working exactly as before.
  const links = linksFrom(groundFloor());

  assert.deepEqual(
    links.map((l) => [l.direction, l.to, l.floor]),
    [['up', 'floor-1', 1], ['down', 'floor--1', -1]],
  );
});

test('traverse is not a way around the law that guards the stairs', () => {
  // `linksFrom` derives an up and a down for a stack, and `traverse` walking
  // one of those would step past the ground law and the world's floor — both
  // of which live in `descend`. A stair is taken by climbing it.
  const w = world({ currentPlace: 'gate', regions: { 'floor-0': groundFloor() } });
  const sneak = traverse(w, 'floor--1');

  assert.equal(sneak.kind, 'error');
  if (sneak.kind === 'error') assert.match(sneak.reason, /stair/);
  assert.equal(descend(w).kind, 'error', 'and the honest way down is still refused by the law');
});
