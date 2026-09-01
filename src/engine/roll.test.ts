import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, roll, tierFor } from './roll.ts';

test('tier boundaries sit exactly at 6/7/9/10', () => {
  assert.equal(tierFor(2), 'miss');
  assert.equal(tierFor(6), 'miss');
  assert.equal(tierFor(7), 'partial');
  assert.equal(tierFor(9), 'partial');
  assert.equal(tierFor(10), 'hit');
  assert.equal(tierFor(14), 'hit');
});

test('modifier is stat minus opposing stat', () => {
  const r = roll(() => 0, { ability: 'nerve', modifier: 3, vs: { id: 'doctor', ability: 'composure', modifier: 2 } });
  assert.deepEqual(r.dice, [1, 1]);
  assert.equal(r.modifier, 1);
  assert.equal(r.total, 3);
  assert.equal(r.tier, 'miss');
});

test('unopposed rolls use the stat alone', () => {
  const r = roll(() => 0.999, { ability: 'observation', modifier: 2, vs: null });
  assert.deepEqual(r.dice, [6, 6]);
  assert.equal(r.total, 14);
  assert.equal(r.tier, 'hit');
});

test('seeded rng replays identically', () => {
  const a = Array.from({ length: 8 }, mulberry32(42));
  const b = Array.from({ length: 8 }, mulberry32(42));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, Array.from({ length: 8 }, mulberry32(43)));
});

test('dice stay within 1..6 across many rolls', () => {
  const rng = mulberry32(7);
  for (let i = 0; i < 2000; i++) {
    const r = roll(rng, { ability: 'charm', modifier: 0, vs: null });
    for (const d of r.dice) assert.ok(d >= 1 && d <= 6, `die out of range: ${d}`);
  }
});

test('partial success is the modal outcome', () => {
  const rng = mulberry32(99);
  const counts = { miss: 0, partial: 0, hit: 0 };
  for (let i = 0; i < 20000; i++) {
    counts[roll(rng, { ability: 'nerve', modifier: 1, vs: null }).tier]++;
  }
  assert.ok(counts.partial > counts.miss, `partial ${counts.partial} !> miss ${counts.miss}`);
  assert.ok(counts.partial > counts.hit, `partial ${counts.partial} !> hit ${counts.hit}`);
});
