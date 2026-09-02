import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../engine/roll.ts';
import { ABILITIES } from '../combat/types.ts';
import type { Ability } from '../combat/types.ts';
import { STAT_GRAMMAR } from './statgrammar.ts';
import { skillTreeFor } from '../play/skilltree.ts';
import { grownBy } from '../play/fixtures.ts';
import { composeSkill, generatorFor, nameFor, priceSkill } from './compose.ts';
import { budgetForFloor, skillBook } from './book.ts';
import { isCombatUsable, needsTarget } from './active.ts';

const SEEDS = [1, 7, 21, 55, 108, 512, 2024];
const FLOORS = [1, 4, 9, 15, 20];

const compose = (stat: Ability, budget: number, seed: number, kind: 'combat' | 'utility' = 'combat') =>
  composeSkill(mulberry32(seed), {
    id: `s${seed}`, name: '', description: '', kind, ability: stat, grammar: STAT_GRAMMAR[stat], budget,
  });

/* -------------------------------------------------------------------------- */
/* The grammar is the hard constraint                                          */
/* -------------------------------------------------------------------------- */

test('a skill that reaches has a reach, and one that does not has none', () => {
  for (const stat of ABILITIES) {
    for (const seed of SEEDS) {
      const skill = compose(stat, budgetForFloor(9), seed);
      if (needsTarget(skill)) assert.ok(skill.range >= 1, `${skill.effect.kind} cannot reach anybody`);
      else assert.equal(skill.range, 0, `${skill.effect.kind} should not reach`);
    }
  }
});

test('a name reads as something a person would learn', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) {
    const rng = mulberry32(i * 7919);
    const skill = compose('str', budgetForFloor(9), i);
    const name = nameFor(rng, skill.effect, 'en');
    assert.match(name, /^The [A-Z]/, `got ${name}`);
    seen.add(name);
  }
  assert.ok(seen.size > 10, `only ${seen.size} distinct names in 40`);
});

test('Thai names are Thai, not translated English', () => {
  const rng = mulberry32(3);
  const skill = compose('str', budgetForFloor(9), 3);
  assert.match(nameFor(rng, skill.effect, 'th'), /[฀-๿]/);
});

/* -------------------------------------------------------------------------- */
/* Determinism, and the duplicate problem it was built to solve                */
/* -------------------------------------------------------------------------- */

test('the same source composes the same skill', () => {
  const a = composeSkill(generatorFor('node_x'), {
    id: 'a', name: '', description: '', kind: 'combat', ability: 'str',
    grammar: STAT_GRAMMAR.str, budget: 12,
  });
  const b = composeSkill(generatorFor('node_x'), {
    id: 'a', name: '', description: '', kind: 'combat', ability: 'str',
    grammar: STAT_GRAMMAR.str, budget: 12,
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

test('two branches of the same stat teach different skills', () => {
  /*
   * The tree's version of the same fault. Every notable of a discipline used to
   * reach for the same authored pair, so two branches in one run taught exactly
   * the same two things. Composition keys on the NODE, so it cannot recur.
   */
  const grows = grownBy(11, { classId: 'warlock' });
  const tree = skillTreeFor(11, 'bg', 'en', '', {
    classId: 'warlock', traits: grows.traits, signets: grows.signets.slice(0, 2),
  });

  const byDiscipline = new Map<string, Set<string>>();
  const counts = new Map<string, number>();
  for (const node of tree.nodes) {
    if (!node.teaches) continue;
    counts.set(node.stat, (counts.get(node.stat) ?? 0) + 1);
    const set = byDiscipline.get(node.stat) ?? new Set();
    set.add(JSON.stringify(node.teaches.effect));
    byDiscipline.set(node.stat, set);
  }

  for (const [discipline, effects] of byDiscipline) {
    const total = counts.get(discipline) ?? 0;
    if (total < 2) continue;
    assert.ok(effects.size > 1, `${discipline} taught the same thing ${total} times`);
  }
});
