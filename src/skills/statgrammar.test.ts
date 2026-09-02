import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../engine/roll.ts';
import { ABILITIES, CONDITIONS } from '../combat/types.ts';
import { composeSkill, PAYLOADS, priceSkill } from './compose.ts';
import { budgetForFloor } from './book.ts';
import { grammarFor, STAT_GRAMMAR } from './statgrammar.ts';

const SEEDS = [1, 7, 21, 55, 108, 512, 2024];
const FLOORS = [1, 4, 9, 15, 20];

const compose = (stat: (typeof ABILITIES)[number], budget: number, seed: number, kind: 'combat' | 'utility' = 'combat') =>
  composeSkill(mulberry32(seed), {
    id: `s${seed}`, name: '', description: '', kind, ability: stat, grammar: grammarFor(stat), budget,
  });

/* -------------------------------------------------------------------------- */
/* The grammar is the hard constraint, and it moved here from disciplines      */
/* -------------------------------------------------------------------------- */

test('a skill never does something its stat cannot', () => {
  /*
   * The job inherited from discipline grammar, and the reason this file
   * exists. Coherence is the hard half of generation, not balance: a composer
   * with a budget and no grammar cheerfully produces a bow that heals —
   * legal, correctly priced, and reading as a bug.
   */
  for (const stat of ABILITIES) {
    const grammar = grammarFor(stat);
    for (const seed of SEEDS) {
      for (const floor of FLOORS) {
        const skill = compose(stat, budgetForFloor(floor), seed);
        assert.ok(grammar.payloads.includes(skill.effect.kind), `${stat} produced ${skill.effect.kind}`);
        assert.ok(skill.range <= grammar.maxRange, `${stat} reached ${skill.range}`);
      }
    }
  }
});

test('a skill only inflicts what its stat is allowed to inflict', () => {
  for (const stat of ABILITIES) {
    const grammar = grammarFor(stat);
    for (const seed of SEEDS) {
      const effect = compose(stat, budgetForFloor(12), seed).effect;
      if (effect.kind === 'hinder' || effect.kind === 'hex' || effect.kind === 'rally') {
        assert.ok(grammar.conditions.includes(effect.condition), `${stat} inflicted ${effect.condition}`);
      }
    }
  }
});

test('strength never reaches and constitution never touches anybody', () => {
  /*
   * The two that would read worst, named so the grammar cannot be loosened
   * without somebody noticing. STR is force applied directly — you have to be
   * able to reach it. CON is the mind holding on, turned inward by design: it
   * keeps YOU going and never reaches out.
   */
  assert.equal(STAT_GRAMMAR.str.maxRange, 1);
  assert.equal(STAT_GRAMMAR.con.maxRange, 0);
  assert.equal(STAT_GRAMMAR.con.payloads.includes('strike'), false, 'CON should not be able to hit anyone');
});

/* -------------------------------------------------------------------------- */
/* The thing disciplines could not express                                     */
/* -------------------------------------------------------------------------- */

test('the same payload from a different stat is a different thing', () => {
  /*
   * The whole argument for stats over disciplines. `bow` owned strike and
   * `guard` owned mend and that was the end of it. Four stats can hinder now,
   * and each one hinders differently — pinning, crippling, misdirecting, or
   * getting under somebody's skin.
   */
  const hinders = ABILITIES.filter((s) => STAT_GRAMMAR[s].payloads.includes('hinder'));
  assert.ok(hinders.length >= 4, `only ${hinders.length} stats can hinder`);

  const shapes = new Set(
    hinders.map((s) => `${STAT_GRAMMAR[s].conditions.slice().sort().join('+')}@${STAT_GRAMMAR[s].maxRange}`),
  );
  assert.equal(shapes.size, hinders.length, 'two stats hinder identically, so one of them is redundant');
});

test('no two stats have the same grammar', () => {
  // A duplicate is a stat that adds an axis to the sheet and nothing to a build.
  const shapes = ABILITIES.map((s) =>
    `${STAT_GRAMMAR[s].payloads.slice().sort().join('+')}|${STAT_GRAMMAR[s].conditions.slice().sort().join('+')}|${STAT_GRAMMAR[s].maxRange}`);
  assert.equal(new Set(shapes).size, shapes.length, 'two stats build exactly the same skills');
});

/* -------------------------------------------------------------------------- */
/* Every stat is live, and none of them does everything                        */
/* -------------------------------------------------------------------------- */

test('every stat can build something', () => {
  // A stat with no payloads is a dead axis: points into it could never buy a
  // skill, and the tree would have nothing to grow on it.
  for (const stat of ABILITIES) {
    assert.ok(STAT_GRAMMAR[stat].payloads.length > 0, `${stat} can build nothing`);
  }
});

test('no stat can build everything', () => {
  // One that could would make the others decorative, and the grammar would
  // stop constraining anything at all.
  for (const stat of ABILITIES) {
    assert.ok(
      STAT_GRAMMAR[stat].payloads.length < PAYLOADS.length,
      `${stat} can produce every payload there is`,
    );
  }
});

test('every payload is reachable by some stat', () => {
  // A payload nothing can produce is dead code in the composer and a shape of
  // skill the game claims to have and never makes.
  for (const payload of PAYLOADS) {
    assert.ok(
      ABILITIES.some((s) => STAT_GRAMMAR[s].payloads.includes(payload)),
      `nothing can produce "${payload}"`,
    );
  }
});

test('every condition a grammar names is one the engine implements', () => {
  /*
   * The same class of bug as a trait gating on a counter nothing writes: a
   * condition the engine does not know would be inflicted and then do nothing,
   * silently, forever. `frightened` was added for CHA precisely because there
   * was no existing condition that meant "rattled".
   */
  for (const stat of ABILITIES) {
    for (const condition of STAT_GRAMMAR[stat].conditions) {
      assert.ok(CONDITIONS.includes(condition), `${stat} inflicts "${condition}", which does not exist`);
    }
  }
});

/* -------------------------------------------------------------------------- */
/* Balance survived the move                                                   */
/* -------------------------------------------------------------------------- */

test('nothing is bought for more than it was given', () => {
  for (const stat of ABILITIES) {
    for (const seed of SEEDS) {
      for (const floor of FLOORS) {
        const budget = budgetForFloor(floor);
        const skill = compose(stat, budget, seed);
        // One use of something dear may exceed the budget — that is the
        // "single formidable use" shape. Anything repeatable must not.
        if (skill.usesPerRest > 1) {
          assert.ok(priceSkill(skill) <= budget, `${stat} floor ${floor}: ${priceSkill(skill).toFixed(1)} of ${budget.toFixed(1)}`);
        }
      }
    }
  }
});

test('a rich budget is spent, not left on the table', () => {
  // The measured regression that lifted the floor from 0.51 when disciplines
  // had the grammar. It has to survive the move, or deep books get worse.
  for (const stat of ABILITIES) {
    const budget = budgetForFloor(20);
    let spent = 0;
    for (const seed of SEEDS) spent += priceSkill(compose(stat, budget, seed));
    const ratio = spent / SEEDS.length / budget;
    assert.ok(ratio > 0.6, `${stat} spends only ${(ratio * 100).toFixed(0)}% of a deep budget`);
  }
});

test('deeper sources still make better skills', () => {
  for (const stat of ABILITIES) {
    const shallow = priceSkill(compose(stat, budgetForFloor(1), 7));
    const deep = priceSkill(compose(stat, budgetForFloor(20), 7));
    assert.ok(deep > shallow, `${stat} learns nothing from depth`);
  }
});

test('constitution mends only itself; vitality reaches somebody else', () => {
  /*
   * Where the CON/VIT line actually falls, and it took a measurement to find.
   * Stripping `mend` off CON read well and played badly: `rally` and `edge`
   * are both flat-priced, so CON spent 30% of a deep budget against 64-87%
   * everywhere else, and the deep nodes of a CON path would have been
   * worthless.
   *
   * The line is REACH. CON is pushing through something that should have
   * dropped you — your own second wind. Reaching over to patch somebody else
   * up is a body's work.
   */
  assert.ok(STAT_GRAMMAR.con.payloads.includes('mend'), 'CON cannot push through anything');
  assert.equal(STAT_GRAMMAR.con.maxRange, 0, 'CON reached somebody, which is VIT territory');
  assert.ok(STAT_GRAMMAR.vit.maxRange >= 1, 'VIT cannot reach anybody to patch them up');
});

test('constitution still grants no maximum hit points', () => {
  // The claim that survived the correction. Recovering some of your hit points
  // and HAVING more of them are different things, and only the second was
  // VIT's to keep. Proved in sheet.test.ts against `maxHpFor`; named here so
  // the grammar change above is not mistaken for undoing the split.
  assert.ok(STAT_GRAMMAR.vit.payloads.includes('mend'), 'VIT is the body and must be able to mend');
});

test('a stat that rallies has something to shrug off', () => {
  // `rally` clears a condition, so a grammar offering it with no conditions
  // would compose a skill that removes nothing.
  for (const stat of ABILITIES) {
    const g = STAT_GRAMMAR[stat];
    if (g.payloads.includes('rally') || g.payloads.includes('hinder') || g.payloads.includes('hex')) {
      assert.ok(g.conditions.length > 0, `${stat} can rally or hinder but names no condition`);
    }
  }
});
