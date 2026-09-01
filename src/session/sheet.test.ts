import test from 'node:test';
import assert from 'node:assert/strict';
import {
  armourClassFor, defaultAbilities, derive, finalAbilities, maxHpFor,
  pointBuyCost, POINT_BUY_BUDGET, proficiencyFor, toCombatant, validateAbilities, validateSheet,
} from './sheet.ts';
import { abilitiesOf, background, scholar, sheet, soldier, thaiSheet } from './fixtures.ts';

test('point buy costs follow the standard curve, with 14 and 15 costing extra', () => {
  assert.equal(pointBuyCost(8), 0);
  assert.equal(pointBuyCost(13), 5);
  assert.equal(pointBuyCost(14), 7, '14 costs two, not one');
  assert.equal(pointBuyCost(15), 9);
  assert.equal(pointBuyCost(16), null, 'above the buyable range');
  assert.equal(pointBuyCost(7), null, 'below it');
});

test('the default array spends exactly the budget', () => {
  const v = validateAbilities(defaultAbilities());
  assert.equal(v.ok, true, v.errors.join('; '));
  assert.equal(v.spent, POINT_BUY_BUDGET);
});

test('overspending the budget is rejected', () => {
  const v = validateAbilities(abilitiesOf({ str: 15, dex: 15, con: 15 }));
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /budget is 27/.test(e)));
});

test('scores outside the buyable range are rejected by name', () => {
  const v = validateAbilities(abilitiesOf({ str: 18 }));
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.startsWith('str is 18')));
});

test('fractional scores are rejected rather than silently floored', () => {
  const v = validateAbilities(abilitiesOf({ dex: 12.5 }));
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /whole number/.test(e)));
});

test('the background adds to the base scores', () => {
  const s = sheet({ baseAbilities: abilitiesOf({ str: 13, con: 13 }), background: soldier });
  const final = finalAbilities(s);
  assert.equal(final.str, 14, '13 base +1 from soldier');
  assert.equal(final.con, 14);
  assert.equal(final.cha, s.baseAbilities.cha, 'untouched abilities are unchanged');
});

test('backgrounds grant their own distinct skill sets', () => {
  const soldierSkills = soldier.grantsSkills.map((s) => s.id).sort();
  const scholarSkills = scholar.grantsSkills.map((s) => s.id).sort();
  assert.notDeepEqual(soldierSkills, scholarSkills);
  assert.equal(soldierSkills.some((id) => scholarSkills.includes(id)), false, 'no shared pool');
});

test('hit points are the full die plus constitution at first level', () => {
  const s = sheet({ hitDie: 10, level: 1, baseAbilities: abilitiesOf({ con: 13 }), background: soldier });
  // con 13 + 1 from soldier = 14, modifier +2
  assert.equal(maxHpFor(s), 12);
});

test('later levels add the fixed average plus constitution', () => {
  const s = sheet({ hitDie: 10, level: 3, baseAbilities: abilitiesOf({ con: 13 }), background: soldier });
  // 12 at level 1, then two levels of (6 + 2)
  assert.equal(maxHpFor(s), 28);
});

test('hit points never drop below 1 even with dire constitution', () => {
  const frail = background('frail', { grantsStats: {} });
  const s = sheet({ hitDie: 6, level: 1, baseAbilities: abilitiesOf({ con: 8 }), background: frail });
  assert.ok(maxHpFor(s) >= 1);
});

test('armour class is ten plus dexterity', () => {
  assert.equal(armourClassFor(sheet({ baseAbilities: abilitiesOf({ dex: 14 }), background: background('b') })), 12);
});

test('proficiency steps up every four levels', () => {
  assert.equal(proficiencyFor(1), 2);
  assert.equal(proficiencyFor(4), 2);
  assert.equal(proficiencyFor(5), 3);
  assert.equal(proficiencyFor(9), 4);
});

test('the sheet becomes a combatant whose numbers match exactly', () => {
  const s = sheet({ name: 'Anan', background: soldier });
  const d = derive(s);
  const c = toCombatant(s);

  assert.equal(c.name, 'Anan');
  assert.equal(c.side, 'party');
  assert.equal(c.hp, d.maxHp, 'starts at full health');
  assert.equal(c.maxHp, d.maxHp);
  assert.equal(c.ac, d.ac);
  assert.equal(c.proficiency, d.proficiency);
  assert.deepEqual(c.abilities, d.abilities, 'the two systems cannot disagree about the numbers');
  assert.equal(c.dead, false);
  assert.equal(c.dying, false);
});

test('a combatant derived from a sheet carries the background attacks', () => {
  const c = toCombatant(sheet({ background: soldier }));
  assert.ok(c.attacks.length > 0);
  assert.equal(c.attacks[0].id, 'sword');
});

test('a valid sheet passes', () => {
  const v = validateSheet(sheet({ background: soldier }));
  assert.equal(v.ok, true, v.errors.join('; '));
});

test('a nameless character is rejected', () => {
  assert.equal(validateSheet(sheet({ name: '   ' })).ok, false);
});

test('an implausible hit die is rejected', () => {
  assert.ok(validateSheet(sheet({ hitDie: 7 })).errors.some((e) => /hit die/.test(e)));
});

test('duplicate skill ids are rejected', () => {
  const b = background('b', { grantsSkills: [soldier.grantsSkills[0], soldier.grantsSkills[0]] });
  assert.ok(validateSheet(sheet({ background: b })).errors.some((e) => /duplicate skill/.test(e)));
});

test('a Thai character must have a self-pronoun, because register derives from it', () => {
  const missing = thaiSheet({ voice: { selfPronoun: '', underStress: '', addressBands: {}, particleBands: {}, tics: [] } });
  assert.equal(validateSheet(missing).ok, false);
  assert.ok(validateSheet(missing).errors.some((e) => /self-pronoun/.test(e)));
  assert.equal(validateSheet(thaiSheet()).ok, true);
});

test('a background with no skills or no attack warns rather than fails', () => {
  const empty = background('drifter', { grantsSkills: [], startingAttacks: [] });
  const v = validateSheet(sheet({ background: empty }));
  assert.equal(v.ok, true);
  assert.equal(v.warnings.length, 2);
});
