import test from 'node:test';
import assert from 'node:assert/strict';
import {
  area, cellsOf, firstFit, fits, join, maskOf, normalise, occupiedCells,
  orientations, packAll, rect, rotate, shapeFrom,
} from './shape.ts';
import { shapeOf } from './types.ts';
import type { Item } from './types.ts';

const T = shapeFrom('XXX/.X.');
const L = shapeFrom('X./X./XX');
const SWORD = shapeFrom('XXXXX');
const DAGGER = shapeFrom('XX');

/* -------------------------------------------------------------------------- */
/* Reading and writing shapes                                                  */
/* -------------------------------------------------------------------------- */

test('a mask round-trips, so what you write is what you get', () => {
  assert.equal(maskOf(T), 'XXX/.X.');
  assert.equal(maskOf(L), 'X./X./XX');
  assert.equal(maskOf(SWORD), 'XXXXX');
});

test('a shape is normalised to the origin', () => {
  // The same T drawn in the middle of nowhere is the same T.
  const adrift = normalise([{ x: 7, y: 5 }, { x: 8, y: 5 }, { x: 9, y: 5 }, { x: 8, y: 6 }]);
  assert.equal(maskOf(adrift), maskOf(T));
});

test('a cell written twice is still one cell', () => {
  // Otherwise a shape would be heavier to pack than it looks.
  const doubled = normalise([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }]);
  assert.equal(area(doubled), 2);
});

test('size means something: a longsword costs more room than a dagger', () => {
  assert.equal(area(SWORD), 5);
  assert.equal(area(DAGGER), 2);
});

/* -------------------------------------------------------------------------- */
/* Assembled from squares                                                      */
/* -------------------------------------------------------------------------- */

test('a shape is built by combining squares — one head makes an L', () => {
  const haft = shapeFrom('X/X/X');
  const head = shapeFrom('X');
  assert.equal(maskOf(join(haft, head, { x: 1, y: 2 })), 'X./X./XX');
});

test('and two heads make a T', () => {
  // The user's own example: a two-headed axe is a different silhouette from a
  // one-headed one, because it is literally a different assembly.
  const haft = shapeFrom('X');
  const heads = shapeFrom('XXX');
  assert.equal(maskOf(join(heads, haft, { x: 1, y: 1 })), 'XXX/.X.');
});

test('joining is order-independent for the same cells', () => {
  const a = join(shapeFrom('XX'), shapeFrom('X'), { x: 0, y: 1 });
  const b = join(shapeFrom('X'), shapeFrom('XX'), { x: 0, y: -1 });
  assert.equal(maskOf(a), maskOf(b));
});

/* -------------------------------------------------------------------------- */
/* Turning                                                                     */
/* -------------------------------------------------------------------------- */

test('a quarter turn puts a longsword on its side', () => {
  assert.equal(maskOf(rotate(SWORD)), 'X/X/X/X/X');
});

test('four turns comes back to where it started', () => {
  assert.equal(maskOf(rotate(rotate(rotate(rotate(L))))), maskOf(L));
});

test('only DISTINCT orientations are tried', () => {
  // A square has one, a line has two, an L has four. Trying four of a square
  // would place the same thing four times and cost four times the search.
  assert.equal(orientations(rect(2, 2)).length, 1);
  assert.equal(orientations(SWORD).length, 2);
  assert.equal(orientations(L).length, 4);
});

/* -------------------------------------------------------------------------- */
/* Fitting                                                                     */
/* -------------------------------------------------------------------------- */

test('something must be inside the board AND on free cells', () => {
  const board = rect(3, 3);
  assert.equal(fits(board, [], SWORD, { x: 0, y: 0 }), false, 'five does not fit across three');
  assert.equal(fits(board, [], DAGGER, { x: 0, y: 0 }), true);
  assert.equal(fits(board, [], DAGGER, { x: 2, y: 0 }), false, 'and it may not hang off the edge');
});

test('a board is not a rectangle — an irregular container has a notch', () => {
  // The point of boards having their own shape: a bag with a bite out of it.
  const notched = shapeFrom('XXX/XX./XXX');
  assert.equal(fits(notched, [], DAGGER, { x: 0, y: 1 }), true);
  assert.equal(fits(notched, [], DAGGER, { x: 1, y: 1 }), false, 'the notch is not a cell');
});

test('two things cannot occupy one cell', () => {
  const board = rect(4, 2);
  const taken = [{ id: 'a', shape: DAGGER, at: { x: 0, y: 0 } }];
  assert.equal(fits(board, taken, DAGGER, { x: 0, y: 0 }), false);
  assert.equal(fits(board, taken, DAGGER, { x: 2, y: 0 }), true);
});

test('rotation is what lets an awkward thing fit at all', () => {
  // A five-long sword in a 2×5 board only goes in on its side.
  const tall = rect(2, 5);
  assert.equal(firstFit(tall, [], SWORD, false), null, 'not as drawn');
  assert.ok(firstFit(tall, [], SWORD, true), 'but turned, yes');
});

test('placement is deterministic — the fold depends on it', () => {
  // Auto-placement runs inside the fold, so a pack that packed itself
  // differently on replay would be a different pack.
  const board = shapeFrom('XXXX/XX.X/XXXX');
  const once = firstFit(board, [], L);
  const twice = firstFit(board, [], L);
  assert.deepEqual(once, twice);
});

test('a full board refuses rather than overlapping', () => {
  const board = rect(2, 1);
  const placed = [{ id: 'a', shape: DAGGER, at: { x: 0, y: 0 } }];
  assert.equal(firstFit(board, placed, DAGGER), null);
});

test('cells of a placement are offset by where it sits', () => {
  const p = { id: 'a', shape: DAGGER, at: { x: 2, y: 1 } };
  assert.deepEqual(cellsOf(p), [{ x: 2, y: 1 }, { x: 3, y: 1 }]);
  assert.equal(occupiedCells([p]).size, 2);
});

/* -------------------------------------------------------------------------- */
/* Packing a whole bag                                                         */
/* -------------------------------------------------------------------------- */

test('a bag packs what it can and names what it cannot', () => {
  const board = rect(5, 2);
  const { placed, rejected } = packAll(board, [
    { id: 'sword', shape: SWORD },
    { id: 'knife', shape: DAGGER },
    { id: 'slab', shape: rect(4, 4) },
  ]);
  assert.ok(placed.some((p) => p.id === 'sword'));
  assert.deepEqual(rejected, ['slab'], 'what will not go in is reported, not dropped silently');
});

test('nothing packed ever overlaps', () => {
  const board = rect(6, 4);
  const { placed } = packAll(board, [
    { id: 'a', shape: T }, { id: 'b', shape: L }, { id: 'c', shape: SWORD },
    { id: 'd', shape: DAGGER }, { id: 'e', shape: rect(2, 2) },
  ]);
  const cells = placed.flatMap(cellsOf).map((c) => `${c.x},${c.y}`);
  assert.equal(new Set(cells).size, cells.length, 'every occupied cell is claimed once');
});

test('packing is deterministic for the same input', () => {
  const board = rect(5, 4);
  const items = [{ id: 'a', shape: L }, { id: 'b', shape: T }, { id: 'c', shape: SWORD }];
  assert.deepEqual(packAll(board, items), packAll(board, items));
});

test('order of the input does not change the outcome', () => {
  // Largest-first sorting is what makes this true, and it is what stops a
  // pack rearranging itself because loot happened to arrive in a new order.
  const board = rect(5, 4);
  const a = packAll(board, [{ id: 'a', shape: L }, { id: 'b', shape: T }, { id: 'c', shape: SWORD }]);
  const b = packAll(board, [{ id: 'c', shape: SWORD }, { id: 'a', shape: L }, { id: 'b', shape: T }]);
  assert.deepEqual(a, b);
});

/* -------------------------------------------------------------------------- */
/* Where a generated item's shape comes from                                    */
/* -------------------------------------------------------------------------- */

const item = (over: Partial<Item> = {}): Item =>
  ({ id: 'x', name: 'x', description: '', kind: 'material', stackable: true, value: 0, ...over });

test('an archetype in the id gives the silhouette, with nothing authored', () => {
  // Generated ids carry what they were made from — `weapon_axe_d8` — which is
  // how a generated weapon gets a shape without a mask per item.
  assert.equal(maskOf(shapeOf(item({ id: 'weapon_axe_d8', kind: 'equipment' }))), 'XX/X./X.');
  assert.equal(maskOf(shapeOf(item({ id: 'weapon_spear_d6', kind: 'equipment' }))), 'X/X/X/X');
});

test('a one-headed axe and a two-headed axe are different silhouettes', () => {
  const one = shapeOf(item({ id: 'weapon_axe_d8', kind: 'equipment' }));
  const two = shapeOf(item({ id: 'weapon_greataxe_d12', kind: 'equipment' }));
  assert.notEqual(maskOf(one), maskOf(two));
  // A haft with a head hung off it is an L; a haft with a head either side is
  // a T on a stick. Both fall out of `join` rather than being drawn.
  assert.equal(maskOf(one), 'XX/X./X.');
  assert.equal(maskOf(two), 'XXX/.X./.X./.X.');
  assert.ok(area(two) > area(one), 'and the bigger weapon costs more room');
});

test('an explicit mask overrides everything', () => {
  assert.equal(maskOf(shapeOf(item({ shape: 'XX/XX' }))), 'XX/XX');
});

test('nothing is ever shapeless', () => {
  // The same guarantee `weightOf` gives: an anonymous generated item still has
  // a silhouette, so it can never be free to carry in a slot world.
  assert.ok(area(shapeOf(item())) > 0);
  assert.ok(area(shapeOf(item({ kind: 'equipment', slot: 'armour' }))) > 0);
  assert.ok(area(shapeOf(item({ kind: 'consumable' }))) > 0);
});

test('armour is bulkier than a phial', () => {
  const plate = shapeOf(item({ id: 'armour_scale', kind: 'equipment', slot: 'armour' }));
  const phial = shapeOf(item({ id: 'draught_t1', kind: 'consumable' }));
  assert.ok(area(plate) > area(phial));
});
