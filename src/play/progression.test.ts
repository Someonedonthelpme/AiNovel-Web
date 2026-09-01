import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../engine/roll.ts';
import { addItem, emptyInventory } from '../items/types.ts';
import { rations, draught, weapon } from '../items/catalogue.ts';
import {
  abilityPointsBetween, depthFactor, grantXp, spendAbilityPoint, xpForFight, xpForNewDepth, xpToNext,
} from './progress.ts';
import { allocate, allocationOf, canAllocate, totalGrant, visibleNodes } from './allocate.ts';
import { ARCHETYPES, MAX_DISCIPLINES, MIN_DISCIPLINES, skillTreeFor } from './skilltree.ts';
import { activeSkills } from '../session/sheet.ts';
import { awardTraits, COUNTERS, newlyEarned, progressOf, traitMet } from './traits.ts';
import { TRAITS } from './traitbook.ts';
import { canRest, takeRest, useItem } from './rest.ts';
import { playState } from './fixtures.ts';
import { derive } from '../session/sheet.ts';
import type { CharacterSheet } from '../session/sheet.ts';
import type { PlayState } from './state.ts';
import type { TraitContext } from './traits.ts';

const ctxOf = (state: PlayState): TraitContext => ({
  sheet: state.sheet,
  inventory: state.pc.inventory,
  counters: state.sheet.counters,
  personality: state.sheet.personality,
});

/* -------------------------------------------------------------------------- */
/* Experience                                                                  */
/* -------------------------------------------------------------------------- */

test('farming the shallows is not worth it', () => {
  // The whole reason depthFactor exists: the tower regenerates floors, so
  // without a fall-off, grinding floor 2 forever would be optimal.
  const atDepth = xpForFight(8, 8, 1);
  const grinding = xpForFight(2, 8, 1);
  assert.ok(grinding * 8 < atDepth, `grinding paid ${grinding} against ${atDepth}`);
});

test('depth is worth full value only when it is a match for you', () => {
  assert.equal(depthFactor(10, 5), 1, 'over your level is capped, not rewarded further');
  assert.ok(depthFactor(5, 5) === 1);
  assert.ok(depthFactor(2, 8) < 0.1);
});

test('a first climb to a new depth cannot be farmed, so it pays in full', () => {
  assert.ok(xpForNewDepth(10) > xpForFight(10, 10, 1));
});

test('experience carries through several levels at once', () => {
  const base = playState().sheet;
  const huge = xpToNext(1) + xpToNext(2) + xpToNext(3);
  const { sheet, levelled } = grantXp(base, huge);
  assert.equal(sheet.level, 4);
  assert.equal(levelled?.from, 1);
  assert.equal(levelled?.to, 4);
});

test('skill points come every level; ability points do not', () => {
  const base = playState().sheet;
  const startingPoints = base.skillPoints ?? 0;
  let sheet = base;
  for (let i = 0; i < 4; i++) sheet = grantXp(sheet, xpToNext(sheet.level)).sheet;

  assert.equal(sheet.level, 5);
  assert.equal(sheet.skillPoints, startingPoints + 4, 'one per level, on top of the one you start with');
  assert.equal(sheet.abilityPoints, abilityPointsBetween(1, 5));
  assert.ok((sheet.abilityPoints ?? 0) < 4, 'a raw stat point is the rare one');
});

test('a score cannot be pushed past twenty', () => {
  let sheet: CharacterSheet = { ...playState().sheet, abilityPoints: 40 };
  for (let i = 0; i < 40; i++) {
    const r = spendAbilityPoint(sheet, 'str');
    if (r.error) break;
    sheet = r.sheet;
  }
  assert.equal(derive(sheet).abilities.str, 20);
  assert.match(spendAbilityPoint(sheet, 'str').error ?? '', /already at 20/);
});

test('spending a point you do not have is refused', () => {
  assert.match(spendAbilityPoint(playState().sheet, 'str').error ?? '', /no points/);
});

/* -------------------------------------------------------------------------- */
/* The passive tree                                                            */
/* -------------------------------------------------------------------------- */

const treeOf = (state: PlayState) => skillTreeFor(state.world.seed, state.sheet.background.id, 'en');

test('the same character always gets the same tree', () => {
  const a = skillTreeFor(42, 'soldier');
  const b = skillTreeFor(42, 'soldier');
  assert.deepEqual(a.nodes.map((n) => n.id), b.nodes.map((n) => n.id));
  assert.notDeepEqual(a.nodes.map((n) => n.name), skillTreeFor(42, 'scholar').nodes.map((n) => n.name));
});

test('every edge is walkable from both ends', () => {
  const tree = skillTreeFor(7, 'soldier');
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  for (const node of tree.nodes) {
    for (const to of node.connections) {
      assert.ok(byId.get(to)?.connections.includes(node.id), `${node.id} → ${to} is one-way`);
    }
  }
});

test('a point can only go somewhere you can reach', () => {
  // The contiguity rule is the whole mechanic: without it the tree is a
  // shopping list and every build buys the same keystones.
  const state = playState();
  const tree = treeOf(state);
  const sheet = { ...state.sheet, skillPoints: 5 };
  const ctx = { ...ctxOf(state), sheet };

  const far = tree.nodes.find((n) => n.ring === 3)!;
  assert.match(canAllocate(tree, allocationOf(sheet, tree), ctx, far.id).reason ?? '', /not reached/);

  const adjacent = tree.nodes.find((n) => n.ring === 1)!;
  assert.equal(canAllocate(tree, allocationOf(sheet, tree), ctx, adjacent.id).ok, true);
});

test('walking a route costs a point at every step', () => {
  const state = playState();
  const tree = treeOf(state);
  let sheet: CharacterSheet = { ...state.sheet, skillPoints: 3 };

  const branch = tree.nodes.filter((n) => n.archetype === tree.home && n.ring > 0).sort((a, b) => a.ring - b.ring);
  for (const node of branch.slice(0, 3)) {
    const r = allocate(tree, { ...ctxOf(state), sheet }, node.id);
    assert.equal(r.error, null, `could not take ${node.id}`);
    sheet = r.sheet;
  }
  assert.equal(sheet.skillPoints, 0);
  assert.equal(sheet.allocated?.length, 4, 'the start plus three');
});

test('spending your last point stops you', () => {
  const state = playState();
  const tree = treeOf(state);
  const sheet = { ...state.sheet, skillPoints: 0 };
  const first = tree.nodes.find((n) => n.ring === 1)!;
  assert.match(canAllocate(tree, allocationOf(sheet, tree), { ...ctxOf(state), sheet }, first.id).reason ?? '', /no skill points/);
});

test('a hidden node does not exist until it is earned', () => {
  // Not greyed out — absent. This is the seam the Signet gates hang from.
  const state = playState();
  const tree = treeOf(state);
  const keystones = tree.nodes.filter((n) => n.kind === 'keystone');
  assert.ok(keystones.length > 0);

  const early = visibleNodes(tree, ctxOf(state));
  assert.equal(early.some((n) => n.kind === 'keystone'), false, 'not at level 1');

  const veteran = { ...ctxOf(state), sheet: { ...state.sheet, level: 20 } };
  assert.ok(visibleNodes(tree, veteran).some((n) => n.kind === 'keystone'));
});

test('a tree holds a subset, not every discipline there is', () => {
  // What is missing is missing for good: a soldier cannot buy their way into
  // black magic, because that branch was never printed on their tree.
  const tree = skillTreeFor(21, 'soldier', 'en');
  assert.ok(tree.disciplines.length >= MIN_DISCIPLINES);
  assert.ok(tree.disciplines.length <= MAX_DISCIPLINES);
  assert.ok(tree.disciplines.length < ARCHETYPES.length, 'a subset, not the lot');
  assert.ok(tree.disciplines.includes(tree.home), 'and it always holds your own');
});

test('different backgrounds get different trees, not the same map re-entered', () => {
  const soldier = skillTreeFor(21, 'soldier', 'en', 'Soldier');
  const scholar = skillTreeFor(21, 'scholar', 'en', 'Scholar of the Archive');

  assert.notDeepEqual(soldier.disciplines, scholar.disciplines);
  assert.notEqual(soldier.home, scholar.home);
  assert.notDeepEqual(
    soldier.nodes.map((n) => n.id).sort(),
    scholar.nodes.map((n) => n.id).sort(),
    'the shape differs too, not only the entry point',
  );
});

test('the same character always gets the same tree back', () => {
  // Chaos in the generator, determinism in the result: a reloaded session must
  // show the tree the player has been spending points on.
  const a = skillTreeFor(9, 'harbour_guard', 'en', 'Harbour Guard');
  const b = skillTreeFor(9, 'harbour_guard', 'en', 'Harbour Guard');
  assert.deepEqual(a.nodes, b.nodes);
  assert.deepEqual(a.disciplines, b.disciplines);
});

test('every discipline on a tree teaches, and every node is reachable from the start', () => {
  // A branch has to say what kind of character you are becoming, which means
  // teaching something. And a node nothing connects to is a node nobody can buy.
  for (const seed of [1, 7, 21, 55, 108]) {
    const tree = skillTreeFor(seed, 'soldier', 'en');

    for (const id of tree.disciplines) {
      const teaching = tree.nodes.filter((n) => n.archetype === id && n.teaches);
      assert.ok(teaching.length > 0, `seed ${seed}: ${id} teaches nothing`);
    }

    // Walk the graph. Islands are included: they are gated, not orphaned.
    const byId = new Map(tree.nodes.map((n) => [n.id, n]));
    const seen = new Set<string>([tree.start]);
    const queue = [tree.start];
    while (queue.length) {
      const here = byId.get(queue.shift()!);
      for (const next of here?.connections ?? []) {
        if (!seen.has(next) && byId.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    assert.equal(seen.size, tree.nodes.length, `seed ${seed}: ${tree.nodes.length - seen.size} orphaned nodes`);
  }
});

test('islands exist, and stay invisible until something opens them', () => {
  // The dynamic half. A locked door you can see is a different thing from a
  // place you do not know is there.
  const state = playState();
  const tree = skillTreeFor(4, 'soldier', 'en');
  const island = tree.nodes.filter((n) => n.id.startsWith('isle'));
  assert.ok(island.length > 0, 'the seed should have grown at least one');
  assert.ok(island.every((n) => n.requires?.length), 'every island node is gated');

  const early = visibleNodes(tree, ctxOf(state));
  assert.equal(early.some((n) => n.id.startsWith('isle')), false, 'not drawn at all yet');

  const veteran = {
    ...ctxOf(state),
    sheet: { ...state.sheet, level: 20 },
    counters: { deepest_floor: 30, kills: 300, floors_climbed: 40 },
  };
  assert.ok(visibleNodes(tree, veteran).some((n) => n.id.startsWith('isle')), 'and there once earned');
});

test('branches vary in shape and length rather than marching in step', () => {
  // A perfectly radial tree is a wheel, and a wheel has no decisions in it.
  const tree = skillTreeFor(33, 'soldier', 'en');
  const depths = tree.disciplines.map(
    (id) => Math.max(...tree.nodes.filter((n) => n.archetype === id && n.ring < 9).map((n) => n.ring)),
  );
  assert.ok(new Set(depths).size > 1, `every branch ran to the same depth: ${depths.join(', ')}`);
});

test('taking a notable teaches its skill', () => {
  // This is what was missing: the tree had no actives in it at all.
  const state = playState();
  const tree = treeOf(state);
  const notable = tree.nodes.find((n) => n.teaches && n.archetype === tree.home)!;

  // Walk out to it, paying for the route like anyone would.
  const route = tree.nodes
    .filter((n) => n.archetype === tree.home && n.ring > 0 && n.ring <= notable.ring)
    .sort((a, b) => a.ring - b.ring);

  let sheet: CharacterSheet = { ...state.sheet, skillPoints: route.length };
  for (const node of route) sheet = allocate(tree, { ...ctxOf(state), sheet }, node.id).sheet;

  assert.ok(
    sheet.learned?.some((s) => s.id === notable.teaches!.id),
    'the notable should have taught something usable',
  );
  assert.ok(activeSkills(sheet).some((s) => s.id === notable.teaches!.id));
});

test('the tree opens next to the discipline the background trained for', () => {
  assert.equal(skillTreeFor(1, 'harbour_guard').home, 'guard');
  assert.equal(skillTreeFor(1, 'scholar_of_the_archive').home, 'magic');
  assert.equal(skillTreeFor(1, 'dock_thief').home, 'guile');
  assert.equal(skillTreeFor(1, 'something_unheard_of').home, 'sword', 'and falls back rather than failing');
});

test('the display name is read too, since ids are generated', () => {
  // Observed: a "Lighthouse Keeper" arrived with a meaningless id and was sent
  // to the sword — the fallback for "no idea" rather than an answer.
  assert.equal(skillTreeFor(1, 'bg_2', 'en', 'Lighthouse Keeper').home, 'wisdom');
  assert.equal(skillTreeFor(1, 'bg_7', 'en', 'Blood Cultist').home, 'blackMagic');
  assert.equal(skillTreeFor(1, 'bg_9', 'en', 'Fisher').home, 'survival');
});

test('the tree is a web, not eight separate ladders', () => {
  // Cross-links are what let a build hybridise instead of committing to one
  // spoke forever.
  const tree = skillTreeFor(5, 'soldier');
  const crossings = tree.nodes.filter((n) =>
    n.connections.some((c) => tree.nodes.find((o) => o.id === c)?.archetype !== n.archetype && c !== 'start'),
  );
  assert.ok(crossings.length > 0, 'some branches should touch');
});

test('a keystone gives with one hand and takes with the other', () => {
  const tree = skillTreeFor(11, 'soldier');
  const keystone = tree.nodes.find((n) => n.kind === 'keystone')!;
  assert.ok(keystone.cost, 'without a cost every build takes every keystone');

  const total = totalGrant(tree, [tree.start, keystone.id]);
  const gains = total.maxHp + total.ac + total.attack + total.damage;
  const raw = (keystone.grant.maxHp ?? 0) + (keystone.grant.ac ?? 0) + (keystone.grant.attack ?? 0) + (keystone.grant.damage ?? 0);
  assert.ok(gains < raw, 'the cost has to actually come off');
});

test('what the tree grants reaches the character', () => {
  const state = playState();
  const tree = treeOf(state);
  const before = derive(state.sheet, state.pc.inventory);

  let sheet: CharacterSheet = { ...state.sheet, skillPoints: 4 };
  const branch = tree.nodes.filter((n) => n.archetype === tree.home && n.ring > 0).sort((a, b) => a.ring - b.ring);
  for (const node of branch.slice(0, 3)) {
    sheet = allocate(tree, { ...ctxOf(state), sheet }, node.id).sheet;
  }

  const after = derive(sheet, state.pc.inventory);
  const moved =
    after.maxHp !== before.maxHp
    || after.ac !== before.ac
    || JSON.stringify(after.abilities) !== JSON.stringify(before.abilities);
  assert.ok(moved, 'three nodes should have changed something');
});

/* -------------------------------------------------------------------------- */
/* Traits                                                                      */
/* -------------------------------------------------------------------------- */

test('every trait gates on a counter something actually increments', () => {
  // A trait keyed to a tally nobody keeps can never be earned, and nothing in
  // the game would ever say so.
  const live = new Set(Object.values(COUNTERS));
  for (const trait of TRAITS) {
    for (const condition of trait.requires) {
      if (condition.kind === 'counter') {
        assert.ok(live.has(condition.counter as never), `${trait.id} gates on dead counter ${condition.counter}`);
      }
    }
  }
});

test('a trait arrives when its conditions come true, and only then', () => {
  const state = playState();
  const ctx = ctxOf(state);
  assert.equal(traitMet(TRAITS.find((t) => t.id === 'blooded')!, ctx), false);

  const blooded = { ...ctx, counters: { [COUNTERS.kills]: 10 } };
  assert.equal(traitMet(TRAITS.find((t) => t.id === 'blooded')!, blooded), true);
});

test('a trait is announced once, not every turn after', () => {
  const state = playState();
  const sheet = { ...state.sheet, counters: { [COUNTERS.kills]: 10 } };

  const first = awardTraits(TRAITS, sheet, state.pc.inventory);
  assert.deepEqual(first.earned.map((t) => t.id), ['blooded']);

  const second = awardTraits(TRAITS, first.sheet, state.pc.inventory);
  assert.deepEqual(second.earned, [], 'already held');
});

test('what a trait grants reaches the character', () => {
  const state = playState();
  const sheet = { ...state.sheet, counters: { [COUNTERS.kills]: 30 }, baseAbilities: { ...state.sheet.baseAbilities, str: 15 } };
  const awarded = awardTraits(TRAITS, sheet, state.pc.inventory);
  assert.ok(awarded.earned.some((t) => t.id === 'butcher'));
  assert.equal(derive(awarded.sheet).abilities.str, derive(sheet).abilities.str + 1);
});

test('progress is reported per condition, not as one average', () => {
  // "kill 30 things" and "have 20 strength" do not average into anything.
  const state = playState();
  const butcher = TRAITS.find((t) => t.id === 'butcher')!;
  const rows = progressOf(butcher, { ...ctxOf(state), counters: { [COUNTERS.kills]: 12 } });

  assert.equal(rows.length, 2);
  const kills = rows.find((r) => r.label.includes('kills'))!;
  assert.equal(kills.have, 12);
  assert.equal(kills.need, 30);
  assert.equal(kills.met, false);
});

test('newlyEarned never re-offers what is already held', () => {
  const state = playState();
  const ctx = { ...ctxOf(state), counters: { [COUNTERS.kills]: 10 } };
  assert.deepEqual(newlyEarned(TRAITS, ['blooded'], ctx), []);
});

/* -------------------------------------------------------------------------- */
/* Rest and consumables                                                        */
/* -------------------------------------------------------------------------- */

const hurt = (state: PlayState, hp: number): PlayState => ({ ...state, pc: { ...state.pc, hp } });

test('a short rest costs food, and without food there is no rest', () => {
  const state = hurt(playState(), 2);
  assert.equal(canRest(state, 'short').ok, true);

  const rested = takeRest(state, 'short');
  assert.ok(rested.healed > 0);
  assert.ok(rested.state.pc.hp > state.pc.hp);

  let empty = rested.state;
  for (let i = 0; i < 5 && canRest(empty, 'short').ok; i++) empty = takeRest(empty, 'short').state;
  assert.match(canRest(empty, 'short').reason ?? '', /nothing left to eat/);
});

test('a full night means going back to town', () => {
  // If a full heal were available on any floor, the difficulty curve would be
  // decorative and the hub would have no mechanical purpose.
  const state = playState();
  const upstairs: PlayState = {
    ...state,
    world: { ...state.world, regions: { 'floor-0': { ...state.world.regions['floor-0'], floor: 4 } as never } },
  };
  assert.match(canRest(upstairs, 'long').reason ?? '', /back down to town/);
});

test('a long rest in town puts everything back', () => {
  const state = hurt(playState(), 1);
  assert.equal(canRest(state, 'long').ok, true, 'the fixture starts in a settlement on the ground floor');

  const rested = takeRest(state, 'long');
  assert.equal(rested.state.pc.hp, rested.state.pc.maxHp);
  assert.equal(rested.state.sheet.mental.fatigue, 0);
  assert.ok(rested.turnsSpent > 1, 'and the world moves on while you sleep');
});

test('you cannot rest in the middle of a fight', () => {
  const state = { ...playState(), combat: { over: false } as never };
  assert.match(canRest(state, 'short').reason ?? '', /middle of a fight/);
});

test('a potion heals by what the item says, not by what a model felt like', () => {
  const state = hurt(playState(), 1);
  const phial = draught(1);
  const withPhial: PlayState = { ...state, pc: { ...state.pc, inventory: addItem(state.pc.inventory, phial) } };

  const effect = phial.effect!;
  assert.equal(effect.kind, 'heal');
  const expected = effect.kind === 'heal' ? Math.min(withPhial.pc.maxHp, 1 + effect.amount) : 0;

  const used = useItem(withPhial, phial.id);
  assert.equal(used.error, null);
  assert.equal(used.state.pc.hp, expected, 'healed by exactly what the item declares');
  assert.equal(used.state.pc.inventory.stacks.find((s) => s.item.id === phial.id), undefined, 'and it is used up');
});

test('you cannot drink what you do not have, or eat a sword', () => {
  const state = playState();
  assert.match(useItem(state, 'nothing_like_this').error ?? '', /not carrying/);

  const blade = weapon(mulberry32(2), 3);
  const armed: PlayState = { ...state, pc: { ...state.pc, inventory: addItem(state.pc.inventory, blade) } };
  assert.match(useItem(armed, blade.id).error ?? '', /not something you can use up/);
});

test('a character starts with food, or short rests would be unusable', () => {
  const state = playState();
  assert.ok(state.pc.inventory.stacks.some((s) => s.item.id === rations(1).item.id));
});
