import test from 'node:test';
import assert from 'node:assert/strict';
import { ABILITIES } from '../combat/types.ts';
import { combatant, abilities } from '../combat/fixtures.ts';
import { canAfford, costOf, MAX_COST, MIN_COST, poolFor, priceOfUse, spend } from './pools.ts';
import type { ActiveSkill } from './active.ts';
import { STAT_GRAMMAR } from './statgrammar.ts';
import { composeSkill } from './compose.ts';
import { budgetForFloor } from './book.ts';
import { mulberry32 } from '../engine/roll.ts';
import { actionTicks, castTicks, MIN_ACTION_TICKS, refillTicks, TURN_LENGTH } from '../combat/tempo.ts';
import { maxManaFor, maxStaminaFor } from '../session/sheet.ts';
import { sheet } from '../session/fixtures.ts';

const skill = (over: Partial<ActiveSkill> = {}): ActiveSkill => ({
  id: 'x', name: 'X', description: '', kind: 'combat', ability: 'str',
  effect: { kind: 'strike', damage: 8 }, range: 1, usesPerRest: 0, ...over,
});

/* -------------------------------------------------------------------------- */
/* Which pool, and why it follows the stat                                     */
/* -------------------------------------------------------------------------- */

test('the pool follows the stat, not the payload', () => {
  /*
   * The one rule, and what makes the physical and mental halves of the stat
   * sheet structural rather than thematic. The SAME payload paid for out of
   * different reserves is the stat-grammar argument showing up in the economy.
   */
  const thrown = skill({ ability: 'str', effect: { kind: 'strike', damage: 8 } });
  const worked = skill({ ability: 'int', effect: { kind: 'strike', damage: 8 } });

  assert.equal(priceOfUse(thrown).pool, 'stamina');
  assert.equal(priceOfUse(worked).pool, 'mana');
  assert.equal(priceOfUse(thrown).cost, priceOfUse(worked).cost, 'the same payload should cost the same');
});

test('every stat draws on exactly one pool', () => {
  // A stat with no pool could never pay for anything; one with both would make
  // the split meaningless.
  for (const stat of ABILITIES) {
    assert.ok(['stamina', 'mana'].includes(poolFor(stat)), `${stat} draws on nothing`);
  }
});

test('both pools are actually used', () => {
  // A split where every stat landed on one side would be a rename, not a split.
  const pools = new Set(ABILITIES.map(poolFor));
  assert.equal(pools.size, 2, 'one of the pools is never drawn on');
});

/* -------------------------------------------------------------------------- */
/* What things cost                                                            */
/* -------------------------------------------------------------------------- */

test('nothing is free and nothing is unusable', () => {
  /*
   * The floor stops a skill being spammable; the ceiling stops a deep skill
   * being undrawable at the level it is found — which was the real risk of
   * pricing straight off the composer's budget.
   */
  for (const stat of ABILITIES) {
    for (const floor of [1, 5, 12, 20]) {
      for (const seed of [1, 7, 42, 2024]) {
        const composed = composeSkill(mulberry32(seed), {
          id: 's', name: '', description: '', kind: 'combat', ability: stat,
          grammar: STAT_GRAMMAR[stat], budget: budgetForFloor(floor),
        });
        const cost = costOf(composed.effect);
        assert.ok(cost >= MIN_COST && cost <= MAX_COST, `${stat} floor ${floor} costs ${cost}`);
      }
    }
  }
});

test('a standing bonus is never paid for out of a pool', () => {
  // `edge` is always on and never thrown. Charging for it would mean charging
  // every round, for ever.
  const passive = skill({ effect: { kind: 'edge', ability: 'str', bonus: 2 } });
  assert.equal(priceOfUse(passive).cost, 0);
  assert.equal(canAfford({ ...combatant('a'), stamina: 0, mana: 0 }, passive), true);
});

test('a bigger effect costs more', () => {
  assert.ok(
    costOf({ kind: 'strike', damage: 14 }) > costOf({ kind: 'strike', damage: 4 }),
    'a heavier blow should take more out of you',
  );
  assert.ok(
    costOf({ kind: 'burst', damage: 8, radius: 3 }) > costOf({ kind: 'strike', damage: 8 }),
    'catching a room should cost more than catching one of them',
  );
});

/* -------------------------------------------------------------------------- */
/* Spending                                                                    */
/* -------------------------------------------------------------------------- */

test('spending takes from the right pool and leaves the other alone', () => {
  const who = { ...combatant('a'), stamina: 20, maxStamina: 20, mana: 20, maxMana: 20 };
  const thrown = skill({ ability: 'str' });

  const after = spend(who, thrown);
  assert.equal(after.stamina, 20 - priceOfUse(thrown).cost);
  assert.equal(after.mana, 20, 'a physical skill should not have touched the mind');
});

test('a pool never goes below nothing', () => {
  const spent = { ...combatant('a'), stamina: 1, mana: 1 };
  assert.equal(spend(spent, skill({ effect: { kind: 'strike', damage: 20 } })).stamina, 0);
});

test('you cannot afford what you cannot pay for', () => {
  const broke = { ...combatant('a'), stamina: 0, mana: 20 };
  assert.equal(canAfford(broke, skill({ ability: 'str' })), false);
  assert.equal(canAfford(broke, skill({ ability: 'int' })), true, 'the mind is still full');
});

/* -------------------------------------------------------------------------- */
/* Where the ceilings come from                                                */
/* -------------------------------------------------------------------------- */

test('the body sets stamina and the mind sets mana', () => {
  /*
   * The whole reason pools beat per-skill uses: the SPREAD decides how long
   * you can keep going. Under uses, a deep book handed the same four to an
   * INT-8 reader as to an INT-18 one.
   */
  const strong = sheet({ baseAbilities: { ...abilities(), vit: 15, con: 8 } });
  const focused = sheet({ baseAbilities: { ...abilities(), vit: 8, con: 15 } });

  assert.ok(maxStaminaFor(strong) > maxStaminaFor(focused), 'VIT should buy stamina');
  assert.ok(maxManaFor(focused) > maxManaFor(strong), 'CON should buy mana');
});

test('fatigue and stress dock the ceilings, which is the mental track finally biting', () => {
  /*
   * `sheet.mental` existed all along and gated nothing: drift wrote it, rest
   * eased it, the model read it aloud, and no rule anywhere consulted it.
   * Climbing hard without resting now lowers what you can hold before it
   * lowers anything else.
   */
  const fresh = sheet({ baseAbilities: { ...abilities(), vit: 14, con: 14 } });
  const worn = sheet({
    baseAbilities: { ...abilities(), vit: 14, con: 14 },
    needs: { rest: 2, food: 10, safety: 2, company: 10, purpose: 10 },
  });

  assert.ok(maxStaminaFor(worn) < maxStaminaFor(fresh), 'stress should cost stamina');
  assert.ok(maxManaFor(worn) < maxManaFor(fresh), 'fatigue should cost mana');
});

test('a ceiling never falls below one, however worn out', () => {
  // A pool of zero would leave a character unable to act at all, which is a
  // dead end rather than a hard time.
  const wrecked = sheet({
    baseAbilities: { ...abilities(), vit: 8, con: 8 },
    needs: { rest: 0, food: 10, safety: 0, company: 10, purpose: 10 },
  });
  assert.ok(maxStaminaFor(wrecked) >= 1);
  assert.ok(maxManaFor(wrecked) >= 1);
});

/* -------------------------------------------------------------------------- */
/* Tempo: what bringing a skill off takes out of the round                     */
/* -------------------------------------------------------------------------- */

test('dexterity shortens a cast, which is what that stat was missing', () => {
  /*
   * "Reduces magic casting time" only means something once a cast HAS a
   * length. Read as ticks rather than seconds, it finally lands in an engine
   * where a turn is a turn — and it is DEX's third distinct job, alongside
   * hitting and keeping damage consistent.
   */
  const steady = { ...combatant('a'), abilities: abilities({ dex: 10 }) };
  const deft = { ...combatant('a'), abilities: abilities({ dex: 18 }) };

  assert.ok(castTicks(deft, 8) < castTicks(steady, 8), 'a deft caster should be quicker');
  assert.ok(castTicks(deft, 8) >= MIN_ACTION_TICKS, 'but nothing is ever instant');
});

test('agility shortens a swing, so a quick fighter acts more often', () => {
  const slow = { ...combatant('a'), abilities: abilities({ agi: 8 }) };
  const quick = { ...combatant('a'), abilities: abilities({ agi: 18 }) };

  assert.ok(actionTicks(quick) < actionTicks(slow));
  assert.equal(actionTicks({ ...combatant('a'), abilities: abilities({ agi: 10 }) }), TURN_LENGTH,
    'an average combatant spends a whole round on one action, which is the old baseline');
});

test('a round refills the budget and pays back an overrun', () => {
  const overran = { ...combatant('a'), ticks: -3 };
  assert.equal(refillTicks(overran).ticks, TURN_LENGTH - 3, 'the overrun should come out of the next round');
});

test('nobody banks more than one spare round', () => {
  // Otherwise a patient combatant opens a fight with four swings.
  const hoarding = { ...combatant('a'), ticks: TURN_LENGTH * 5 };
  assert.equal(refillTicks(hoarding).ticks, TURN_LENGTH * 2);
});
