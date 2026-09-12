import test from 'node:test';
import assert from 'node:assert/strict';
import { ABILITIES } from '../combat/types.ts';
import { finalAbilities } from '../session/sheet.ts';
import { BUILDS, buildSheet, chart, measure } from './harness.ts';
import { leavesOf, speciesFor } from '../character/species.ts';
import { planFor } from '../character/bodyplan.ts';
import { initialPlayState } from './state.ts';
import { sheet } from '../session/fixtures.ts';
import { world as worldFixture } from '../world/fixtures.ts';
import { equippedAttack } from '../items/types.ts';

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
  /*
   * Measured with these 40 seeds, not guessed. A band, so an unrelated tweak does
   * not fail it, and deterministic, so it never flakes.
   *
   * RE-ANCHORED at 3e: a world with no species list now gives its foes an EMPTY
   * body, where `readSpecies` used to invent folk's template for them. The curve
   * moved because the foes did (d2 88→93, d3 80→88, d4 50→40), not because
   * anything regressed.
   */
  const baseline: Record<number, number> = { 1: 98, 2: 93, 3: 88, 4: 40 };
  for (const [danger, was] of Object.entries(baseline)) {
    const now = Math.round(measure({ build: 'melee', danger: Number(danger), trials: 40 }).rate * 100);
    assert.ok(Math.abs(now - was) <= 8, `danger ${danger}: ${now}% against a recorded ${was}%`);
  }
});

test('a climber with no hands does not set out wielding a sword', () => {
  // The other half of the body-plan reader: creation equips too, and a body plan
  // nothing checked here would be honoured everywhere except where it shows.
  const kinds = speciesFor(11);
  const beastly = leavesOf(kinds).find((k) => planFor(11, kinds, k.id) === 'beastly')!;
  const world = { ...worldFixture({ seed: 11 }), species: kinds };

  const asBeast = initialPlayState(world, { ...sheet(), species: beastly.id });
  const asPerson = initialPlayState(world, sheet());

  assert.equal(equippedAttack(asBeast.pc.inventory), null, 'nothing is in a paw');
  assert.ok(equippedAttack(asPerson.pc.inventory), 'and a person sets out armed');
});

test('swapping statblocks for characters did not move the curve', () => {
  // Stage 3n's whole risk. Built from the sheet alone, a foe's damage, AC and
  // abilities came from its trade and gear, and a danger-1 fight fell from 95% to
  // 53%; anchoring hit points alone left it at 75%. `scaleFoe` decides what it is
  // like to FIGHT and the character decides who it is, so these must be equal.
  const kinds = speciesFor(11);
  for (const danger of [1, 2, 4]) {
    const plain = measure({ build: 'melee', danger, trials: 40 });
    const people = measure({ build: 'melee', danger, trials: 40, kinds });
    assert.equal(
      Math.round(plain.rate * 100),
      Math.round(people.rate * 100),
      `danger ${danger}: ${Math.round(plain.rate * 100)}% against statblocks, ${Math.round(people.rate * 100)}% against characters`,
    );
  }
});
