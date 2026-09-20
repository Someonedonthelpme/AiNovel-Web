import test from 'node:test';
import assert from 'node:assert/strict';
import { arenaAt, gridOfArena } from './arena.ts';
import { ARENA_SIZE, beginEncounter } from './combat.ts';
import { foldPlay } from './delta.ts';
import { playState } from './fixtures.ts';
import { reachable } from '../combat/grid.ts';
import { drawMap, fieldId, hubId, portalsOf, positionOf, unplaced } from '../world/map.ts';
import { groundFloor } from '../world/fixtures.ts';
import { speciesFor } from '../character/species.ts';
import type { GameMap } from '../world/map.ts';
import type { PlayState } from './state.ts';
import type { Region } from '../world/types.ts';

/*
 * W7 (DESIGN 6c §2c): a fight happens on the ground you are standing on — the
 * map's own walls and rough — and the arena is RECORDED, so a replay fights the
 * same fight without ever reading a tile.
 */

const tiny = (rows: string[]): GameMap => ({ id: 'field:floor-0:a|b', kind: 'field', rows });
const none = { blocksPassage: () => false, occupied: () => false };

/** Floor 2, dangerous, standing on the field between the town and the well. */
function onField(): PlayState {
  const base = playState();
  const floor: Region = { ...groundFloor(), id: 'floor-2', floor: 2, danger: 8, name: 'The Grey Grove' };
  const world = { ...base.world, seed: 11, species: speciesFor(11), currentRegion: 'floor-2', regions: { 'floor-2': floor }, currentPlace: 'town' };
  const field = drawMap(world, fieldId('floor-2', 'town', 'well'));
  const end = portalsOf(world, field).find((p) => 'to' in p && p.to === hubId('floor-2', 'town'))!;
  return { ...base, world: { ...world, at: { map: field.id, x: end.x, y: end.y } } };
}

test('the arena is a window of the map you stand on, shifted to stay inside it', () => {
  const s = playState();
  const m = drawMap(s.world, hubId('floor-0', 'town'));
  const corner = arenaAt(m, { x: 0, y: 0 });
  assert.equal(corner.rows.length, ARENA_SIZE);
  assert.equal(corner.rows[0].length, ARENA_SIZE);
  assert.ok(corner.x0 >= 0 && corner.y0 >= 0);
  const mid = arenaAt(m, { x: 20, y: 20 });
  assert.ok(mid.x0 + ARENA_SIZE <= m.rows[0].length && mid.y0 + ARENA_SIZE <= m.rows.length);
  assert.equal(mid.rows[20 - mid.y0][20 - mid.x0], m.rows[20][20], 'the same ground, in place');
});

test('walls are walls and rough is difficult ground', () => {
  const g = gridOfArena(arenaAt(tiny(['.#,', '...', '...']), { x: 1, y: 1 }));
  assert.ok(g.walls.has('1,0'), 'the wall');
  assert.ok(!g.walls.has('2,0') && g.rough?.has('2,0'), 'the rough is crossable, at a price');
});

test('entering difficult ground costs two', () => {
  const g = { width: 3, height: 1, walls: new Set<string>(), rough: new Set(['1,0']) };
  assert.equal(reachable(g, { x: 0, y: 0 }, 2, none).get('2,0'), undefined, 'two is not enough to cross it');
  assert.equal(reachable(g, { x: 0, y: 0 }, 3, none).get('2,0'), 3);
  assert.equal(reachable({ ...g, rough: new Set<string>() }, { x: 0, y: 0 }, 2, none).get('2,0'), 2, 'open ground still costs one');
});

test('a fight on a field is fought on the field, and nobody stands in a wall', () => {
  const s = onField();
  const at = positionOf(s.world);
  const arena = arenaAt(drawMap(s.world, at.map), at);
  const fight = beginEncounter(s, 'them', arena);
  assert.ok(fight.combat, 'a fight opened');
  assert.deepEqual([...fight.combat!.grid.walls].sort(), [...gridOfArena(arena).walls].sort());
  for (const c of Object.values(fight.combat!.combatants)) {
    assert.ok(!fight.combat!.grid.walls.has(`${c.pos.x},${c.pos.y}`), `${c.name} is inside a wall`);
  }
});

test('the arena is recorded, and a replay fights on it rather than on the map', () => {
  const s = onField();
  const at = positionOf(s.world);
  const record = {
    kind: 'turn' as const, input: 'x', mode: 'exploration' as const, classification: 'NEUTRAL' as const,
    addressed: null, roll: null, delta: { startCombat: true, startedBy: 'them' as const }, rejected: [], prose: '',
    arena: arenaAt(drawMap(s.world, at.map), at),
  };
  // The same seed, different ground: a biome the generator reads differently.
  const region = s.world.regions['floor-2'] as Region;
  const elsewhere = { ...s, world: { ...s.world, regions: { 'floor-2': { ...region, biome: 'salt marsh' } } } };
  assert.notDeepEqual(drawMap(elsewhere.world, at.map).rows, drawMap(s.world, at.map).rows, 'the map really changed');
  const here = foldPlay(s, [record]).combat;
  const there = foldPlay(elsewhere, [record]).combat;
  // The fold fights on the RECORDED ground, not on a fresh arena of its own.
  assert.deepEqual([...here!.grid.walls].sort(), [...gridOfArena(record.arena).walls].sort());
  assert.deepEqual([...here!.grid.walls].sort(), [...there!.grid.walls].sort(), 'same ground under the fight');
  assert.deepEqual(here!.combatants, there!.combatants);
});

test('a fight with nowhere on a map still gets an arena', () => {
  const s = onField();
  const nowhere = { ...s, world: unplaced(s.world) };
  const fight = beginEncounter(nowhere, 'them');
  assert.equal(fight.combat?.grid.width, ARENA_SIZE);
});
