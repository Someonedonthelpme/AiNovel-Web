import test from 'node:test';
import assert from 'node:assert/strict';
import { activeRegion, ascend, currentPlace, descend, exitsFrom, installRegion, moveWithinRegion } from './travel.ts';
import { compressRegion } from './lod.ts';
import { firstFloor, groundFloor, link, place, world } from './fixtures.ts';
import { isFull } from './types.ts';
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
