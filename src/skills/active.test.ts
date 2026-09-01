import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../engine/roll.ts';
import { hasCondition } from '../combat/conditions.ts';
import { referencePc } from '../combat/statblock.ts';
import { edgeFor, isCombatUsable, needsTarget, refreshUses, resolveSkill, spendUse, usesLeft } from './active.ts';
import type { ActiveSkill } from './active.ts';
import { activate, isSkillBook, skillBook } from './book.ts';
import { addItem } from '../items/types.ts';
import { awaitingPlayer, beginEncounter, combatOptions, takeCombatAction } from '../play/combat.ts';
import { playState } from '../play/fixtures.ts';
import { takeRest, useItem } from '../play/rest.ts';
import { activeSkills } from '../session/sheet.ts';
import { groundFloor } from '../world/fixtures.ts';
import type { PlayState } from '../play/state.ts';
import type { Region } from '../world/types.ts';

const combatant = (over = {}) => ({ ...referencePc(3), id: 'pc', name: 'Anan', ...over });

const hinder: ActiveSkill = {
  id: 'sk_trip', name: 'Trip', description: '', kind: 'combat', ability: 'str',
  effect: { kind: 'hinder', condition: 'prone', rounds: 2 }, range: 1, usesPerRest: 2,
};

/* -------------------------------------------------------------------------- */
/* What a skill does                                                           */
/* -------------------------------------------------------------------------- */

test('a hindering skill puts the condition on the target, not the user', () => {
  const me = combatant();
  const them = combatant({ id: 'foe1', name: 'wolf' });
  const out = resolveSkill(hinder, me, them);

  assert.equal(hasCondition(out.target!, 'prone'), true);
  assert.equal(hasCondition(out.actor, 'prone'), false);
});

test('mending closes a wound but never overfills', () => {
  const hurt = combatant({ hp: 2 });
  const mend: ActiveSkill = { ...hinder, id: 'sk_mend', effect: { kind: 'mend', amount: 999 } };
  assert.equal(resolveSkill(mend, hurt, null).actor.hp, hurt.maxHp);
});

test('rallying clears a condition off yourself', () => {
  const down = { ...combatant(), conditions: [{ kind: 'prone' as const, roundsLeft: null }] };
  const rally: ActiveSkill = { ...hinder, id: 'sk_up', effect: { kind: 'rally', condition: 'prone' } };
  assert.equal(hasCondition(resolveSkill(rally, down, null).actor, 'prone'), false);
});

test('an edge is not something you use in a fight', () => {
  const edge: ActiveSkill = { ...hinder, id: 'sk_read', effect: { kind: 'edge', ability: 'wis', bonus: 2 } };
  assert.equal(isCombatUsable(edge), false);
  assert.equal(isCombatUsable(hinder), true);
  assert.equal(needsTarget(hinder), true);
});

test('edges stack only on the ability they are for', () => {
  const skills: ActiveSkill[] = [
    { ...hinder, id: 'a', effect: { kind: 'edge', ability: 'wis', bonus: 2 } },
    { ...hinder, id: 'b', effect: { kind: 'edge', ability: 'wis', bonus: 1 } },
    { ...hinder, id: 'c', effect: { kind: 'edge', ability: 'cha', bonus: 2 } },
  ];
  assert.equal(edgeFor(skills, 'wis'), 3);
  assert.equal(edgeFor(skills, 'str'), 0);
});

/* -------------------------------------------------------------------------- */
/* Uses                                                                        */
/* -------------------------------------------------------------------------- */

test('a skill runs out, and resting gives it back', () => {
  // The reason actives are a resource: unlimited, they are just a better basic
  // attack and the fight becomes a rotation.
  let spent = {};
  assert.equal(usesLeft(hinder, spent), 2);
  spent = spendUse(spendUse(spent, hinder.id), hinder.id);
  assert.equal(usesLeft(hinder, spent), 0);
  assert.equal(usesLeft(hinder, refreshUses()), 2);
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
const withSkill = (state: PlayState, skill: ActiveSkill): PlayState => ({
  ...state,
  sheet: { ...state.sheet, learned: [skill] },
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
  assert.match(offered[0].label, /left/, 'and it says how many uses remain');
});

test('a spent skill is not offered at all', () => {
  // Option lists in this game have always been legal moves only — offering
  // something and then refusing it would break that.
  const base = withSkill(dangerous(), hinder);
  const state = beginEncounter({ ...base, pc: { ...base.pc, skillUses: { [hinder.id]: 2 } } });
  if (!awaitingPlayer(state)) return;
  assert.deepEqual(optionsFor(state, hinder.id), [], 'spent, so not on the list at all');
});

test('using a skill spends a use and lands the effect', () => {
  const state = closeIn(beginEncounter(withSkill(dangerous(), hinder)), hinder.id);
  if (!awaitingPlayer(state)) return;

  const [option] = optionsFor(state, hinder.id);
  if (!option) return;

  const step = takeCombatAction(state, option.action);
  assert.equal(step.error, null);
  assert.equal(step.state.pc.skillUses[hinder.id], 1, 'a use is spent');

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

test('resting refreshes what the fight spent', () => {
  const base = dangerous();
  const drained: PlayState = { ...base, pc: { ...base.pc, skillUses: { [hinder.id]: 2 }, hp: 2 } };
  const rested = takeRest(drained, 'short');
  assert.deepEqual(rested.state.pc.skillUses, {}, 'actives are on the same supply economy as healing');
});

/* -------------------------------------------------------------------------- */
/* Where skills come from                                                      */
/* -------------------------------------------------------------------------- */

test('a named skill from the model becomes one that works', () => {
  // The model is good at "Shield Wall"; it has no way to know what the fight
  // economy can absorb.
  const promoted = activate({ id: 'shield_wall', name: 'Shield Wall', description: '', ability: 'str', kind: 'combat' });
  assert.equal(promoted.name, 'Shield Wall', 'the model keeps the naming');
  assert.ok(promoted.effect, 'and the code supplies the effect');
  assert.ok(promoted.usesPerRest > 0, 'a combat skill is a resource');
});

test('the same named skill always promotes the same way', () => {
  const skill = { id: 'read_ground', name: 'Read the Ground', description: '', ability: 'wis' as const, kind: 'utility' as const };
  assert.deepEqual(activate(skill), activate(skill));
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
  assert.equal(read.state.pc.inventory.stacks.some((s) => s.item.id === book.id), false, 'the book is spent');
});

test('a book too advanced to follow is not wasted', () => {
  const base = playState();
  const deep = skillBook(mulberry32(7), 20);
  assert.ok(deep.teaches.requires?.length, 'a deep book asks something of the reader');

  const carrying: PlayState = { ...base, pc: { ...base.pc, inventory: addItem(base.pc.inventory, deep) } };
  const read = useItem(carrying, deep.id);

  assert.match(read.error ?? '', /makes sense/);
  assert.ok(read.state.pc.inventory.stacks.some((s) => s.item.id === deep.id), 'and it stays in the pack');
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
