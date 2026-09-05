import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../engine/roll.ts';
import { hasCondition } from '../combat/conditions.ts';
import { soakOf } from '../combat/resolve.ts';
import { referencePc } from '../combat/statblock.ts';
import { edgeFor, isCombatUsable, needsTarget, radiusOf, resolveSkill } from './active.ts';
import type { ActiveSkill } from './active.ts';
import { flat, instant, self, single } from './effect.ts';
import type { Effect } from './effect.ts';
import { priceOfUse } from './pools.ts';
import { activate, isSkillBook, skillBook } from './book.ts';
import { addItem, countOf } from '../items/types.ts';
import { awaitingPlayer, beginEncounter, combatOptions, takeCombatAction } from '../play/combat.ts';
import { playState } from '../play/fixtures.ts';
import { takeRest, useItem } from '../play/rest.ts';
import { activeSkills } from '../session/sheet.ts';
import { groundFloor } from '../world/fixtures.ts';
import type { Condition } from '../combat/types.ts';
import type { PlayState } from '../play/state.ts';
import type { Region } from '../world/types.ts';

const combatant = (over = {}) => ({ ...referencePc(3), id: 'pc', name: 'Anan', ...over });

/* The components, as the things a test actually wants to say. */
const hurt = (amount: number, shape: Effect['shape'] = single): Effect =>
  ({ role: 'purpose', sign: 'minus', channel: 'hp', who: 'foe', shape, duration: instant, formula: flat(amount) });

const heal = (amount: number): Effect =>
  ({ role: 'purpose', sign: 'plus', channel: 'hp', who: 'own', shape: self, duration: instant, formula: flat(amount) });

const lands = (condition: Condition, rounds: number): Effect => ({
  role: 'purpose', sign: 'minus', channel: 'condition', condition, who: 'foe', shape: single,
  duration: { kind: 'rounds', rounds }, formula: flat(1),
});

const pay = (amount: number): Effect =>
  ({ role: 'cost', sign: 'minus', channel: 'stamina', who: 'own', shape: self, duration: instant, formula: flat(amount) });

const edgeOn = (stat: 'wis' | 'cha', bonus: number): Effect => ({
  role: 'purpose', sign: 'plus', channel: 'stat', stat, who: 'own', shape: self,
  duration: { kind: 'sustained' }, formula: flat(bonus),
});

const skill = (id: string, effects: Effect[], over: Partial<ActiveSkill> = {}): ActiveSkill =>
  ({ id, name: id, description: '', ability: 'str', effects, range: 1, ...over });

const hinder = skill('sk_trip', [lands('prone', 2), pay(2)], { name: 'Trip' });

/* -------------------------------------------------------------------------- */
/* What a skill does                                                           */
/* -------------------------------------------------------------------------- */

test('a hindering skill puts the condition on the target, not the user', () => {
  const me = combatant();
  const them = combatant({ id: 'foe1', name: 'wolf' });
  const out = resolveSkill(hinder, me, [them]);

  assert.equal(hasCondition(out.affected[0], 'prone'), true);
  assert.equal(hasCondition(out.actor, 'prone'), false);
});

test('mending closes a wound but never overfills', () => {
  const wounded = combatant({ hp: 2 });
  assert.equal(resolveSkill(skill('sk_mend', [heal(999)]), wounded, []).actor.hp, wounded.maxHp);
});

test('rallying clears a condition off yourself', () => {
  // The same shape as `hinder`, pointed the other way: sign is always from the
  // recipient's side, so `plus` on a condition means it is cleared.
  const down = { ...combatant(), conditions: [{ kind: 'prone' as const, roundsLeft: null }] };
  const rally = skill('sk_up', [{ ...lands('prone', 1), sign: 'plus', who: 'own', shape: self }]);
  assert.equal(hasCondition(resolveSkill(rally, down, []).actor, 'prone'), false);
});

test('a standing bonus is not something you use in a fight', () => {
  assert.equal(isCombatUsable(skill('sk_read', [edgeOn('wis', 2)])), false);
  assert.equal(isCombatUsable(hinder), true);
  assert.equal(needsTarget(hinder), true);
});

test('edges stack only on the ability they are for', () => {
  const skills = [
    skill('a', [edgeOn('wis', 2)]),
    skill('b', [edgeOn('wis', 1)]),
    skill('c', [edgeOn('cha', 2)]),
  ];
  assert.equal(edgeFor(skills, 'wis'), 3);
  assert.equal(edgeFor(skills, 'str'), 0);
});

/* -------------------------------------------------------------------------- */
/* In a fight                                                                  */
/* -------------------------------------------------------------------------- */

function dangerous(): PlayState {
  const floor: Region = { ...groundFloor(), id: 'floor-2', floor: 2, danger: 8, creatures: ['หมาป่าเงา'] };
  const base = playState();
  return {
    ...base,
    world: { ...base.world, currentRegion: 'floor-2', regions: { 'floor-2': floor }, currentPlace: 'town' },
  };
}

/** A character who definitely has a combat active to offer. */
const withSkill = (state: PlayState, s: ActiveSkill): PlayState => ({
  ...state,
  sheet: { ...state.sheet, learned: [s] },
});

/** Options for one specific skill — a character also has what their background taught. */
const optionsFor = (state: PlayState, id: string) =>
  combatOptions(state).filter((o) => o.action.kind === 'skill' && o.action.skill === id);

/** Close the distance until something is within reach, or give up. */
function closeIn(start: PlayState, id: string): PlayState {
  let state = start;
  for (let i = 0; i < 40 && state.combat && !state.combat.over; i++) {
    if (!awaitingPlayer(state)) break;
    if (optionsFor(state, id).length > 0) return state;
    // Out of movement for this round: end the turn and get more next round.
    const step = combatOptions(state).find((o) => o.action.kind === 'move')
      ?? combatOptions(state).find((o) => o.action.kind === 'end');
    if (!step) break;
    state = takeCombatAction(state, step.action).state;
  }
  return state;
}

test('a usable skill is offered once something is in reach', () => {
  // A reach-1 skill has nothing to hit while the wolf is nine squares away —
  // which is the point of skills carrying their own range.
  const state = closeIn(beginEncounter(withSkill(dangerous(), hinder)), hinder.id);
  if (!awaitingPlayer(state)) return;
  const offered = optionsFor(state, hinder.id);
  assert.ok(offered.length > 0, 'the skill should be on the list');
  assert.match(offered[0].label, /Trip/);
  // The label carries the PRICE, not a remaining count. With a shared pool the
  // interesting number is what this takes out of you, because that is what you
  // weigh it against every other skill for.
  assert.match(offered[0].label, /stamina|mana/, 'and it says what it will cost');
});

/**
 * Put the player next to something, without walking there.
 *
 * `closeIn` paths across the arena, which makes any test using it depend on
 * movement — and speed now derives from AGI, so that pathing shifted under
 * tests that were never about pathing. These two are about what a skill COSTS.
 */
function beside(start: PlayState): PlayState {
  const combat = start.combat!;
  const me = combat.combatants['pc'];
  const foe = Object.values(combat.combatants).find((c) => c.side === 'foe' && !c.dead)!;
  return {
    ...start,
    combat: {
      ...combat,
      combatants: {
        ...combat.combatants,
        pc: { ...me, pos: { x: foe.pos.x - 1, y: foe.pos.y } },
      },
    },
  };
}

test('a skill you cannot pay for is not offered at all', () => {
  // Option lists in this game have always been legal moves only — offering
  // something and then refusing it would break that.
  const state = beside(beginEncounter(withSkill(dangerous(), hinder)));
  assert.ok(optionsFor(state, hinder.id).length > 0, 'standing next to it, the skill is on the list');

  const broke = {
    ...state,
    combat: {
      ...state.combat!,
      combatants: {
        ...state.combat!.combatants,
        pc: { ...state.combat!.combatants['pc'], stamina: 0, mana: 0 },
      },
    },
  };
  assert.deepEqual(optionsFor(broke, hinder.id), [], 'nothing left to pay with, so not on the list');
});

test('using a skill spends what its COST EFFECT declares, and lands the purpose', () => {
  // The cost used to be inferred from the payload every time anybody asked.
  // Now the skill carries it, which is what lets a cost be something other
  // than a pool at all.
  const state = beside(beginEncounter(withSkill(dangerous(), hinder)));

  const before = state.combat!.combatants['pc'];
  const [option] = optionsFor(state, hinder.id);
  assert.ok(option, 'the skill should be affordable and on the list');

  const { pool, cost } = priceOfUse(hinder);
  const step = takeCombatAction(state, option.action);
  assert.equal(step.error, null);

  const after = step.state.combat!.combatants['pc'];
  assert.equal(after[pool], before[pool] - cost, `${cost} ${pool} should have been spent`);

  // And the effect landed on somebody who is not you.
  const foes = Object.values(step.state.combat!.combatants).filter((c) => c.side === 'foe');
  assert.ok(
    foes.some((f) => f.conditions.some((c) => c.kind === 'prone')),
    'the target should be prone',
  );
});

test('a skill you do not know is refused', () => {
  const state = beginEncounter(dangerous());
  if (!awaitingPlayer(state)) return;
  assert.match(takeCombatAction(state, { kind: 'skill', skill: 'nonsense' }).error ?? '', /do not know/);
});

test('resting gives back what the fight spent', () => {
  // Skills are on the shared pools, so what a rest restores is the POOL. The
  // choice of what to spend it on therefore survives the rest, instead of every
  // skill being separately topped back up to its own allowance.
  const base = dangerous();
  const drained: PlayState = { ...base, pc: { ...base.pc, stamina: 0, mana: 0, hp: 2 } };
  const rested = takeRest(drained, 'short');
  assert.ok(rested.state.pc.stamina > 0, 'a short rest gives some of it back');
});

/* -------------------------------------------------------------------------- */
/* Where skills come from                                                      */
/* -------------------------------------------------------------------------- */

test('a named skill from the model becomes one that works', () => {
  // The model is good at "Shield Wall"; it has no way to know what the fight
  // economy can absorb.
  const promoted = activate({ id: 'shield_wall', name: 'Shield Wall', description: '', ability: 'str' });
  assert.equal(promoted.name, 'Shield Wall', 'the model keeps the naming');
  assert.ok(promoted.effects.length > 0, 'and the code supplies the effects');
});

test('the same named skill always promotes the same way', () => {
  const named = { id: 'read_ground', name: 'Read the Ground', description: '', ability: 'wis' as const };
  assert.deepEqual(activate(named), activate(named));
});

test('a background skill is usable without reading anything', () => {
  const skills = activeSkills(playState().sheet);
  assert.ok(skills.length > 0, 'the fixture background grants some');
});

test('a book teaches its skill, once, and is spent doing it', () => {
  const base = playState();
  const book = skillBook(mulberry32(4), 1);
  assert.equal(isSkillBook(book), true);

  const carrying: PlayState = { ...base, pc: { ...base.pc, inventory: addItem(base.pc.inventory, book) } };
  const read = useItem(carrying, book.id);

  assert.equal(read.error, null);
  assert.ok(read.state.sheet.learned?.some((s) => s.id === book.teaches.id), 'the skill is kept');
  assert.equal(countOf(read.state.pc.inventory, book.id), 0, 'the book is spent');
});

test('a book too advanced to follow is not wasted', () => {
  const base = playState();
  const deep = skillBook(mulberry32(7), 20);
  assert.ok(deep.teaches.requires?.length, 'a deep book asks something of the reader');

  const carrying: PlayState = { ...base, pc: { ...base.pc, inventory: addItem(base.pc.inventory, deep) } };
  const read = useItem(carrying, deep.id);

  assert.match(read.error ?? '', /makes sense/);
  assert.ok(countOf(read.state.pc.inventory, deep.id) > 0, 'and it stays in the pack');
});

test('a skill reaches as far as the skill says, not as far as your weapon', () => {
  // Regression: targets were taken from the equipped weapon's range, so a
  // reach-1 skill was unusable to anyone holding a sling — and unusable to
  // everyone at the start of a fight.
  // The two sides open about nine squares apart, so "long" has to clear that.
  const far: ActiveSkill = { ...hinder, id: 'sk_far', name: 'Call Down', range: 10 };
  const state = beginEncounter(withSkill(dangerous(), far));
  if (!awaitingPlayer(state)) return;
  assert.ok(optionsFor(state, far.id).length > 0, 'a long-reach skill works from where you stand');
});

/* -------------------------------------------------------------------------- */
/* The wider effect vocabulary                                                 */
/* -------------------------------------------------------------------------- */

test('damage goes through the engine, so dying still works', () => {
  // Damage goes through applyDamage rather than subtracting hp directly: a
  // skill that killed somebody by a different route than a sword would be a
  // second set of rules to keep in step.
  const me = combatant();
  const them = combatant({ id: 'foe1', name: 'wolf', hp: 3, maxHp: 20 });

  const out = resolveSkill(skill('sk_hit', [hurt(9)]), me, [them]);
  assert.equal(out.affected[0].hp, 0);
  assert.ok(out.affected[0].dying || out.affected[0].dead, 'dropped, not silently at zero');
});

test('TWO EFFECTS IN ONE ACTION hurt them and feed you', () => {
  // What `drain` always was. It needed a fused union arm before; it is a list
  // of two now, which is the whole argument for components.
  const me = combatant({ hp: 5 });
  const them = combatant({ id: 'foe1', name: 'wolf', hp: 20, maxHp: 20 });

  const out = resolveSkill(skill('sk_drain', [hurt(6), heal(3)]), me, [them]);
  assert.equal(out.affected[0].hp, 20 - (6 - soakOf(them, 6)));
  assert.equal(out.actor.hp, 8, 'what you drain is not reduced — you take all of it');
});

test('and it cannot overfill you either', () => {
  const me = combatant({ hp: combatant().maxHp - 1 });
  const them = combatant({ id: 'foe1', hp: 20, maxHp: 20 });
  assert.equal(resolveSkill(skill('sk_drain', [hurt(6), heal(99)]), me, [them]).actor.hp, me.maxHp);
});

test('a burst catches everyone it was given', () => {
  const me = combatant();
  const pack = [
    combatant({ id: 'f1', name: 'a', hp: 20, maxHp: 20 }),
    combatant({ id: 'f2', name: 'b', hp: 20, maxHp: 20 }),
    combatant({ id: 'f3', name: 'c', hp: 20, maxHp: 20 }),
  ];

  const out = resolveSkill(skill('sk_burst', [hurt(5, { kind: 'burst', radius: 2 })]), me, pack);
  assert.equal(out.affected.length, 3);
  assert.ok(out.affected.every((c) => c.hp === 20 - (5 - soakOf(c, 5))), 'each soaks it by their own VIT');
});

test('an action can both hurt and stick', () => {
  const me = combatant();
  const them = combatant({ id: 'foe1', name: 'wolf', hp: 20, maxHp: 20 });

  const out = resolveSkill(skill('sk_hex', [hurt(4), lands('poisoned', 3)]), me, [them]);
  assert.equal(out.affected[0].hp, 20 - (4 - soakOf(them, 4)));
  assert.equal(hasCondition(out.affected[0], 'poisoned'), true);
});

test('needing a target follows from WHO, not from a table of payload kinds', () => {
  assert.equal(needsTarget(skill('a', [hurt(4)])), true);
  assert.equal(needsTarget(skill('b', [lands('prone', 1)])), true);
  assert.equal(needsTarget(skill('c', [heal(4)])), false);
  assert.equal(needsTarget(skill('d', [heal(4), pay(2)])), false, 'and a cost never makes it reach out');
});

test('a radius is read off the shape, and only a burst has one', () => {
  assert.equal(radiusOf(skill('sk_burst', [hurt(5, { kind: 'burst', radius: 3 })])), 3);
  assert.equal(radiusOf(hinder), 0);
});
