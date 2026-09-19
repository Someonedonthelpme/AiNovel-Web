import test from 'node:test';
import assert from 'node:assert/strict';
import { bestPath, drawMap, fieldId, hubId, portalsOf } from './map.ts';
import type { GameMap } from './map.ts';
import { linkMinutes } from './travel.ts';
import { firstFloor, groundFloor, world } from './fixtures.ts';
import { applyDelta } from '../play/delta.ts';
import { playState } from '../play/fixtures.ts';
import type { World } from './types.ts';

// W2 (DESIGN 6c §2c): the engine draws hub and field maps from the seed.

const links = [['gate', 'town'], ['town', 'market'], ['town', 'well']] as const;
const walkable = (m: GameMap) => m.rows.join('').replace(/#/g, '').length;
const portal = (w: World, m: GameMap, to: string) => portalsOf(w, m).find((p) => 'to' in p && p.to === to)!;

test('pathfinding: eight ways, rough costs two, walls block, no way is Infinity', () => {
  const m = { id: 't', kind: 'field', rows: ['.,.', '.#.', '...'] } as GameMap;
  assert.equal(bestPath(m, { x: 0, y: 0 }, { x: 2, y: 0 }), 3, 'across the rough tile, 1 + 2');
  assert.equal(bestPath(m, { x: 0, y: 0 }, { x: 2, y: 2 }), 3, 'the wall forces the long way');
  assert.equal(bestPath({ ...m, rows: ['.#.', '.#.', '.#.'] }, { x: 0, y: 0 }, { x: 2, y: 0 }), Infinity);
});

test("a field's best path, portal to portal, costs exactly its link's time", () => {
  for (let seed = 1; seed <= 10; seed++) for (const [a, b] of links) {
    const w = world({ seed });
    const m = drawMap(w, fieldId('floor-0', a, b));
    const from = portal(w, m, hubId('floor-0', a));
    const to = portal(w, m, hubId('floor-0', b));
    assert.equal(bestPath(m, from, to), 60 * linkMinutes(w, a, b), `seed ${seed} ${a}-${b}`);
  }
});

test('the same holds on a dead forest with wild ends', () => {
  for (let seed = 1; seed <= 10; seed++) for (const [a, b] of [['landing', 'grove'], ['grove', 'camp'], ['grove', 'rise']]) {
    const w = world({ seed, regions: { 'floor-1': firstFloor() }, currentRegion: 'floor-1', currentPlace: 'landing' });
    const m = drawMap(w, fieldId('floor-1', a, b));
    const cost = bestPath(m, portal(w, m, hubId('floor-1', a)), portal(w, m, hubId('floor-1', b)));
    assert.equal(cost, 60 * linkMinutes(w, a, b), `seed ${seed} ${a}-${b}`);
  }
});

test('a field is a band, not a corridor, and the same map from either end', () => {
  const w = world({ seed: 2 });
  const m = drawMap(w, fieldId('floor-0', 'town', 'market'));
  assert.ok(walkable(m) >= 3 * 60 * linkMinutes(w, 'town', 'market'), `${walkable(m)} walkable`);
  assert.equal(fieldId('floor-0', 'market', 'town'), fieldId('floor-0', 'town', 'market'));
  assert.equal(portalsOf(w, m).length, 2);
});

test('a hard biome grows more rough ground than an open one', () => {
  const rough = (biome: string) => {
    const m = drawMap(world({ seed: 2, regions: { 'floor-0': { ...groundFloor(), biome } } }), fieldId('floor-0', 'town', 'market'));
    return (m.rows.join('').match(/,/g)?.length ?? 0) / walkable(m);
  };
  assert.ok(rough('salt marsh') > rough('grass plain'), `${rough('salt marsh')} vs ${rough('grass plain')}`);
});

test('a hub has a portal for each link and each way out through it, all reachable from each other', () => {
  const w = world({ seed: 3 });
  const town = drawMap(w, hubId('floor-0', 'town'));
  assert.deepEqual(portalsOf(w, town).map((p) => ('to' in p ? p.to : p.region)).sort(),
    ['gate', 'market', 'stair', 'well'].map((n) => fieldId('floor-0', 'town', n)).sort());
  const stair = drawMap(w, hubId('floor-0', 'stair'));
  assert.ok(portalsOf(w, stair).some((p) => 'region' in p && p.region === 'floor-1'), 'the way up');
  const all = portalsOf(w, town);
  assert.ok(all.length > 0);
  for (const p of all) for (const q of all) assert.ok(bestPath(town, p, q) < Infinity);
});

test('a hub is shaped, not a filled box', () => {
  assert.ok(drawMap(world({ seed: 3 }), hubId('floor-0', 'town')).rows.join('').includes('#'));
});

test('a way revealed after a hub is drawn gets a portal; the tiles and the other portals do not move', () => {
  const s = playState({ seed: 3 });
  const m = drawMap(s.world, hubId('floor-0', 'well'));
  const before = portalsOf(s.world, m);
  const after = portalsOf(applyDelta(s, { revealWay: 'well' }).world, m);
  assert.equal(after.length, before.length + 1);
  for (const p of before) assert.ok(after.some((q) => q.x === p.x && q.y === p.y), `${p.x},${p.y} moved`);
});

test('a map is dealt from the seed, and survives JSON', () => {
  const id = hubId('floor-0', 'town');
  const m = drawMap(world({ seed: 5 }), id);
  assert.deepEqual(drawMap(world({ seed: 5 }), id), m);
  assert.notDeepEqual(drawMap(world({ seed: 6 }), id).rows, m.rows);
  assert.deepEqual(JSON.parse(JSON.stringify(m)), m);
});

test('a map of something that is not there is refused, naming it', () => {
  assert.throws(() => drawMap(world(), fieldId('floor-0', 'gate', 'stair')), /gate.*stair/);
  assert.throws(() => drawMap(world(), hubId('floor-0', 'moon')), /moon/);
});
