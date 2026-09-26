import test from 'node:test';
import assert from 'node:assert/strict';
import { capacityOf, efficiencyOf, runAt, runMethod, runWorkstation } from './workstation.ts';
import type { Building, SubMethod } from './workstation.ts';

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

test('a recipe can use the three categories §3c-i decided but the code never had', () => {
  const method: SubMethod = { input: [{ category: 'seed', count: 1 }], output: [{ category: 'ingredient', count: 1 }, { category: 'tool', count: 1 }], time: 1 };
  assert.deepEqual(runMethod({ seed: 1 }, method, 1).container, { seed: 0, ingredient: 1, tool: 1 });
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

/*
 * A workstation carries its own method (DESIGN 6c §3h) - runWorkstation looks
 * it up by id and runs it through runAt, rather than the caller supplying a
 * method externally. Scoped to `economic` only for now.
 */

test('running a workstation not on the building does nothing', () => {
  assert.equal(runWorkstation({ tier: 1, container: {} }, 'nope', 1), null);
});

test('running a workstation with no method does nothing', () => {
  const b: Building = { tier: 1, container: {}, workstations: [{ id: 'w1', subkind: 'administrative' }] };
  assert.equal(runWorkstation(b, 'w1', 1), null);
});

test('running a workstation runs its own stored method, same as runAt would', () => {
  const method: SubMethod = { input: [{ category: 'material', count: 2 }], output: [{ category: 'weapon', count: 1 }], time: 1 };
  const b: Building = { tier: 1, container: { material: 2 }, workstations: [{ id: 'w1', subkind: 'economic', method }] };
  assert.deepEqual(runWorkstation(b, 'w1', 1), runAt({ tier: 1, container: { material: 2 } }, method, 1));
});

test('two workstations on one building run independently by id', () => {
  const forge: SubMethod = { input: [{ category: 'material', count: 1 }], output: [{ category: 'weapon', count: 1 }], time: 1 };
  const anvil: SubMethod = { input: [{ category: 'material', count: 1 }], output: [{ category: 'part', count: 1 }], time: 1 };
  const b: Building = {
    tier: 1,
    container: { material: 5 },
    workstations: [
      { id: 'forge', subkind: 'economic', method: forge },
      { id: 'anvil', subkind: 'economic', method: anvil },
    ],
  };
  assert.equal(runWorkstation(b, 'forge', 1)!.container.weapon, 1);
  assert.equal(runWorkstation(b, 'anvil', 1)!.container.part, 1);
});

/*
 * The runner off-class penalty (DESIGN 6c §3c): on-class is full efficiency;
 * off-class is judged on the named class's stat, worse if the runner's own
 * class doesn't use that stat at all - "worst to best." Exact magnitudes
 * aren't decided (no-rebalance-until-feature-complete); only the ORDERING is.
 */

test('on-class is always at least as good as any off-class fit', () => {
  const range = [1, 20] as const;
  for (const stat of [1, 10, 20]) {
    assert.ok(efficiencyOf('on-class', stat, range) >= efficiencyOf('shares-stat', stat, range));
    assert.ok(efficiencyOf('on-class', stat, range) >= efficiencyOf('raw-stat', stat, range));
  }
});

test('sharing the named stat off-class beats the raw stat alone, same value', () => {
  const range = [1, 20] as const;
  for (const stat of [1, 10, 20]) assert.ok(efficiencyOf('shares-stat', stat, range) >= efficiencyOf('raw-stat', stat, range));
});

test('efficiency scales worst to best with the stat, in both off-class fits', () => {
  const range = [1, 20] as const;
  for (const fit of ['shares-stat', 'raw-stat'] as const) {
    assert.ok(efficiencyOf(fit, 20, range) >= efficiencyOf(fit, 10, range));
    assert.ok(efficiencyOf(fit, 10, range) >= efficiencyOf(fit, 1, range));
  }
});

test('efficiency never leaves (0, 1]', () => {
  const range = [1, 20] as const;
  for (const fit of ['on-class', 'shares-stat', 'raw-stat'] as const) {
    for (const stat of [1, 10, 20]) {
      const e = efficiencyOf(fit, stat, range);
      assert.ok(e > 0 && e <= 1);
    }
  }
});

test("lower efficiency scales down a workstation's effective hours", () => {
  const method: SubMethod = { input: [], output: [{ category: 'weapon', count: 1 }], time: 1 };
  const b: Building = { tier: 1, container: {}, workstations: [{ id: 'w1', subkind: 'economic', method }] };
  assert.ok(runWorkstation(b, 'w1', 10, 0.5)!.batches < runWorkstation(b, 'w1', 10, 1)!.batches);
});
