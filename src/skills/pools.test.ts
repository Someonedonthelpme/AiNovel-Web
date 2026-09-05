import test from 'node:test';
import assert from 'node:assert/strict';
import { ABILITIES } from '../combat/types.ts';
import { combatant, abilities } from '../combat/fixtures.ts';
import { canAfford, MAX_COST, MIN_COST, poolFor, priceOfUse, spend } from './pools.ts';
import { flat, instant, self, single } from './effect.ts';
import type { Effect } from './effect.ts';
import type { ActiveSkill } from './active.ts';
import { STAT_GRAMMAR } from './statgrammar.ts';
import { composeSkill, priceOf } from './compose.ts';
import { isCombatUsable } from './active.ts';
import { budgetForFloor } from './book.ts';
import { mulberry32 } from '../engine/roll.ts';
import { actionTicks, castTicks, MIN_ACTION_TICKS, refillTicks, TURN_LENGTH } from '../combat/tempo.ts';
import { maxManaFor, maxStaminaFor } from '../session/sheet.ts';
import { sheet } from '../session/fixtures.ts';

const hurt = (amount: number, shape: Effect['shape'] = single): Effect =>
  ({ role: 'purpose', sign: 'minus', channel: 'hp', who: 'foe', shape, duration: instant, formula: flat(amount) });

/** The declared cost. Its CHANNEL is what decides the pool, not the stat. */
const pay = (channel: 'stamina' | 'mana', amount: number): Effect =>
  ({ role: 'cost', sign: 'minus', channel, who: 'own', shape: self, duration: instant, formula: flat(amount) });

const skill = (over: Partial<ActiveSkill> = {}): ActiveSkill => ({
  id: 'x', name: 'X', description: '', ability: 'str',
  effects: [hurt(8), pay('stamina', 4)], range: 1, ...over,
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
  const thrown = skill({ ability: 'str', effects: [hurt(8), pay('stamina', 4)] });
  const worked = skill({ ability: 'int', effects: [hurt(8), pay('mana', 4)] });

  assert.equal(priceOfUse(thrown).pool, 'stamina');
  assert.equal(priceOfUse(worked).pool, 'mana');
  assert.equal(priceOfUse(thrown).cost, priceOfUse(worked).cost, 'the same payload should cost the same');
  assert.equal(poolFor('str'), 'stamina');
  assert.equal(poolFor('int'), 'mana', 'and the composer picks the channel from the stat');
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
          id: 's', name: '', description: '', ability: stat,
          grammar: STAT_GRAMMAR[stat], budget: budgetForFloor(floor),
        });
        const { cost } = priceOfUse(composed);
        // A standing bonus is never thrown, so it is the one thing that is free.
        if (!isCombatUsable(composed)) {
          assert.equal(cost, 0, `${stat} floor ${floor} charged for something it never spends a turn on`);
          continue;
        }
        assert.ok(cost >= MIN_COST && cost <= MAX_COST, `${stat} floor ${floor} costs ${cost}`);
      }
    }
  }
});

test('a standing bonus is never paid for out of a pool', () => {
  // `edge` is always on and never thrown. Charging for it would mean charging
  // every round, for ever.
  const passive = skill({ effects: [{
    role: 'purpose', sign: 'plus', channel: 'stat', stat: 'str', who: 'own', shape: self,
    duration: { kind: 'sustained' }, formula: flat(2),
  }] });
  assert.equal(priceOfUse(passive).cost, 0);
  assert.equal(canAfford({ ...combatant('a'), stamina: 0, mana: 0 }, passive), true);
});

test('a bigger effect is composed with a bigger cost', () => {
  // The cost is DECLARED now rather than inferred, so the property to prove
  // moved: the composer must still price a heavier thing higher.
  const priced = (purpose: Effect) => priceOf([purpose]);
  assert.ok(priced(hurt(14)) > priced(hurt(4)), 'a heavier blow should take more out of you');
  assert.ok(
    priced(hurt(8, { kind: 'burst', radius: 3 })) > priced(hurt(8)),
    'catching a room should cost more than catching one of them',
  );
});

test('a cost can be something other than a pool, and then nothing is spent from one', () => {
  // Blood magic is not a special case: it is a cost whose channel is hp.
  const blood = skill({ effects: [hurt(12), { ...pay('stamina', 4), channel: 'hp' }] });
  assert.equal(priceOfUse(blood).cost, 0, 'no pool is charged');
  assert.equal(canAfford({ ...combatant('a'), stamina: 0, mana: 0 }, blood), true);
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
  assert.equal(spend(spent, skill({ effects: [hurt(20), pay('stamina', 9)] })).stamina, 0);
});

test('you cannot afford what you cannot pay for', () => {
  const broke = { ...combatant('a'), stamina: 0, mana: 20 };
  assert.equal(canAfford(broke, skill()), false);
  assert.equal(canAfford(broke, skill({ effects: [hurt(8), pay('mana', 4)] })), true, 'the mind is still full');
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
