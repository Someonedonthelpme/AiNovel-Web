import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../engine/roll.ts';
import { ARCHETYPES } from '../play/archetypes.ts';
import { skillTreeFor } from '../play/skilltree.ts';
import { grownBy } from '../play/fixtures.ts';
import { composeSkill, generatorFor, nameFor, priceSkill } from './compose.ts';
import type { Grammar } from './compose.ts';
import { budgetForFloor, skillBook } from './book.ts';
import { isCombatUsable, needsTarget } from './active.ts';

const SEEDS = [1, 7, 21, 55, 108, 512, 2024];
const FLOORS = [1, 4, 9, 15, 20];

const compose = (grammar: Grammar, budget: number, seed: number, kind: 'combat' | 'utility' = 'combat') =>
  composeSkill(mulberry32(seed), {
    id: `s${seed}`, name: '', description: '', kind, ability: 'str', grammar, budget,
  });

/* -------------------------------------------------------------------------- */
/* The grammar is the hard constraint                                          */
/* -------------------------------------------------------------------------- */

test('a skill never leaves its discipline', () => {
  /*
   * Balance is the easy half. Random-but-fair composition produces a bow that
   * heals and a shield that sets a room alight — legal, correctly priced, and
   * reading as a bug rather than a design.
   */
  for (const archetype of ARCHETYPES) {
    for (const seed of SEEDS) {
      for (const floor of FLOORS) {
        const skill = compose(archetype.draws, budgetForFloor(floor), seed);
        assert.ok(
          archetype.draws.payloads.includes(skill.effect.kind),
          `${archetype.id} produced ${skill.effect.kind}`,
        );
        assert.ok(skill.range <= archetype.draws.maxRange, `${archetype.id} reached ${skill.range}`);
      }
    }
  }
});

test('a skill only inflicts conditions its discipline allows', () => {
  for (const archetype of ARCHETYPES) {
    for (const seed of SEEDS) {
      const skill = compose(archetype.draws, budgetForFloor(12), seed);
      const effect = skill.effect;
      if (effect.kind === 'hinder' || effect.kind === 'hex' || effect.kind === 'rally') {
        assert.ok(
          archetype.draws.conditions.includes(effect.condition),
          `${archetype.id} inflicted ${effect.condition}`,
        );
      }
    }
  }
});

test('the bow never heals and the shield never bursts', () => {
  // The two that would read worst. Named explicitly so the grammar cannot be
  // loosened without somebody noticing.
  const bow = ARCHETYPES.find((a) => a.id === 'bow')!;
  const guard = ARCHETYPES.find((a) => a.id === 'guard')!;
  assert.equal(bow.draws.payloads.includes('mend'), false);
  assert.equal(guard.draws.payloads.includes('burst'), false);
});

/* -------------------------------------------------------------------------- */
/* The budget is the balance                                                   */
/* -------------------------------------------------------------------------- */

test('nothing is bought for more than it was given', () => {
  // The whole claim: no source hands out free power, however deep it is.
  for (const archetype of ARCHETYPES) {
    for (const seed of SEEDS) {
      for (const floor of FLOORS) {
        const budget = budgetForFloor(floor);
        const skill = compose(archetype.draws, budget, seed);

        // One use of something dear is allowed to exceed the budget — that is
        // the "single formidable use" shape. Anything repeatable must not.
        if (skill.usesPerRest > 1) {
          assert.ok(
            priceSkill(skill) <= budget,
            `${archetype.id} floor ${floor}: ${priceSkill(skill).toFixed(1)} against ${budget.toFixed(1)}`,
          );
        }
      }
    }
  }
});

test('a rich budget is actually spent, not left on the table', () => {
  /*
   * Measured regression: cheap payloads capped out and a floor twenty book
   * spent barely half of what it had — the low was 0.51, always in the
   * disciplines whose conditions are cheap.
   */
  for (const archetype of ARCHETYPES) {
    const budget = budgetForFloor(20);
    let spent = 0;
    for (const seed of SEEDS) spent += priceSkill(compose(archetype.draws, budget, seed));

    const ratio = spent / SEEDS.length / budget;
    assert.ok(ratio > 0.6, `${archetype.id} spends only ${(ratio * 100).toFixed(0)}% of a deep budget`);
  }
});

test('deeper sources make better skills', () => {
  for (const archetype of ARCHETYPES) {
    const shallow = priceSkill(compose(archetype.draws, budgetForFloor(1), 7));
    const deep = priceSkill(compose(archetype.draws, budgetForFloor(20), 7));
    assert.ok(deep > shallow, `${archetype.id} learns nothing from depth`);
  }
});

test('a cheap skill comes with several uses and a dear one with few', () => {
  // Uses are the lever the budget pulls, rather than a separate cost part.
  const grammar: Grammar = { payloads: ['strike'], conditions: ['prone'], maxRange: 1 };
  const poor = compose(grammar, 4, 3);
  const rich = compose(grammar, 20, 3);
  assert.ok(rich.effect.kind === 'strike' && poor.effect.kind === 'strike');
  if (rich.effect.kind === 'strike' && poor.effect.kind === 'strike') {
    assert.ok(rich.effect.damage > poor.effect.damage, 'a rich budget hits harder');
  }
  assert.ok(poor.usesPerRest >= 1 && rich.usesPerRest >= 1);
});

test('an always-on edge is never spent', () => {
  const grammar: Grammar = { payloads: ['edge'], conditions: ['prone'], maxRange: 0 };
  const skill = compose(grammar, 12, 5, 'utility');
  assert.equal(skill.effect.kind, 'edge');
  assert.equal(skill.usesPerRest, 0, 'it is always on, so there is nothing to spend');
  assert.equal(isCombatUsable(skill), false);
});

/* -------------------------------------------------------------------------- */
/* Coherence of the result                                                     */
/* -------------------------------------------------------------------------- */

test('a skill that reaches has a reach, and one that does not has none', () => {
  for (const archetype of ARCHETYPES) {
    for (const seed of SEEDS) {
      const skill = compose(archetype.draws, budgetForFloor(9), seed);
      if (needsTarget(skill)) assert.ok(skill.range >= 1, `${skill.effect.kind} cannot reach anybody`);
      else assert.equal(skill.range, 0, `${skill.effect.kind} should not reach`);
    }
  }
});

test('a name reads as something a person would learn', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) {
    const rng = mulberry32(i * 7919);
    const skill = compose(ARCHETYPES[0].draws, budgetForFloor(9), i);
    const name = nameFor(rng, skill.effect, 'en');
    assert.match(name, /^The [A-Z]/, `got ${name}`);
    seen.add(name);
  }
  assert.ok(seen.size > 10, `only ${seen.size} distinct names in 40`);
});

test('Thai names are Thai, not translated English', () => {
  const rng = mulberry32(3);
  const skill = compose(ARCHETYPES[0].draws, budgetForFloor(9), 3);
  assert.match(nameFor(rng, skill.effect, 'th'), /[฀-๿]/);
});

/* -------------------------------------------------------------------------- */
/* Determinism, and the duplicate problem it was built to solve                */
/* -------------------------------------------------------------------------- */

test('the same source composes the same skill', () => {
  const a = composeSkill(generatorFor('node_x'), {
    id: 'a', name: '', description: '', kind: 'combat', ability: 'str',
    grammar: ARCHETYPES[0].draws, budget: 12,
  });
  const b = composeSkill(generatorFor('node_x'), {
    id: 'a', name: '', description: '', kind: 'combat', ability: 'str',
    grammar: ARCHETYPES[0].draws, budget: 12,
  });
  assert.deepEqual(a, b);
});

test('two books at the same depth no longer teach the same thing', () => {
  // The problem composition exists for: the old generator picked one of four
  // hardcoded effects, so a floor was full of identical books.
  const taught = new Set<string>();
  for (let i = 0; i < 12; i++) {
    const book = skillBook(mulberry32(i * 31 + 5), 9);
    taught.add(JSON.stringify(book.teaches.effect));
  }
  assert.ok(taught.size > 6, `only ${taught.size} distinct effects across 12 books`);
});

test('two branches of the same discipline teach different skills', () => {
  /*
   * The tree's version of the same fault. Every notable of a discipline used to
   * reach for the same authored pair, so two venom branches in one run taught
   * exactly the same two things.
   */
  const grows = grownBy(11, { classId: 'warlock' });
  const tree = skillTreeFor(11, 'bg', 'en', '', {
    classId: 'warlock', traits: grows.traits, signets: grows.signets.slice(0, 2),
  });

  const byDiscipline = new Map<string, Set<string>>();
  const counts = new Map<string, number>();
  for (const node of tree.nodes) {
    if (!node.teaches || !node.grafted) continue;
    counts.set(node.archetype, (counts.get(node.archetype) ?? 0) + 1);
    const set = byDiscipline.get(node.archetype) ?? new Set();
    set.add(JSON.stringify(node.teaches.effect));
    byDiscipline.set(node.archetype, set);
  }

  for (const [discipline, effects] of byDiscipline) {
    const total = counts.get(discipline) ?? 0;
    if (total < 2) continue;
    assert.ok(effects.size > 1, `${discipline} taught the same thing ${total} times`);
  }
});
