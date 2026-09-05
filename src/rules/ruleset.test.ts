import test from 'node:test';
import assert from 'node:assert/strict';
import { HARSH, PLAIN, presetNamed, PRESETS, rulesOf, STANDARD, withOverrides } from './ruleset.ts';
import type { Ruleset } from './ruleset.ts';
import { applyDamage, damageReduction, soakOf } from '../combat/resolve.ts';
import { resistedRounds } from '../combat/conditions.ts';
import { actionTicks, castTicks, refillTicks } from '../combat/tempo.ts';
import { applyDrift } from '../character/drift.ts';
import { carryCapacityFor, overloadFor, speedFor } from '../session/sheet.ts';
import { dangerFor } from '../world/budget.ts';
import { abilities, combatant } from '../combat/fixtures.ts';
import { emptyPersona } from '../character/persona.ts';
import { defaultVoice, world } from '../world/fixtures.ts';
import { abilitiesOf, background, sheet } from '../session/fixtures.ts';
import { addItem, emptyInventory } from '../items/types.ts';
import type { Item } from '../items/types.ts';
import { takeRest } from '../play/rest.ts';
import { playState } from '../play/fixtures.ts';
import { resolveSkill } from '../skills/active.ts';
import type { ActiveSkill } from '../skills/active.ts';
import { priceOfUse } from '../skills/pools.ts';
import { referencePc } from '../combat/statblock.ts';

const tuned = (over: Parameters<typeof withOverrides>[1]): Ruleset => withOverrides(STANDARD, over);

const tough = () => combatant('t', { abilities: abilities({ vit: 18 }), hp: 40, maxHp: 40 });
const hauler = () => sheet({ baseAbilities: abilitiesOf({ str: 12, agi: 12 }), background: background('b') });
const slab = (weight: number): Item =>
  ({ id: 'slab', name: 'slab', description: '', kind: 'material', weight, stackable: true, value: 0 });
const packed = (weight: number, count: number) => addItem(emptyInventory(), slab(weight), count);

/* -------------------------------------------------------------------------- */
/* The refactor claim                                                          */
/* -------------------------------------------------------------------------- */

test('the default preset is exactly what the engine already did', () => {
  // Converting a constant into a lookup whose default is that same constant
  // must change nothing. If this drifts, the conversion was a redesign.
  assert.equal(STANDARD.body.carryBase, 20);
  assert.equal(STANDARD.body.baseSpeed, 6);
  assert.equal(STANDARD.combat.soakCeiling, 2);
  assert.equal(STANDARD.combat.turnLength, 6);
  assert.equal(STANDARD.persona.driftThreshold, 6);
  assert.equal(STANDARD.rest.longTurns, 8);
  assert.equal(dangerFor(9), 9, 'danger still equals the floor by default');
});

test('a world with no ruleset plays by STANDARD', () => {
  assert.deepEqual(rulesOf(world()), STANDARD);
  assert.deepEqual(rulesOf(null), STANDARD);
  assert.deepEqual(rulesOf(undefined), STANDARD);
});

test('a world carries its own rules', () => {
  assert.deepEqual(rulesOf({ ...world(), rules: HARSH }), HARSH);
});

/* -------------------------------------------------------------------------- */
/* EVERY RULE HAS A READER                                                     */
/* -------------------------------------------------------------------------- */

/*
 * The generalisation of the writer proof, pointed the other way. A config
 * field that changes nothing is the same bug as a stored field nothing writes:
 * it looks like a mechanic, survives review, and quietly does nothing.
 *
 * Each case moves ONE dial and asserts something observable moves with it.
 */

test('body.carryBase and carryPerStr reach carrying capacity', () => {
  const s = hauler();
  assert.ok(carryCapacityFor(s, undefined, tuned({ body: { carryBase: 40 } })) > carryCapacityFor(s));
  assert.ok(carryCapacityFor(s, undefined, tuned({ body: { carryPerStr: 5 } })) > carryCapacityFor(s));
});

test('body.overloadStep reaches how much a hoard costs', () => {
  const s = hauler();
  const hoard = packed(30, 8);
  assert.ok(overloadFor(s, hoard, tuned({ body: { overloadStep: 2 } })) > overloadFor(s, hoard));
});

test('body.baseSpeed and minSpeed reach movement', () => {
  const s = hauler();
  assert.ok(speedFor(s, undefined, tuned({ body: { baseSpeed: 10 } })) > speedFor(s));
  const slow = tuned({ body: { baseSpeed: 0, minSpeed: 5 } });
  assert.equal(speedFor(s, undefined, slow), 5, 'the floor is what holds it up');
});

test('combat.soakCeiling reaches what a body absorbs', () => {
  assert.equal(damageReduction(tough(), tuned({ combat: { soakCeiling: 0 } })), 0);
  assert.ok(damageReduction(tough(), tuned({ combat: { soakCeiling: 4 } })) > damageReduction(tough()));
});

test('combat.soakShare reaches how much of a blow can be soaked', () => {
  const generous = tuned({ combat: { soakShare: 1, soakCeiling: 4 } });
  assert.ok(soakOf(tough(), 6, generous) > soakOf(tough(), 6));
});

test('combat.minHit reaches what a landed blow costs at minimum', () => {
  // Soak is capped by the ability modifier as well as the ceiling, so a huge
  // ceiling does not make somebody invulnerable — it takes vit's worth and no
  // more. The floor binds when the blow is small enough to be nearly absorbed.
  const wall = tuned({ combat: { soakCeiling: 99, soakShare: 1, minHit: 5 } });
  assert.equal(applyDamage(tough(), 5, wall).hp, 35, 'five always lands');
  assert.equal(applyDamage(tough(), 5, tuned({ combat: { minHit: 1 } })).hp, 36);
});

test('combat.conditionFloor reaches how long something sticks', () => {
  const c = combatant('c', { abilities: abilities({ vit: 20 }) });
  assert.equal(resistedRounds(c, 'stunned', 2), 1);
  assert.equal(resistedRounds(c, 'stunned', 2, tuned({ combat: { conditionFloor: 3 } })), 3);
});

test('combat.turnLength and minActionTicks reach the action economy', () => {
  const c = combatant('c', { abilities: abilities({ agi: 10 }) });
  assert.ok(actionTicks(c, tuned({ combat: { turnLength: 12 } })) > actionTicks(c));
  assert.equal(actionTicks(c, tuned({ combat: { turnLength: 0, minActionTicks: 4 } })), 4);
  assert.ok(refillTicks(c, tuned({ combat: { turnLength: 12 } })).ticks > refillTicks(c).ticks);
  assert.ok(castTicks(c, 9, tuned({ combat: { minActionTicks: 9 } })) >= 9);
});

test('persona.driftThreshold and pressureDecay reach who somebody becomes', () => {
  const p = emptyPersona(defaultVoice());
  const eight = () => Array.from({ length: 8 }, () => ({ kind: 'address', tone: 'crude' } as const));

  const easy = eight().reduce((who, c) => applyDrift(who, [c], tuned({ persona: { driftThreshold: 2 } })).persona, p);
  const never = eight().reduce(
    (who, c) => applyDrift(who, [c], tuned({ persona: { driftThreshold: Number.POSITIVE_INFINITY } })).persona, p);

  assert.ok(easy.temperament.feeling < 0, 'a low threshold changes people fast');
  assert.equal(never.temperament.feeling, 0, 'an infinite one means nobody ever changes');
});

test('world.dangerBase and dangerPerFloor decouple difficulty from depth', () => {
  // `danger === floor` was hardcoded, so no quiet story band could exist deep
  // in a tower and no early gauntlet could be brutal.
  assert.equal(dangerFor(10, tuned({ world: { dangerPerFloor: 0 } })), 0, 'a flat tower');
  assert.equal(dangerFor(0, tuned({ world: { dangerBase: 5 } })), 5, 'dangerous from the door');
  assert.ok(dangerFor(10, tuned({ world: { dangerPerFloor: 2 } })) > dangerFor(10));
});

test('persona.pressureDecay reaches how fast a grudge fades', () => {
  // One slight, then a long quiet stretch. A fast decay forgets it; a zero
  // decay never does, so isolated moments would accumulate forever.
  const slighted = applyDrift(emptyPersona(defaultVoice()), [{ kind: 'address', tone: 'crude' }]).persona;
  const quiet = (rules: Ruleset) =>
    Array.from({ length: 4 }, () => ({ kind: 'travel', cost: 1 } as const))
      .reduce((who, c) => applyDrift(who, [c], rules).persona, slighted);

  assert.equal(quiet(tuned({ persona: { pressureDecay: 0 } })).pressure.feeling, slighted.pressure.feeling);
  assert.ok(Math.abs(quiet(tuned({ persona: { pressureDecay: 1 } })).pressure.feeling) <
    Math.abs(slighted.pressure.feeling));
});

test('persona.suitSwing reaches what a skill costs AND what it does', () => {
  /*
   * The signed budget, proved on both channels at once — which is the whole
   * point of it being one number. A bold character throwing a blow pays less
   * for it and lands more of it; at the identity value neither moves, and the
   * same code has run either way.
   */
  const blow: ActiveSkill = {
    id: 'sk', name: 'Blow', description: '', ability: 'str', range: 1,
    effects: [
      { role: 'purpose', sign: 'minus', channel: 'hp', who: 'foe', shape: { kind: 'single' },
        duration: { kind: 'instant' }, formula: { flat: 10 } },
      { role: 'cost', sign: 'minus', channel: 'stamina', who: 'own', shape: { kind: 'self' },
        duration: { kind: 'instant' }, formula: { flat: 8 } },
    ],
  };
  const bold = { temperament: { intuition: 0, feeling: 0, nerve: 10, discipline: 0 } };
  const timid = { temperament: { intuition: 0, feeling: 0, nerve: -10, discipline: 0 } };

  const off = tuned({ persona: { suitSwing: 0 } });
  assert.equal(priceOfUse(blow, bold, off).cost, priceOfUse(blow, timid, off).cost,
    'at the identity value, who you are presses on nothing');

  const on = tuned({ persona: { suitSwing: 0.25 } });
  assert.ok(priceOfUse(blow, bold, on).cost < priceOfUse(blow, timid, on).cost,
    'what suits you should come cheaper');

  const target = { ...referencePc(3), id: 'foe1', name: 'wolf', side: 'foe' as const, hp: 40, maxHp: 40 };
  const me = { ...referencePc(3), id: 'pc', name: 'me' };
  const hitBy = (who: typeof bold, rules: Ruleset) =>
    resolveSkill(blow, me, [target], who, rules).affected[0].hp;

  assert.equal(hitBy(bold, off), hitBy(timid, off), 'and lands the same');
  assert.ok(hitBy(bold, on) < hitBy(timid, on), 'what suits you should land harder');
});

test('rest.shortTurns and longTurns reach what resting costs you', () => {
  // Read from the WORLD rather than passed in — `takeRest` already holds the
  // state, so this is real wiring rather than another optional parameter.
  const base = playState();
  const inTown = { ...base, pc: { ...base.pc, hp: 1 } };
  const slow = {
    ...inTown,
    world: { ...inTown.world, rules: tuned({ rest: { shortTurns: 5, longTurns: 20 } }) },
  };

  assert.ok(takeRest(slow, 'short').turnsSpent > takeRest(inTown, 'short').turnsSpent);
  assert.ok(takeRest(slow, 'long').turnsSpent > takeRest(inTown, 'long').turnsSpent);
});

/**
 * The list above, written down — so that ADDING a dial without proving it has
 * a reader fails here rather than shipping quietly.
 *
 * Behaviour coverage cannot be introspected, so this is the same device
 * `WRITTEN_COUNTERS` uses: name what has been proved, and assert the claim
 * still covers the thing it is about.
 */
const PROVEN = [
  'body.carryBase', 'body.carryPerStr', 'body.overloadStep', 'body.baseSpeed', 'body.minSpeed',
  'combat.soakCeiling', 'combat.soakShare', 'combat.minHit', 'combat.conditionFloor',
  'combat.turnLength', 'combat.minActionTicks',
  'persona.driftThreshold', 'persona.pressureDecay', 'persona.suitSwing',
  'rest.shortTurns', 'rest.longTurns',
  'world.dangerBase', 'world.dangerPerFloor',
];

test('EVERY dial in the ruleset has a proven reader', () => {
  const actual = (Object.keys(STANDARD) as (keyof Ruleset)[])
    .flatMap((group) => Object.keys(STANDARD[group]).map((field) => `${group}.${field}`));

  assert.deepEqual(
    actual.sort(), [...PROVEN].sort(),
    'a rule that changes nothing is the same bug as a field nothing writes — prove it, then list it here',
  );
});

/* -------------------------------------------------------------------------- */
/* Presets                                                                     */
/* -------------------------------------------------------------------------- */

test('PLAIN is the identity end: the same code, with nothing pressing on it', () => {
  // The claim the whole design rests on — "simple" is not an absence of rules,
  // it is the deep path with its dials neutral.
  assert.equal(damageReduction(tough(), PLAIN), 0, 'nobody soaks');
  assert.equal(overloadFor(hauler(), packed(30, 8), PLAIN), 0, 'nothing is heavy');
  assert.equal(dangerFor(20, PLAIN), 0, 'every floor is the first');

  const p = emptyPersona(defaultVoice());
  const after = Array.from({ length: 20 }, () => ({ kind: 'address', tone: 'crude' } as const))
    .reduce((who, c) => applyDrift(who, [c], PLAIN).persona, p);
  assert.deepEqual(after.temperament, p.temperament, 'nobody changes');
});

test('HARSH presses harder than STANDARD in every direction it names', () => {
  assert.ok(carryCapacityFor(hauler(), undefined, HARSH) < carryCapacityFor(hauler()));
  assert.ok(damageReduction(tough(), HARSH) < damageReduction(tough()));
  assert.ok(dangerFor(10, HARSH) > dangerFor(10));
  assert.ok(HARSH.persona.driftThreshold < STANDARD.persona.driftThreshold);
});

test('a preset can be overridden one field at a time', () => {
  // A preset says what a world IS in a word; an override is for the person who
  // wants exactly one thing different.
  const brutalFood = withOverrides(STANDARD, { body: { overloadStep: 1 } });
  assert.equal(brutalFood.body.overloadStep, 1);
  assert.equal(brutalFood.body.carryBase, STANDARD.body.carryBase, 'and nothing else moved');
  assert.equal(brutalFood.combat.soakCeiling, STANDARD.combat.soakCeiling);
});

test('overriding never mutates the preset it came from', () => {
  withOverrides(STANDARD, { combat: { soakCeiling: 99 } });
  assert.equal(STANDARD.combat.soakCeiling, 2);
});

test('an unknown preset name falls back rather than throwing', () => {
  assert.deepEqual(presetNamed('no_such_world'), STANDARD);
  assert.deepEqual(presetNamed('harsh'), HARSH);
});

test('every preset carries every group, so none can be half-defined', () => {
  for (const [name, rules] of Object.entries(PRESETS)) {
    for (const group of Object.keys(STANDARD) as (keyof Ruleset)[]) {
      assert.ok(rules[group], `${name} is missing ${group}`);
      assert.deepEqual(
        Object.keys(rules[group]).sort(), Object.keys(STANDARD[group]).sort(),
        `${name}.${group} does not have the same dials as standard`,
      );
    }
  }
});
