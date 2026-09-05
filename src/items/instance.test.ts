import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attach, conditionOfInstance, detach, detachable, findPart, grantsOfInstance,
  instanceOf, isBroken, PRISTINE, shapeOfInstance, walk, weakestPart, weightOfInstance, wear,
} from './instance.ts';
import type { ItemInstance } from './instance.ts';
import { maskOf } from './shape.ts';
import { weightOf } from './types.ts';
import type { Item } from './types.ts';

const type = (id: string, over: Partial<Item> = {}): Item =>
  ({ id, name: id, description: '', kind: 'equipment', stackable: false, value: 0, ...over });

/** A sword: blade, guard, handle — and the handle is itself made of parts. */
const TYPES: Record<string, Item> = {
  frame: type('frame', { shape: 'X' }),
  blade: type('blade', { shape: 'X/X/X', grants: { str: 2 } }),
  guard: type('guard', { shape: 'XXX' }),
  handle: type('handle', { shape: 'X', grants: { dex: 1 } }),
  wood: type('wood', { kind: 'material', shape: 'X' }),
  pommel: type('pommel', { shape: 'X', grants: { str: 1 } }),
};
const typeOf = (id: string) => TYPES[id] ?? null;

/**
 * blade (3 tall) with a guard below it, a handle below that, and inside the
 * handle a fused wooden core and a pommel.
 */
function sword(): ItemInstance {
  return instanceOf('sw', 'frame', {
    parts: [
      { at: { x: 1, y: 0 }, item: instanceOf('p_blade', 'blade') },
      { at: { x: 0, y: 3 }, item: instanceOf('p_guard', 'guard') },
      {
        at: { x: 1, y: 4 },
        item: instanceOf('p_handle', 'handle', {
          parts: [
            { at: { x: 0, y: 1 }, item: instanceOf('p_wood', 'wood', { fused: true }) },
            { at: { x: 0, y: 2 }, item: instanceOf('p_pommel', 'pommel') },
          ],
        }),
      },
    ],
  });
}

/* -------------------------------------------------------------------------- */
/* The tree                                                                    */
/* -------------------------------------------------------------------------- */

test('an item is a tree, and walking it reaches every depth', () => {
  const ids = walk(sword()).map((p) => p.id);
  assert.deepEqual(ids, ['sw', 'p_blade', 'p_guard', 'p_handle', 'p_wood', 'p_pommel']);
});

test('a fused piece is still a part — it just cannot come off', () => {
  // The boundary that bounds recursion instead of a depth cap. A x3 scope on a
  // 30mm rail is not swapped for an x4; the assembly is recreated.
  const ids = detachable(sword()).map((p) => p.id);
  assert.ok(ids.includes('p_pommel'));
  assert.ok(!ids.includes('p_wood'), 'the wooden core was made into the handle');
  assert.ok(findPart(sword(), 'p_wood'), 'but it is still there, carrying its stats and wear');
});

/* -------------------------------------------------------------------------- */
/* What the assembly adds up to                                                */
/* -------------------------------------------------------------------------- */

test('the silhouette IS the assembly', () => {
  // A modified weapon looks modified in your bag — the whole point of deriving
  // shape from parts rather than storing one.
  const whole = shapeOfInstance(sword(), typeOf);
  const bare = shapeOfInstance(instanceOf('x', 'frame'), typeOf);
  assert.ok(maskOf(whole).length > maskOf(bare).length);
  assert.equal(maskOf(bare), 'X');
});

test('a longer haft is literally longer', () => {
  const short = instanceOf('a', 'frame', { parts: [{ at: { x: 0, y: 1 }, item: instanceOf('h', 'handle') }] });
  const long = instanceOf('b', 'frame', {
    parts: [
      { at: { x: 0, y: 1 }, item: instanceOf('h1', 'handle') },
      { at: { x: 0, y: 2 }, item: instanceOf('h2', 'handle') },
    ],
  });
  assert.ok(maskOf(shapeOfInstance(long, typeOf)).length > maskOf(shapeOfInstance(short, typeOf)).length);
});

test('you carry the parts as well as the frame', () => {
  const bare = weightOfInstance(instanceOf('x', 'frame'), typeOf, weightOf);
  const built = weightOfInstance(sword(), typeOf, weightOf);
  assert.ok(built > bare);
});

test('stats sum over the whole assembly, at any depth', () => {
  // str 2 from the blade + str 1 from the pommel, which is a part of a part.
  const grants = grantsOfInstance(sword(), typeOf);
  assert.equal(grants.str, 3);
  assert.equal(grants.dex, 1);
});

/* -------------------------------------------------------------------------- */
/* Wear                                                                        */
/* -------------------------------------------------------------------------- */

test('a sound blade does not save a shattered handle', () => {
  // The worst piece, not an average — averaging would report a broken sword as
  // half fine, and it is what makes repairing the FAILED PART the real action.
  const hurt = wear(sword(), 'p_handle', PRISTINE);
  assert.equal(conditionOfInstance(hurt), 0);
  assert.equal(isBroken(hurt), true);
  assert.equal(findPart(hurt, 'p_blade')?.condition, PRISTINE, 'the blade is untouched');
});

test('the weakest part is the one a repair should target', () => {
  const hurt = wear(wear(sword(), 'p_guard', 30), 'p_pommel', 60);
  assert.equal(weakestPart(hurt).id, 'p_pommel');
});

test('repair is wear with the sign flipped, and never overfills', () => {
  const hurt = wear(sword(), 'p_blade', 40);
  const fixed = wear(hurt, 'p_blade', -100);
  assert.equal(findPart(fixed, 'p_blade')?.condition, PRISTINE);
});

test('wear cannot drive a part below broken', () => {
  const gone = wear(sword(), 'p_blade', 9999);
  assert.equal(findPart(gone, 'p_blade')?.condition, 0);
});

/* -------------------------------------------------------------------------- */
/* Taking it apart                                                             */
/* -------------------------------------------------------------------------- */

test('a detachable part comes off, and its stats go with it', () => {
  const { item, removed, error } = detach(sword(), 'p_pommel');
  assert.equal(error, null);
  assert.equal(removed?.id, 'p_pommel');
  assert.equal(grantsOfInstance(item, typeOf).str, 2, 'the pommel took its point with it');
  assert.equal(findPart(item, 'p_pommel'), null);
});

test('a fused part refuses BY NAME rather than quietly doing nothing', () => {
  const { item, error } = detach(sword(), 'p_wood');
  assert.match(error ?? '', /made as one piece/);
  assert.ok(findPart(item, 'p_wood'), 'and it is still attached');
});

test('attaching adds the part and its stats', () => {
  const stripped = detach(sword(), 'p_pommel').item;
  const back = attach(stripped, instanceOf('p_pommel', 'pommel'), { x: 0, y: 2 });
  assert.equal(back.error, null);
  assert.equal(grantsOfInstance(back.item, typeOf).str, 3);
});

test('the same part cannot be attached twice', () => {
  assert.match(attach(sword(), instanceOf('p_pommel', 'pommel'), { x: 0, y: 0 }).error ?? '', /already on/);
});

test('a thing cannot contain itself', () => {
  const s = sword();
  assert.match(attach(s, s, { x: 0, y: 0 }).error ?? '', /cannot contain itself/);
});

test('taking a part off is pure — the original is untouched', () => {
  const before = sword();
  detach(before, 'p_pommel');
  assert.ok(findPart(before, 'p_pommel'), 'nothing was mutated');
});
