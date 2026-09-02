import test from 'node:test';
import assert from 'node:assert/strict';
import { cellKey, distance, hasLineOfSight, lineCells, occupancyFor, reachable, reachableStops } from './grid.ts';
import type { Combatant, Grid, Vec } from './types.ts';

const grid = (width: number, height: number, walls: string[] = []): Grid => ({
  width, height, walls: new Set(walls),
});

const at = (x: number, y: number): Vec => ({ x, y });

test('distance is Chebyshev — a diagonal costs the same as a step', () => {
  assert.equal(distance(at(0, 0), at(3, 0)), 3);
  assert.equal(distance(at(0, 0), at(3, 3)), 3);
  assert.equal(distance(at(0, 0), at(3, 1)), 3);
  assert.equal(distance(at(2, 2), at(2, 2)), 0);
});

test('a line includes both endpoints and is continuous', () => {
  const cells = lineCells(at(0, 0), at(3, 2));
  assert.deepEqual(cells[0], at(0, 0));
  assert.deepEqual(cells[cells.length - 1], at(3, 2));
  for (let i = 1; i < cells.length; i++) {
    assert.equal(distance(cells[i - 1], cells[i]), 1, 'line must not jump');
  }
});

test('line of sight is clear across open ground', () => {
  assert.equal(hasLineOfSight(grid(10, 10), at(0, 0), at(5, 0)), true);
});

test('a wall between two cells blocks sight', () => {
  assert.equal(hasLineOfSight(grid(10, 10, ['2,0']), at(0, 0), at(5, 0)), false);
});

test('a wall ON either endpoint does not block sight to that cell', () => {
  // You can see the creature standing in the doorway you are aiming at.
  assert.equal(hasLineOfSight(grid(10, 10, ['5,0']), at(0, 0), at(5, 0)), true);
  assert.equal(hasLineOfSight(grid(10, 10, ['0,0']), at(0, 0), at(5, 0)), true);
});

test('sight is symmetric', () => {
  const g = grid(10, 10, ['3,3']);
  const a = at(1, 1);
  const b = at(6, 6);
  assert.equal(hasLineOfSight(g, a, b), hasLineOfSight(g, b, a));
});

const noOne = { blocksPassage: () => false, occupied: () => false };

test('movement is bounded by the budget', () => {
  const r = reachable(grid(20, 20), at(5, 5), 2, noOne);
  assert.equal(r.get(cellKey(at(7, 5))), 2);
  assert.equal(r.get(cellKey(at(7, 7))), 2, 'diagonals cost 1');
  assert.equal(r.has(cellKey(at(8, 5))), false, 'beyond budget');
  assert.equal(r.has(cellKey(at(5, 5))), false, 'the starting square is not a move');
});

test('movement cannot pass through walls or leave the grid', () => {
  // A full vertical wall with no gap seals the left column off.
  const walls = Array.from({ length: 5 }, (_, y) => `1,${y}`);
  const r = reachable(grid(5, 5, walls), at(0, 2), 10, noOne);
  assert.equal(r.has(cellKey(at(2, 2))), false, 'sealed off by the wall');
  assert.equal(r.has(cellKey(at(0, 4))), true, 'can still move along the free column');
  for (const key of r.keys()) {
    const [x, y] = key.split(',').map(Number);
    assert.ok(x >= 0 && y >= 0 && x < 5 && y < 5, `escaped the grid at ${key}`);
  }
});

const fighter = (id: string, side: 'party' | 'foe', pos: Vec): Combatant => ({
  id, name: id, side, abilities: { str: 10, dex: 10, con: 10, agi: 10, vit: 10, int: 10, wis: 10, cha: 10, luk: 10 },
  hp: 10, maxHp: 10, stamina: 10, maxStamina: 10, mana: 10, maxMana: 10, ticks: 6, ac: 10, speed: 6, proficiency: 2, size: 'medium', pos,
  conditions: [], attacks: [], dead: false, dying: false, deathSaves: { successes: 0, failures: 0 },
});

test('you may move through an ally but not through an enemy', () => {
  const ally = fighter('ally', 'party', at(1, 0));
  const foe = fighter('foe', 'foe', at(1, 2));
  const occ = occupancyFor([ally, foe], 'party');
  assert.equal(occ.blocksPassage(at(1, 0)), false, 'allies do not block passage');
  assert.equal(occ.blocksPassage(at(1, 2)), true, 'enemies do');
});

test('you may not END your move sharing a square with anyone', () => {
  const ally = fighter('ally', 'party', at(1, 0));
  const occ = occupancyFor([ally], 'party');
  const stops = reachableStops(grid(5, 5), at(0, 0), 3, occ);
  assert.equal(stops.has(cellKey(at(1, 0))), false, 'cannot stop on the ally');
  assert.equal(stops.has(cellKey(at(2, 0))), true, 'but can move past to the far side');
});

test('a dead combatant stops blocking the square', () => {
  const corpse = { ...fighter('foe', 'foe', at(1, 1)), dead: true };
  const occ = occupancyFor([corpse], 'party');
  assert.equal(occ.blocksPassage(at(1, 1)), false);
  assert.equal(occ.occupied(at(1, 1)), false);
});
