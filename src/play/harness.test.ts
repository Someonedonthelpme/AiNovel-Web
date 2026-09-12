import test from 'node:test';
import assert from 'node:assert/strict';
import { ABILITIES } from '../combat/types.ts';
import { finalAbilities } from '../session/sheet.ts';
import { BUILDS, buildSheet, chart, measure } from './harness.ts';

const total = (of: Partial<Record<string, number>>) =>
  ABILITIES.reduce((sum, a) => sum + (of[a] ?? 0), 0);

test('the same measurement twice is the same number', () => {
  const once = measure({ build: 'melee', danger: 3, trials: 20 });
  const twice = measure({ build: 'melee', danger: 3, trials: 20 });
  assert.equal(once.rate, twice.rate);
  assert.equal(once.trials, 20, 'and it ran the fights it was asked for');
});

test('the matrix is four different bodies that cost the same', () => {
  const sheets = BUILDS.map((b) => buildSheet(b));
  const spreads = sheets.map((s) => finalAbilities(s));
  assert.equal(new Set(spreads.map((a) => JSON.stringify(a))).size, BUILDS.length, 'four different bodies');
  assert.equal(new Set(spreads.map(total)).size, 1, 'and none of them is simply richer');
});

test('the simulated player casts, which the old policy never did', () => {
  const cast = measure({ build: 'caster', danger: 3, trials: 20 }).actions;
  assert.ok(cast.some((a) => a.kind === 'skill'), 'a caster that only swings measures nothing about skills');
});

test('the chart reads vit, which a foe-statblock chart cannot', () => {
  const m = chart([{ name: 'hale', template: { vit: 2 } }, { name: 'frail', template: { vit: -2 } }]);
  assert.equal(m.length, 2);
  assert.equal(m[0][0], 0.5, 'nobody beats themselves');
  assert.ok(m[0][1] > 0.5, `the hale one should win more than half: ${m[0][1]}`);
});

test('the difficulty curve is where it was measured', () => {
  // The anchor for 3n: swapping statblock foes for characters must not move this.
  // Measured 2026-09-12 with these 40 seeds, not guessed. A band, so an
  // unrelated tweak does not fail it, and deterministic, so it never flakes.
  const baseline: Record<number, number> = { 1: 98, 2: 88, 3: 80, 4: 50 };
  for (const [danger, was] of Object.entries(baseline)) {
    const now = Math.round(measure({ build: 'melee', danger: Number(danger), trials: 40 }).rate * 100);
    assert.ok(Math.abs(now - was) <= 8, `danger ${danger}: ${now}% against a recorded ${was}%`);
  }
});
