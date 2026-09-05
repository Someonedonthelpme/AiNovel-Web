import { addItem, carriedWeight, emptyInventory, weightOf } from '../items/types.ts';
import type { Item } from '../items/types.ts';
import { startingInventory } from '../play/state.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  armourClassFor, defaultAbilities, derive, finalAbilities, HP_AT_FIRST, HP_PER_LEVEL, maxHpFor,
  pointBuyCost, POINT_BUY_BUDGET, proficiencyFor, toCombatant, validateAbilities, validateSheet, carryCapacityFor, overloadFor, speedFor, MIN_SPEED } from './sheet.ts';
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
  assert.ok(v.errors.some((e) => new RegExp(`budget is ${POINT_BUY_BUDGET}`).test(e)));
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

test('hit points come from VITALITY, not from a class die', () => {
  // The die is gone with the classes. VIT is the body; CON is the mind holding
  // on, and giving CON hit points too would restart the fight between them.
  const s = sheet({ level: 1, baseAbilities: abilitiesOf({ vit: 14 }), background: soldier });
  assert.equal(maxHpFor(s), HP_AT_FIRST + 2);
});

test('constitution buys no hit points at all', () => {
  const tough = sheet({ level: 1, baseAbilities: abilitiesOf({ vit: 10, con: 15 }), background: soldier });
  const frail = sheet({ level: 1, baseAbilities: abilitiesOf({ vit: 10, con: 8 }), background: soldier });
  assert.equal(maxHpFor(tough), maxHpFor(frail), 'CON moved the body, which is the job VIT was split off to do');
});

test('later levels add the fixed step plus vitality', () => {
  const s = sheet({ level: 3, baseAbilities: abilitiesOf({ vit: 14 }), background: soldier });
  assert.equal(maxHpFor(s), HP_AT_FIRST + 2 + 2 * (HP_PER_LEVEL + 2));
});

test('hit points never drop below 1 even with dire vitality', () => {
  const frail = background('frail', { grantsStats: {} });
  const s = sheet({ level: 1, baseAbilities: abilitiesOf({ vit: 8 }), background: frail });
  assert.ok(maxHpFor(s) >= 1);
});

test('armour class is ten plus AGILITY — evasion, not accuracy', () => {
  // DEX decides whether YOUR blow lands; AGI decides whether theirs does.
  // AC read DEX for a long time, which left AGI buying nothing but tick cost.
  const quick = armourClassFor(sheet({ baseAbilities: abilitiesOf({ agi: 18 }), background: background('b') }));
  const still = armourClassFor(sheet({ baseAbilities: abilitiesOf({ agi: 8 }), background: background('b') }));
  assert.ok(quick > still, 'agility is what keeps a blow off you');

  const steady = armourClassFor(sheet({ baseAbilities: abilitiesOf({ dex: 18 }), background: background('b') }));
  const clumsy = armourClassFor(sheet({ baseAbilities: abilitiesOf({ dex: 8 }), background: background('b') }));
  assert.equal(steady, clumsy, 'a steady hand does not make you hard to hit');
});

test('speed comes off agility rather than being a constant', () => {
  const quick = derive(sheet({ baseAbilities: abilitiesOf({ agi: 18 }), background: background('b') }));
  const slow = derive(sheet({ baseAbilities: abilitiesOf({ agi: 6 }), background: background('b') }));
  assert.ok(quick.speed > slow.speed, 'quick people cover more ground');
  assert.ok(slow.speed >= 3, 'and nobody is rooted to the spot');
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

/* -------------------------------------------------------------------------- */
/* Carrying — what STR has always claimed and never did                        */
/* -------------------------------------------------------------------------- */

const packed = (items: { item: Item; count: number }[]) =>
  items.reduce((inv, { item, count }) => addItem(inv, item, count), emptyInventory());

const brick = (id: string, weight: number): Item =>
  ({ id, name: id, description: '', kind: 'material', weight, stackable: true, value: 0 });

test('a stronger back carries more', () => {
  const strong = sheet({ baseAbilities: abilitiesOf({ str: 18 }), background: background('b') });
  const weak = sheet({ baseAbilities: abilitiesOf({ str: 8 }), background: background('b') });
  assert.ok(carryCapacityFor(strong) > carryCapacityFor(weak));
});

test('capacity comes off the score, not the modifier', () => {
  // Carrying is the one place a single point should help, rather than only
  // mattering every second one.
  const a = sheet({ baseAbilities: abilitiesOf({ str: 12 }), background: background('b') });
  const b = sheet({ baseAbilities: abilitiesOf({ str: 13 }), background: background('b') });
  assert.ok(carryCapacityFor(b) > carryCapacityFor(a));
});

test('an ordinary pack is nowhere near capacity', () => {
  // Encumbrance should bite when you hoard, not when you are equipped.
  const s = sheet({ background: background('b') });
  const pack = startingInventory(s);
  assert.ok(carriedWeight(pack) < carryCapacityFor(s, pack), 'setting out should not slow you down');
  assert.equal(overloadFor(s, pack), 0);
});

test('hauling more than you can costs movement', () => {
  const s = sheet({ background: background('b') });
  const hoard = packed([{ item: brick('slab', 40), count: 6 }]);
  assert.ok(overloadFor(s, hoard) > 0);
  assert.ok(speedFor(s, hoard) < speedFor(s, emptyInventory()));
});

test('overload can drag you below the ordinary floor, but never to a stop', () => {
  const s = sheet({ background: background('b') });
  const absurd = packed([{ item: brick('slab', 400), count: 9 }]);
  assert.ok(speedFor(s, absurd) < MIN_SPEED);
  assert.ok(speedFor(s, absurd) >= 1, 'you can still shuffle');
});

test('a weightless item is impossible — everything defaults by kind', () => {
  const anonymous: Item = { id: 'x', name: 'x', description: '', kind: 'equipment', stackable: false, value: 0 };
  assert.ok(weightOf(anonymous) > 0, 'nothing generated is accidentally weightless');
});
