import test from 'node:test';
import assert from 'node:assert/strict';
import { capacityOf, runAt, runMethod } from './workstation.ts';
import type { SubMethod } from './workstation.ts';

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

/*
 * A building's container has a capacity derived from its tier (DESIGN 6c §3g):
 * "a goods pool, capacity read from the building's tier." runAt wires a
 * workstation's method to a building's own container, capped by that capacity.
 */

test('capacity grows strictly across the closed 4-rung tier ladder', () => {
  const caps = [1, 2, 3, 4].map(capacityOf);
  assert.ok(caps.every((c, i) => i === 0 || c > caps[i - 1]));
});

test('output that would exceed capacity caps batches below the unconstrained count', () => {
  const method: SubMethod = { input: [], output: [{ category: 'weapon', count: 1 }], time: 1 };
  const unconstrained = runMethod({}, method, 100).batches;
  const capped = runAt({ tier: 1, container: {} }, method, 100).batches;
  assert.ok(capped < unconstrained);
});

test('a net-negative method is never blocked by capacity, even in a full container', () => {
  const cap = capacityOf(1);
  const method: SubMethod = { input: [{ category: 'material', count: 3 }], output: [{ category: 'weapon', count: 1 }], time: 1 };
  const unconstrained = runMethod({ material: cap }, method, 3).batches;
  const capped = runAt({ tier: 1, container: { material: cap } }, method, 3).batches;
  assert.equal(capped, unconstrained);
});

test('running past capacity fills it exactly, never over', () => {
  const cap = capacityOf(1);
  const out = runAt({ tier: 1, container: {} }, { input: [], output: [{ category: 'weapon', count: 1 }], time: 1 }, cap * 2);
  assert.equal(out.container.weapon, cap);
});
