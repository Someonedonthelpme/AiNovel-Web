import test from 'node:test';
import assert from 'node:assert/strict';
import { amend, CONSTRAINTS, forbids, ruleClaim, HARSH, PLAIN, presetNamed, PRESETS, rulesOf, STANDARD, withOverrides } from './ruleset.ts';
import type { Binding, Ruleset } from './ruleset.ts';
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
import { addItem, conditionIn, emptyInventory, equip, equippedHoldings, putIn, unequip, wearEquipped } from '../items/types.ts';
import type { Item } from '../items/types.ts';
import { takeRest } from '../play/rest.ts';
import { playState } from '../play/fixtures.ts';
import { resolveSkill } from '../skills/active.ts';
import type { ActiveSkill } from '../skills/active.ts';
import { priceOfUse } from '../skills/pools.ts';
import { referencePc } from '../combat/statblock.ts';
import { refine, repair } from '../items/refine.ts';
import { instanceOf, PRISTINE } from '../items/instance.ts';
import { applyTurn } from '../play/delta.ts';
import { nudge } from '../social/edge.ts';
import type { Edges } from '../social/edge.ts';
import { spreadOf } from '../social/deed.ts';
import { carry, seed } from '../social/ambient.ts';
import { adopt, firsthand } from '../character/belief.ts';
import { FakeProvider } from '../llm/provider.ts';
import { runDirector } from '../llm/director.ts';

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

test('knowledge.spreadDepth reaches how far a deed actually gets', () => {
  /*
   * Degrees of separation, not a headcount. At the identity value a deed stops
   * with the people who saw it, which is a world where nothing gets around —
   * and it is the same walk either way, with the chain length set to nought.
   */
  const chain = ['a', 'b', 'c'].reduce(
    (edges, from, i, all) => (all[i + 1] ? nudge(edges, from, all[i + 1], 'familiarity', 1) : edges),
    {} as Edges,
  );
  const deed = { kind: 'insulted' as const, doer: 'x', victim: 'a', at: 'town' };

  const reach = (rules: Ruleset) => spreadOf(chain, deed, ['a'], rules.knowledge.spreadDepth).size;
  assert.equal(reach(tuned({ knowledge: { spreadDepth: 0 } })), 1, 'nothing leaves the room');
  assert.ok(reach(tuned({ knowledge: { spreadDepth: 2 } })) > 1);
});

test('knowledge.reputationWeight reaches what a place holds against you', () => {
  const base = playState();
  const record = {
    kind: 'turn' as const, input: 'มึงเอาอะไรวะ', mode: 'conversation' as const,
    classification: 'NEUTRAL' as const, addressed: 'smith', roll: null,
    delta: {}, rejected: [], prose: '',
  };
  const under = (rules: Ruleset) =>
    applyTurn({ ...base, world: { ...base.world, rules } }, record).state.world.reputation?.['floor-0'] ?? 0;

  assert.equal(under(tuned({ knowledge: { reputationWeight: 0 } })), 0, 'nobody keeps score');
  assert.ok(under(tuned({ knowledge: { reputationWeight: 2 } })) < under(tuned({ knowledge: { reputationWeight: 1 } })));
});

test('knowledge.ambientHops reaches how far news gets across the MAP', () => {
  // A different axis from `spreadDepth`: that one is degrees of acquaintance,
  // this one is streets. At the identity value nothing leaves the room.
  const places = [
    { id: 'square', connections: ['market'], people: ['a'] },
    { id: 'market', connections: ['square', 'gate'], people: ['b'] },
    { id: 'gate', connections: ['market'], people: ['c'] },
  ];
  const started = seed({}, 'square', firsthand({ kind: 'deed', who: 'x', what: 'insulted' }));
  const reachedIn = (rules: Ruleset) => Object.keys(carry(started, places, rules.knowledge.ambientHops)).sort();

  assert.deepEqual(reachedIn(tuned({ knowledge: { ambientHops: 0 } })), ['square'], 'nothing leaves');
  assert.deepEqual(reachedIn(tuned({ knowledge: { ambientHops: 1 } })), ['market', 'square']);
  assert.deepEqual(reachedIn(tuned({ knowledge: { ambientHops: 4 } })), ['gate', 'market', 'square']);
});

test('knowledge.ambientFade reaches how long talk stays worth repeating', () => {
  // Gossip is not memory. Zero is the identity value: a world that never
  // forgets, running the same code with nothing pressing on it.
  const places = [{ id: 'square', connections: [], people: ['a'] }];
  const air = seed({}, 'square', firsthand({ kind: 'deed', who: 'x', what: 'insulted' }));
  const after = (rules: Ruleset) =>
    carry(air, places, rules.knowledge.ambientHops, rules.knowledge.ambientFade)['square']?.[0].confidence ?? 0;

  assert.equal(after(tuned({ knowledge: { ambientFade: 0 } })), 1, 'nothing is ever forgotten');
  assert.ok(after(tuned({ knowledge: { ambientFade: 0.5 } })) < 1);
});

test('gear.wearPerFight reaches what a fight takes out of your kit', () => {
  // Zero is the identity value: gear never degrades and the same code runs
  // over it. A world with no smiths is a dial, not a missing system.
  const sword: Item = {
    id: 'w', name: 'sword', description: '', kind: 'equipment', slot: 'main',
    stackable: false, value: 1,
  };
  const kitted = equip(addItem(emptyInventory(), sword), 'w').inventory;
  const after = (rules: Ruleset) => conditionIn(wearEquipped(kitted, rules.gear.wearPerFight), 'w');

  assert.equal(after(tuned({ gear: { wearPerFight: 0 } })), 1, 'nothing ever wears out');
  assert.ok(after(tuned({ gear: { wearPerFight: 20 } })) < 1);
});

test('gear.slots reaches where a world lets you wear things', () => {
  /*
   * A fixed enum of three could not say that this world has no boots in it or
   * that that one lets you wear two rings. Unlike the numeric dials it is a
   * CONTENT choice rather than a difficulty one, so the presets share a set and
   * the point is that a world may declare its own.
   */
  const helm: Item = {
    id: 'h', name: 'a helm', description: '', kind: 'equipment', slot: 'head',
    stackable: false, value: 1,
  };
  const carrying = addItem(emptyInventory(), helm);

  const bare = tuned({ gear: { slots: [{ id: 'main', takes: 'main', name: 'in hand' }] } });
  assert.match(equip(carrying, 'h', bare).error ?? '', /nowhere on you/);
  assert.equal(equip(carrying, 'h', STANDARD).error, null, 'and a world with a head has helmets');
});

test('a second ring goes on the OTHER hand, without the code counting rings', () => {
  // Both ring slots simply `take` a ring; an item never says which hand.
  const ring: Item = {
    id: 'r', name: 'a ring', description: '', kind: 'equipment', slot: 'ring',
    stackable: false, value: 1,
  };
  const two = addItem(addItem(emptyInventory(), ring), ring);
  const worn = equip(equip(two, two.held[0].instance.id).inventory, two.held[1].instance.id).inventory;

  assert.equal(new Set(Object.values(worn.equipped)).size, 2, 'two rings, two hands');
});

test('a two-hander fills both hands, and taking either off puts it down', () => {
  const great: Item = {
    id: 'g', name: 'a greatspear', description: '', kind: 'equipment', slot: 'main',
    occupies: ['offhand'], stackable: false, value: 1,
  };
  const shield: Item = {
    id: 's', name: 'a shield', description: '', kind: 'equipment', slot: 'offhand',
    stackable: false, value: 1,
  };

  let inv = equip(addItem(addItem(emptyInventory(), great), shield), 'g').inventory;
  assert.equal(inv.equipped.main, inv.equipped.offhand, 'one object, both hands');
  assert.equal(equippedHoldings(inv).length, 1, 'and it is counted once, not twice');

  // Taking the off hand back puts the whole thing down, rather than leaving it
  // half-wielded.
  assert.equal(unequip(inv, 'offhand').equipped.main, undefined);

  // And raising a shield does the same.
  inv = equip(inv, 's').inventory;
  assert.equal(inv.equipped.main, undefined, 'you cannot hold a greatspear one-handed');
});

test('gear.rotateInBags reaches whether a long thing can be turned to fit', () => {
  /*
   * A rule rather than an assumption. With it off a pack is packed as things
   * come, and a spear does not go in a wide shallow bag however you hold it —
   * a different game, not a broken one.
   */
  const satchel: Item = {
    id: 'bag', name: 'a satchel', description: '', kind: 'equipment', slot: 'back',
    grid: 'xxxx/xx..', stackable: false, value: 1,
  };
  const pole: Item = {
    id: 'pole', name: 'a pole', description: '', kind: 'material',
    shape: 'x/x/x/x', stackable: false, value: 1,
  };
  const carrying = addItem(addItem(emptyInventory(), satchel), pole);
  const [bagId, poleId] = carrying.held.map((h) => h.instance.id);

  assert.equal(putIn(carrying, poleId, bagId, tuned({ gear: { rotateInBags: true } })).error, null);
  assert.match(
    putIn(carrying, poleId, bagId, tuned({ gear: { rotateInBags: false } })).error ?? '',
    /no room the shape of/,
  );
});

test('gear.maxRefine reaches how far a thing can be taken', () => {
  const axe = instanceOf('a', 'w');
  assert.equal(refine(axe, tuned({ gear: { maxRefine: 0 } }).gear).attempted, false, 'a world with no smiths');
  assert.equal(refine(axe, tuned({ gear: { maxRefine: 5 } }).gear).attempted, true);
});

test('refineRisk and refineLoss reach whether it can go wrong, and how badly', () => {
  /*
   * TWO NUMBERS RATHER THAN A MODE, so there is one code path and no switch on
   * a rule. Risk at nought never fails, which is Genshin; a loss of nought is a
   * stall; one level is the middle case; a loss past the ceiling destroys the
   * thing, which is what RO does.
   */
  const at4 = { ...instanceOf('a', 'w'), refine: 4 };
  const safe = tuned({ gear: { refineRisk: 0 } });
  assert.equal(refine(at4, safe.gear).item?.refine, 5, 'it never goes wrong');

  const risky = { ...STANDARD.gear, refineRisk: 1 };
  assert.equal(refine(at4, { ...risky, refineLoss: 0 }).item?.refine, 4, 'a stall keeps the level');
  assert.equal(refine(at4, { ...risky, refineLoss: 1 }).item?.refine, 3, 'and a slip loses one');
  assert.equal(refine(at4, { ...risky, refineLoss: 99 }).item, null, 'and past the ceiling it is gone');
});

test('gear.repairLoss reaches how much a mending gives back', () => {
  /*
   * Nought is a world where a smith can always make a thing as good as new —
   * the identity value, and the same code runs over it. Above nought, gear has
   * a lifespan and the blade you find on floor twelve eventually matters.
   */
  const battered = { ...instanceOf('a', 'w'), condition: 10, repairs: 3 };

  assert.equal(repair(battered, 0).item?.condition, PRISTINE, 'as good as new, for ever');
  assert.ok((repair(battered, 10).item?.condition ?? 0) < PRISTINE, 'and not, once mendings cost something');
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
  'gear.wearPerFight', 'gear.slots', 'gear.rotateInBags',
  'gear.maxRefine', 'gear.refineRisk', 'gear.refineLoss', 'gear.repairLoss',
  'knowledge.spreadDepth', 'knowledge.reputationWeight',
  'knowledge.ambientHops', 'knowledge.ambientFade',
  'rest.shortTurns', 'rest.longTurns',
  'world.dangerBase', 'world.dangerPerFloor', 'world.depthBelowGround',
];

/* -------------------------------------------------------------------------- */
/* LAWS                                                                        */
/* -------------------------------------------------------------------------- */

const underLaw = (binds: Binding) =>
  world({
    rules: {
      ...STANDARD,
      laws: [{ axis: 'movement' as const, constraint: 'descendBelowGround' as const, binds }],
    },
  });

test('a law binds the subjects it names, and the player is never special by default', () => {
  assert.ok(forbids(underLaw('all'), 'player', 'descendBelowGround'));
  assert.ok(forbids(underLaw('all'), 'resident', 'descendBelowGround'));

  // the case the hardcoded engine could never express: bound residents, free player
  assert.equal(forbids(underLaw('residents'), 'player', 'descendBelowGround'), null);
  assert.ok(forbids(underLaw('residents'), 'resident', 'descendBelowGround'));

  // and its mirror, which is the one that proves nothing assumes the player is exempt
  assert.ok(forbids(underLaw('player'), 'player', 'descendBelowGround'));
  assert.equal(forbids(underLaw('player'), 'resident', 'descendBelowGround'), null);
});

test('a Signet sets aside the law it exempts, and only that law', () => {
  // THE point of a Signet, per the design: an exemption, held by one person.
  // The subject carries what it is exempt from, because a law check that has to
  // look up the holder is a law check that will be called without one.
  const twoLaws = world({
    rules: {
      ...STANDARD,
      laws: [
        { axis: 'movement' as const, constraint: 'descendBelowGround' as const, binds: 'all' as const },
        { axis: 'movement' as const, constraint: 'crossFloors' as const, binds: 'all' as const },
      ],
    },
  });
  const holder = { kind: 'player' as const, exempt: ['descendBelowGround' as const] };

  assert.equal(forbids(twoLaws, holder, 'descendBelowGround'), null);
  assert.ok(forbids(twoLaws, holder, 'crossFloors'), 'one exemption is not a licence for everything');
  assert.ok(forbids(twoLaws, 'player', 'descendBelowGround'), 'and it exempts the holder alone');
});

test('a law can be amended, lifted and re-imposed, and the ruleset it came from is untouched', () => {
  // Step 6 asks for amendments as EVENTS. This is the pure half: what an
  // amendment does to a ruleset. Immutable, because the presets are shared
  // objects and a world editing one in place would retune every other run.
  const before = { ...STANDARD, laws: [...STANDARD.laws] };

  const sealed = amend(STANDARD, 'crossFloors', 'all');
  assert.ok(forbids({ rules: sealed }, 'player', 'crossFloors'), 'it now binds everyone');
  assert.equal(sealed.laws.filter((l) => l.constraint === 'crossFloors').length, 1, 'rebound, not duplicated');
  assert.equal(sealed.laws.find((l) => l.constraint === 'crossFloors')?.axis, 'movement', 'the axis comes with the constraint');

  const lifted = amend(sealed, 'crossFloors', null);
  assert.equal(forbids({ rules: lifted }, 'resident', 'crossFloors'), null, 'and a law can be struck out entirely');

  const imposed = amend(lifted, 'takeLoot', 'all');
  assert.equal(imposed.laws.find((l) => l.constraint === 'takeLoot')?.axis, 'economy');

  assert.deepEqual(STANDARD.laws, before.laws, 'the preset everyone shares is never edited in place');
});

test('the Director is told what the law forbids the people present', async () => {
  // The reader that makes a law more than a record. A rule the Director cannot
  // see is a rule it will happily narrate somebody breaking.
  const base = playState();
  const bound = {
    ...base,
    world: { ...base.world, rules: { ...STANDARD, laws: [
      { axis: 'movement' as const, constraint: 'crossFloors' as const, binds: 'residents' as const },
    ] } },
  };

  const p = new FakeProvider({ structured: [] });
  await runDirector(p, bound, 'look around', 'exploration', []).catch(() => {});
  assert.match(p.allSentText(), /cannot leave this floor/);
});

test('every law the player has worked out is described as ITSELF', async () => {
  // Two constraints were spelled out with a ternary — "the ground is the
  // bottom" or, for everything else, "residents cannot leave a floor". Adding
  // three more axes turned that fallback into a lie the Director would have
  // acted on: a player who has worked out that the tower keeps its loot would
  // have been reported as knowing something about stairs.
  const base = playState();
  const knowing = {
    ...base,
    sheet: { ...base.sheet, beliefs: adopt(base.sheet.beliefs ?? [], firsthand(ruleClaim('takeLoot'))) },
  };

  const p = new FakeProvider({ structured: [] });
  await runDirector(p, knowing, 'look around', 'exploration', []).catch(() => {});
  assert.match(p.allSentText(), /nothing here may be carried away/);
  assert.doesNotMatch(p.allSentText(), /residents cannot leave a floor/);
});

test('the Director is told the law and what the player has worked out, separately', async () => {
  // The law is what the Director ENFORCES; the belief is what the player may
  // act on. Collapsing the two is how a character knows a rule nobody told them.
  const base = playState();
  const knowing = {
    ...base,
    sheet: {
      ...base.sheet,
      beliefs: adopt(base.sheet.beliefs ?? [], firsthand(ruleClaim('descendBelowGround'))),
    },
  };

  const p = new FakeProvider({ structured: [] });
  await runDirector(p, knowing, 'look around', 'exploration', []).catch(() => {});

  const sent = p.allSentText();
  assert.match(sent, /The law \(you enforce this\)/);
  assert.match(sent, /worked out/, "and separately, what the player has found out");
});

test('a player who has worked nothing out gets no such line', async () => {
  const p = new FakeProvider({ structured: [] });
  await runDirector(p, playState(), 'look around', 'exploration', []).catch(() => {});
  assert.doesNotMatch(p.allSentText(), /worked out/);
});

test('a world without that law says nothing about it', async () => {
  const base = playState();
  const free = { ...base, world: { ...base.world, rules: { ...STANDARD, laws: [] } } };

  const p = new FakeProvider({ structured: [] });
  await runDirector(p, free, 'look around', 'exploration', []).catch(() => {});
  assert.doesNotMatch(p.allSentText(), /cannot leave this floor/);
});

test('each preset gets its own laws array', () => {
  // The count is not the point; not sharing the array is. Asserting a literal
  // here broke the moment a second law landed.
  const before = STANDARD.laws.length;
  presetNamed('standard').laws.length = 0;
  assert.equal(presetNamed('standard').laws.length, before);
  assert.equal(STANDARD.laws.length, before);
});

/** The same claim for the law vocabulary: a constraint nothing checks is a dead field. */
const PROVEN_CONSTRAINTS = [
  'descendBelowGround',  // travel.ts, and the panel that offers the way down
  'crossFloors',         // the Director brief; enforced by construction until anybody can move
  'gainLevels',          // grantXp, asked by both payouts — the climb and the fight
  'takeLoot',            // concludeCombat: both rolls skipped together
  'keepMemories',        // the crossing, in the fold
];

test('EVERY dial in the ruleset has a proven reader', () => {
  // `laws` is a list of laws rather than a bag of dials, so it is enumerated by
  // the constraint guard below instead of this one.
  const actual = (Object.keys(STANDARD) as (keyof Ruleset)[])
    .filter((group) => group !== 'laws')
    .flatMap((group) => Object.keys(STANDARD[group]).map((field) => `${group}.${field}`));

  assert.deepEqual(
    actual.sort(), [...PROVEN].sort(),
    'a rule that changes nothing is the same bug as a field nothing writes — prove it, then list it here',
  );
});

test('EVERY constraint a law can name has a proven checker', () => {
  assert.deepEqual(
    [...CONSTRAINTS].sort(), [...PROVEN_CONSTRAINTS].sort(),
    'a constraint nothing checks is a law that changes nothing - prove it, then list it here',
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
