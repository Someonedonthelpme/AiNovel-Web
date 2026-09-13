import test from 'node:test';
import assert from 'node:assert/strict';
import { ABILITIES } from '../combat/types.ts';
import { finalAbilities, maxHpFor } from '../session/sheet.ts';
import { BUILDS, buildSheet, chart, measure, onFloor } from './harness.ts';
import { leavesOf, speciesFor } from '../character/species.ts';
import { planFor } from '../character/bodyplan.ts';
import { initialPlayState } from './state.ts';
import { sheet } from '../session/fixtures.ts';
import { world as worldFixture } from '../world/fixtures.ts';
import { emptyInventory, equippedAttack } from '../items/types.ts';
import { beginEncounter } from './combat.ts';

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

/*
 * RESPECIFIED 2026-09-13, anchor plus delta (DESIGN 6b, the 2026-09-13 block).
 *
 * Was: "swapping statblocks for characters did not move the curve", asserting the
 * two curves EQUAL. Stage 3n's whole risk: built from the sheet alone a danger-1
 * fight fell from 95% to 53%, so `scaleFoe` decided what it is like to fight and
 * the character only who it is. Equality held for a reason nobody meant — a
 * character foe's kind template never reached the fight at all, which was the
 * regression. The kind is now a delta on the anchor, as it always was for a
 * statblock foe, so the curves agree within a BAND rather than exactly.
 *
 * Measured with paired seeds: −4.5 to +4.3 points at 400 trials, and +1/−4/+2
 * at the 100 used here. Seven leaves margin and still catches a real shift. That
 * the delta reaches the fight at all is pinned separately, in combat.test.ts, so
 * this band cannot pass because the template has quietly gone missing again.
 */
test('swapping statblocks for characters moves the curve by no more than a kind', () => {
  const kinds = speciesFor(11);
  for (const danger of [1, 2, 4]) {
    const plain = measure({ build: 'melee', danger, trials: 100 }).rate * 100;
    const people = measure({ build: 'melee', danger, trials: 100, kinds }).rate * 100;
    assert.ok(
      Math.abs(people - plain) <= 7,
      `danger ${danger}: ${plain}% against statblocks, ${people}% against characters`,
    );
  }
});

/*
 * Found 2026-09-13: `onFloor` copied the fixture's `pc`, which carries 11 hit
 * points, and `playerCombatant` fights with the lesser of that and the sheet's
 * maximum. So `measure({ level: 11 })` ran a 92-hp body on 11, every table taken
 * at `expectedPcLevel` measured a climber far weaker than its level, and even the
 * level-one tank fought on 11 of its 13.
 */
test('a measured climber fights with its own hit points, not the fixture\'s', () => {
  const sheetOf = buildSheet('melee', 11);
  // Opened exactly the way `measure` opens every fight it counts.
  const pc = beginEncounter(onFloor(10, 0, sheetOf, emptyInventory())).combat!.combatants['pc'];
  assert.equal(pc.hp, maxHpFor(sheetOf, emptyInventory()), `a level-11 climber fights with ${pc.hp}`);
  assert.equal(pc.hp, pc.maxHp, 'and starts the fight whole');
});
