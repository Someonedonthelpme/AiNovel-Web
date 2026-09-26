import test from 'node:test';
import assert from 'node:assert/strict';
import { routeOf } from './route.ts';
import type { Cell } from './route.ts';
import { linkMinutes } from './travel.ts';
import { isWinter } from './calendar.ts';
import { world } from './fixtures.ts';

// W1 (DESIGN 6c §2c): a link's route, sized so its best path costs exactly the link's time.

const cheb = (p: Cell, q: Cell) => Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y));

/** Fewest steps from the first tile to the last, on the route's own tiles, eight ways (combat's grid). */
function bestPath(path: Cell[]): number {
  const key = (c: Cell) => `${c.x},${c.y}`;
  const open = new Set(path.map(key));
  const goal = key(path[path.length - 1]);
  const steps = new Map([[key(path[0]), 0]]);
  const queue = [path[0]];
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i];
    if (key(at) === goal) return steps.get(goal)!;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const next = { x: at.x + dx, y: at.y + dy };
      if (!open.has(key(next)) || steps.has(key(next))) continue;
      steps.set(key(next), steps.get(key(at))! + 1);
      queue.push(next);
    }
  }
  return Infinity;
}

const links = [['gate', 'town'], ['town', 'market'], ['town', 'well']] as const;

test("a route's best path costs exactly its link's time, one tile a second", () => {
  for (let seed = 1; seed <= 20; seed++) for (const [a, b] of links) {
    const w = world({ seed });
    const r = routeOf(w, a, b);
    assert.equal(r.seconds, 60 * linkMinutes(w, a, b));
    assert.equal(r.path.length - 1, r.seconds);
    assert.ok(r.path.slice(1).every((c, i) => cheb(c, r.path[i]) === 1), 'contiguous');
    assert.equal(bestPath(r.path), r.seconds, `seed ${seed} ${a}-${b}: a shortcut`);
  }
});

test('a route is the same both ways, and dealt from the seed', () => {
  const w = world({ seed: 3 });
  assert.deepEqual(routeOf(w, 'market', 'town').path, [...routeOf(w, 'town', 'market').path].reverse());
  assert.deepEqual(routeOf(w, 'town', 'market'), routeOf(world({ seed: 3 }), 'town', 'market'));
  assert.notDeepEqual(routeOf(world({ seed: 4 }), 'town', 'market').path, routeOf(w, 'town', 'market').path);
});

test('the ends lie at least a third of the route apart: a field, not a coil', () => {
  for (let seed = 1; seed <= 20; seed++) for (const [a, b] of links) {
    const r = routeOf(world({ seed }), a, b);
    assert.ok(r.seconds > 0 && cheb(r.path[0], r.path[r.path.length - 1]) >= r.seconds / 3, `seed ${seed} ${a}-${b}`);
  }
});

test('the season does not move a route', () => {
  const base = world({ seed: 5 });
  let winter = -1, summer = -1;
  for (let day = 0; day < 360 && (winter < 0 || summer < 0); day++) {
    const clock = day * 144;
    if (isWinter({ ...base, clock })) winter = winter < 0 ? clock : winter;
    else summer = summer < 0 ? clock : summer;
  }
  assert.deepEqual(routeOf({ ...base, clock: winter }, 'town', 'well'), routeOf({ ...base, clock: summer }, 'town', 'well'));
});

test('a route between places that are not linked is refused, naming both', () => {
  assert.throws(() => routeOf(world({ seed: 1 }), 'gate', 'stair'), /gate.*stair/);
});
