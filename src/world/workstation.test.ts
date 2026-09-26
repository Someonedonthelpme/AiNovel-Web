import test from 'node:test';
import assert from 'node:assert/strict';
import { runMethod } from './workstation.ts';

/*
 * A workstation runs a sub-method against a building's container (DESIGN 6c §3h):
 * input and output are goods lists, time is a single scalar. No buildings, no
 * modules, no AL yet — just the mechanical unit itself.
 */

test('exactly one time-unit of work, sufficient input, produces one batch', () => {
  const out = runMethod({ material: 2 }, { input: [{ category: 'material', count: 2 }], output: [{ category: 'weapon', count: 1 }], time: 1 }, 1);
  assert.deepEqual(out.container, { material: 0, weapon: 1 });
  assert.equal(out.batches, 1);
});

test("less than the method's time produces nothing, container unchanged", () => {
  const c = { material: 2 };
  const out = runMethod(c, { input: [{ category: 'material', count: 2 }], output: [{ category: 'weapon', count: 1 }], time: 2 }, 1);
  assert.deepEqual(out.container, c);
  assert.equal(out.batches, 0);
});

test('insufficient input blocks production even with enough time', () => {
  const out = runMethod({ material: 1 }, { input: [{ category: 'material', count: 2 }], output: [{ category: 'weapon', count: 1 }], time: 1 }, 5);
  assert.equal(out.batches, 0);
});

test('multiple time-units, enough input, produce multiple batches proportionally', () => {
  const out = runMethod({ material: 6 }, { input: [{ category: 'material', count: 2 }], output: [{ category: 'weapon', count: 1 }], time: 1 }, 3);
  assert.deepEqual(out.container, { material: 0, weapon: 3 });
});

test('a container category never goes negative', () => {
  const out = runMethod({ material: 3 }, { input: [{ category: 'material', count: 2 }], output: [{ category: 'weapon', count: 1 }], time: 1 }, 5);
  assert.ok(Object.values(out.container).every((n) => n! >= 0));
});
