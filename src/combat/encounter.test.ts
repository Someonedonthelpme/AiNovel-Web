import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../engine/roll.ts';
import { buildEncounter, composition, freeCellsNear, kindForFloor, simulateFight } from './encounter.ts';
import { expectedPcLevel, makeFoe, referencePc, scaleFoe } from './statblock.ts';
import type { Grid } from './types.ts';

const open = (w = 12, h = 12): Grid => ({ width: w, height: h, walls: new Set() });

/* -------------------------------------------------------------------------- */
/* Scaling                                                                     */
/* -------------------------------------------------------------------------- */

test('everything about a foe grows with depth, or holds', () => {
  let previous = scaleFoe(0, 'regular');
  for (let danger = 1; danger <= 30; danger++) {
    const now = scaleFoe(danger, 'regular');
    assert.ok(now.hp >= previous.hp, `hp fell at danger ${danger}`);
    assert.ok(now.ac >= previous.ac, `ac fell at danger ${danger}`);
    assert.ok(now.proficiency >= previous.proficiency, `proficiency fell at danger ${danger}`);
    previous = now;
  }
});

test('roles are ordered by durability', () => {
  const at = (role: 'minion' | 'regular' | 'elite' | 'boss') => scaleFoe(10, role).hp;
  assert.ok(at('minion') < at('regular'));
  assert.ok(at('regular') < at('elite'));
  assert.ok(at('elite') < at('boss'));
});

test('a foe is never born already dead or unhittable', () => {
  for (const danger of [0, 1, 5, 20, 100]) {
    for (const role of ['minion', 'regular', 'elite', 'boss'] as const) {
      const s = scaleFoe(danger, role);
      assert.ok(s.hp >= 1, `${role} at ${danger} had ${s.hp} hp`);
      assert.ok(s.ac <= 19, `${role} at ${danger} had AC ${s.ac}`);
    }
  }
});

/* -------------------------------------------------------------------------- */
/* Composition                                                                 */
/* -------------------------------------------------------------------------- */

test('this is a solo game, so early floors never gang up', () => {
  // Action economy, not statistics, is what kills a lone character.
  for (let floor = 1; floor < 16; floor++) {
    const roles = composition(floor, 'skirmish');
    assert.equal(roles.length, 1, `floor ${floor} sent ${roles.length} foes at a solo climber`);
  }
});

test('depth raises quality before it raises numbers', () => {
  assert.deepEqual(composition(2), ['regular']);
  assert.deepEqual(composition(8), ['elite']);
  assert.ok(composition(20).length > 1, 'company eventually arrives');
  assert.equal(composition(20)[0], 'elite', 'and it is led by something serious');
});

test('a boss always fights alone', () => {
  for (const floor of [10, 20, 30, 50]) {
    assert.deepEqual(composition(floor, 'boss'), ['boss']);
  }
});

test('every tenth floor is a boss floor', () => {
  assert.equal(kindForFloor(10), 'boss');
  assert.equal(kindForFloor(20), 'boss');
  assert.equal(kindForFloor(9), 'skirmish');
  assert.equal(kindForFloor(0), 'skirmish', 'the ground town is not a boss fight');
});

/* -------------------------------------------------------------------------- */
/* Placement                                                                   */
/* -------------------------------------------------------------------------- */

test('foes are never placed in walls, off the grid, or on each other', () => {
  const grid: Grid = { width: 8, height: 8, walls: new Set(['4,4', '4,5', '5,4']) };
  const taken = new Set<string>();
  const cells = freeCellsNear(grid, { x: 4, y: 4 }, taken, 5);

  assert.equal(cells.length, 5);
  const seen = new Set<string>();
  for (const c of cells) {
    const key = `${c.x},${c.y}`;
    assert.equal(grid.walls.has(key), false, `placed in a wall at ${key}`);
    assert.ok(c.x >= 0 && c.y >= 0 && c.x < 8 && c.y < 8, `off the grid at ${key}`);
    assert.equal(seen.has(key), false, `two foes share ${key}`);
    seen.add(key);
  }
});

test('an encounter is built with distinct ids and real positions', () => {
  const foes = buildEncounter({ danger: 20, grid: open(), origin: { x: 9, y: 6 } });
  assert.ok(foes.length >= 1);
  assert.equal(new Set(foes.map((f) => f.id)).size, foes.length);
  for (const f of foes) assert.equal(f.side, 'foe');
});

test('names from the model are used, and recycled rather than running out', () => {
  const foes = buildEncounter({ danger: 30, grid: open(), origin: { x: 6, y: 6 }, names: ['ตัวเงือก'] });
  for (const f of foes) assert.equal(f.name, 'ตัวเงือก');
});

/* -------------------------------------------------------------------------- */
/* The difficulty curve, measured                                              */
/* -------------------------------------------------------------------------- */

function winRate(floor: number, trials = 120): number {
  const grid = open();
  let wins = 0;
  for (let i = 0; i < trials; i++) {
    const rng = mulberry32(floor * 7919 + i);
    const pc = { ...referencePc(expectedPcLevel(floor)), pos: { x: 1, y: 6 } };
    const foes = buildEncounter({ danger: floor, grid, origin: { x: 9, y: 6 } });
    if (simulateFight(rng, [pc], foes, grid).victor === 'party') wins++;
  }
  return wins / trials;
}

test('every fight terminates rather than stalling', () => {
  const grid = open();
  for (const floor of [1, 10, 30]) {
    const rng = mulberry32(floor);
    const pc = { ...referencePc(expectedPcLevel(floor)), pos: { x: 1, y: 6 } };
    const foes = buildEncounter({ danger: floor, grid, origin: { x: 9, y: 6 } });
    const r = simulateFight(rng, [pc], foes, grid);
    assert.notEqual(r.victor, null, `floor ${floor} never resolved`);
    assert.ok(r.rounds < 100, `floor ${floor} ran ${r.rounds} rounds`);
  }
});

test('early floors are survivable and deep floors are not free', () => {
  // Both sides use naive AI here, so these rates are a FLOOR on what a real
  // player achieves — a person retreats, uses terrain, and picks their fights.
  const early = winRate(2);
  const deep = winRate(30);
  assert.ok(early > 0.8, `floor 2 win rate was ${early}`);
  assert.ok(deep < early, `floor 30 (${deep}) was no harder than floor 2 (${early})`);
  assert.ok(deep > 0.2, `floor 30 at ${deep} is a wall, not a challenge`);
});

test('a boss floor is a real wall without being hopeless', () => {
  const rate = winRate(20);
  assert.ok(rate > 0.25 && rate < 0.8, `floor 20 boss win rate was ${rate}`);
});

test('difficulty rises with depth rather than spiking', () => {
  // The regression this guards: adding one extra body used to cost ~30 points of
  // win rate, making floor 14 harder than the floor-20 boss.
  const rates = [5, 10, 20].map((f) => winRate(f, 80));
  for (let i = 1; i < rates.length; i++) {
    assert.ok(rates[i] <= rates[i - 1] + 0.1, `difficulty went backwards: ${rates.join(', ')}`);
  }
});
