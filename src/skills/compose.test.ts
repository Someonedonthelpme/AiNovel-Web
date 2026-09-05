import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../engine/roll.ts';
import { ABILITIES } from '../combat/types.ts';
import type { Ability } from '../combat/types.ts';
import { STAT_GRAMMAR } from './statgrammar.ts';
import { skillTreeFor } from '../play/skilltree.ts';
import { grownBy } from '../play/fixtures.ts';
import { composeSkill, generatorFor, priceSkill } from './compose.ts';
import { purposes } from './effect.ts';
import { budgetForFloor, skillBook } from './book.ts';
import { isCombatUsable, needsTarget } from './active.ts';

const SEEDS = [1, 7, 21, 55, 108, 512, 2024];
const FLOORS = [1, 4, 9, 15, 20];

const compose = (stat: Ability, budget: number, seed: number, language: 'th' | 'en' = 'en') =>
  composeSkill(mulberry32(seed), {
    id: `s${seed}`, name: '', description: '', ability: stat, grammar: STAT_GRAMMAR[stat], budget, language,
  });

/** What a skill DOES, as a comparable string — the thing two books must not share. */
const shapeOf = (skill: { effects: unknown[] }) => JSON.stringify(purposes(skill.effects as never));

/* -------------------------------------------------------------------------- */
/* The grammar is the hard constraint                                          */
/* -------------------------------------------------------------------------- */

test('a skill that reaches has a reach, and one that does not has none', () => {
  for (const stat of ABILITIES) {
    for (const seed of SEEDS) {
      const skill = compose(stat, budgetForFloor(9), seed);
      if (needsTarget(skill)) assert.ok(skill.range >= 1, `${skill.name} cannot reach anybody`);
      else assert.equal(skill.range, 0, `${skill.name} should not reach`);
    }
  }
});

test('a name reads as something a person would learn', () => {
  // Named by the composer itself, because only there is the payload kind still
  // known — every caller used to be handed a kind it had already discarded.
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) {
    const skill = compose('str', budgetForFloor(9), i);
    assert.match(skill.name, /^The [A-Z]/, `got ${skill.name}`);
    seen.add(skill.name);
  }
  assert.ok(seen.size > 10, `only ${seen.size} distinct names in 40`);
});

test('Thai names are Thai, not translated English', () => {
  assert.match(compose('str', budgetForFloor(9), 3, 'th').name, /[฀-๿]/);
});

test('a name the caller supplied is never overwritten', () => {
  const named = composeSkill(mulberry32(5), {
    id: 'x', name: 'Shield Wall', description: '', ability: 'str',
    grammar: STAT_GRAMMAR.str, budget: 12,
  });
  assert.equal(named.name, 'Shield Wall');
});

/* -------------------------------------------------------------------------- */
/* Determinism, and the duplicate problem it was built to solve                */
/* -------------------------------------------------------------------------- */

test('the same source composes the same skill', () => {
  const a = composeSkill(generatorFor('node_x'), {
    id: 'a', name: '', description: '', ability: 'str',
    grammar: STAT_GRAMMAR.str, budget: 12,
  });
  const b = composeSkill(generatorFor('node_x'), {
    id: 'a', name: '', description: '', ability: 'str',
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
    taught.add(shapeOf(book.teaches));
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
    set.add(shapeOf(node.teaches));
    byDiscipline.set(node.stat, set);
  }

  for (const [discipline, effects] of byDiscipline) {
    const total = counts.get(discipline) ?? 0;
    if (total < 2) continue;
    assert.ok(effects.size > 1, `${discipline} taught the same thing ${total} times`);
  }
});
