import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMERGENT_BRANCH_CAP, EMERGENT_PREFIX, emergentTraitsFor, isEmergent,
} from './emergent.ts';
import { awardTraits, conditionMet, progressOf, SHAPES } from './traits.ts';
import type { TraitContext } from './traits.ts';
import { traitsFor } from './traitbook.ts';
import { skillTreeFor } from './skilltree.ts';
import { playState } from './fixtures.ts';
import { traitsViewOf } from '../server/game.ts';
import type { Counters } from '../character/persona.ts';

const SEEDS = [1, 3, 7, 21, 42, 108, 512, 2024, 31337];

const ctxWith = (counters: Counters, level = 5): TraitContext => {
  const state = playState();
  const sheet = { ...state.sheet, level, counters, traits: [] as string[] };
  return { sheet, inventory: state.pc.inventory, counters, personality: state.sheet.personality };
};

/* -------------------------------------------------------------------------- */
/* Shapes are relations, not thresholds                                        */
/* -------------------------------------------------------------------------- */

test('a shape needs a floor as well as a ratio', () => {
  /*
   * The thing that separates a recognition from noise. Two kills and no
   * conversations satisfies "killed more than you spoke to" arithmetically,
   * and it describes a Tuesday rather than a person. Every shape carries a
   * floor for exactly this reason, so an empty run recognises nothing.
   */
  const fresh = ctxWith({});
  for (const shape of SHAPES) {
    assert.equal(
      shape.holds((c) => fresh.counters[c] ?? 0, 1), false,
      `${shape.id} fires on a character who has done nothing`,
    );
  }
});

test('the shape it is named for is the shape it recognises', () => {
  const unspeaking = ctxWith({ kills: 30, people_met: 2 });
  const talked = ctxWith({ kills: 30, people_met: 40 });

  const trait = emergentTraitsFor(42).find((t) => t.id === `${EMERGENT_PREFIX}unspeaking`)!;
  assert.equal(conditionMet(trait.requires[0], unspeaking), true);
  assert.equal(conditionMet(trait.requires[0], talked), false);
});

test('an unknown shape is false rather than a crash', () => {
  // A save written before a shape existed must still fold. A trait nobody can
  // earn is better than a session that will not load.
  assert.equal(conditionMet({ kind: 'shape', shape: 'no_such_thing' }, ctxWith({ kills: 99 })), false);
});

/* -------------------------------------------------------------------------- */
/* They arrive unannounced                                                     */
/* -------------------------------------------------------------------------- */

test('a shape shows no progress, on purpose', () => {
  /*
   * The whole distinction, defended as a test. The moment "you have killed
   * more than you have spoken to" appears in the panel as 18/24, it stops
   * being a recognition of how somebody played and becomes a target they are
   * aiming at — and the aiming is precisely what it claims they did not do.
   */
  const trait = emergentTraitsFor(7)[0];
  const shown = progressOf(trait, ctxWith({ kills: 20, people_met: 1 }));
  assert.equal(shown.length, 1);
  assert.equal(shown[0].label, '', 'a shape must not be given a number to chase');
});

test('a recognition grants a line and never a score', () => {
  // A trait that handed out +1 str would become worth playing toward, which is
  // the one thing an emergent trait must not be.
  for (const seed of SEEDS) {
    for (const trait of emergentTraitsFor(seed)) {
      assert.equal(trait.grants?.ability, undefined, `${trait.id} pays a score`);
      assert.ok(trait.grants?.note, `${trait.id} says nothing`);
    }
  }
});

test('it is minted by the fold, the moment the shape becomes true', () => {
  const catalogue = traitsFor(42, { language: 'en' });
  const state = playState();

  const before = awardTraits(catalogue, { ...state.sheet, traits: [], counters: { kills: 4 } }, state.pc.inventory);
  assert.equal(before.earned.filter((t) => isEmergent(t.id)).length, 0);

  const after = awardTraits(
    catalogue,
    { ...state.sheet, traits: [], counters: { kills: 30, people_met: 2 } },
    state.pc.inventory,
  );
  assert.ok(
    after.earned.some((t) => t.id === `${EMERGENT_PREFIX}unspeaking`),
    'killing thirty things and speaking to two went unnoticed',
  );
});

/* -------------------------------------------------------------------------- */
/* The cap, which is the one real risk                                         */
/* -------------------------------------------------------------------------- */

test('a run that triggers every shape still grows only a few branches', () => {
  /*
   * Declared sources are bounded — a world offers a dozen traits, a character
   * holds a handful of Signets, a class has three subclass stages. Emergent
   * ones are not: a long run drives every counter, and every shape that came
   * true would grow another branch. Without this the tree sprawls into noise
   * and a legible web stops being legible.
   */
  const every = SHAPES.map((s) => `${EMERGENT_PREFIX}${s.id}`);

  for (const seed of SEEDS) {
    const capped = skillTreeFor(seed, 'bg', 'en', '', { classId: 'ranger', traits: every });
    const grown = new Set(
      capped.nodes.filter((n) => n.grafted?.kind === 'trait' && isEmergent(n.grafted.id))
        .map((n) => n.grafted!.id),
    );
    assert.ok(
      grown.size <= EMERGENT_BRANCH_CAP,
      `seed ${seed} grew ${grown.size} emergent branches from ${every.length} recognitions`,
    );
  }
});

test('the cap takes the first few earned, not the first few alphabetically', () => {
  /*
   * Earn order, because a recognition that arrived on turn ten deserves the
   * branch more than one that arrived on turn two hundred — and because the
   * alternative silently depends on how the ids happen to sort.
   */
  const ordered = ['unbloodied', 'sleepless', 'headlong', 'stubborn'].map((s) => `${EMERGENT_PREFIX}${s}`);
  const grownIn = (traits: string[]) => new Set(
    skillTreeFor(21, 'bg', 'en', '', { classId: 'ranger', traits }).nodes
      .filter((n) => n.grafted?.kind === 'trait' && isEmergent(n.grafted.id))
      .map((n) => n.grafted!.id),
  );

  const first = grownIn(ordered);
  const reversed = grownIn([...ordered].reverse());
  assert.notDeepEqual([...first].sort(), [...reversed].sort(), 'the order they arrived made no difference');
});

test('a capped recognition still gives its line', () => {
  // Only the BRANCH is capped. Being noticed is not rationed.
  const catalogue = traitsFor(42, { language: 'en' });
  for (const shape of SHAPES) {
    const trait = catalogue.find((t) => t.id === `${EMERGENT_PREFIX}${shape.id}`);
    assert.ok(trait, `${shape.id} is not in the catalogue at all`);
    assert.ok(trait!.grants?.note, `${shape.id} would be noticed silently`);
  }
});

/* -------------------------------------------------------------------------- */
/* Named per world, and stable within one                                      */
/* -------------------------------------------------------------------------- */

test('two worlds give the same shape different words', () => {
  const names = (seed: number) => emergentTraitsFor(seed).map((t) => t.name).join('|');
  assert.notEqual(names(1), names(999));
  assert.notEqual(names(42), names(2024));
});

test('one world always gives it the same words', () => {
  // Non-negotiable: these are folded, so a name that drifted between loads
  // would rewrite what a character was called for something they had done.
  assert.deepEqual(emergentTraitsFor(42), emergentTraitsFor(42));
  assert.deepEqual(emergentTraitsFor(7, 'th'), emergentTraitsFor(7, 'th'));
});

test('every shape is dressed, named and described', () => {
  for (const seed of SEEDS) {
    const traits = emergentTraitsFor(seed);
    assert.equal(traits.length, SHAPES.length, 'a shape went undressed');
    for (const trait of traits) {
      assert.match(trait.name, /^The [A-Z]/, `got ${trait.name}`);
      assert.ok(trait.description.length > 20, `${trait.id} says nothing`);
      assert.ok(trait.opens, `${trait.id} grows nothing, so the cap governs nothing`);
    }
    const names = traits.map((t) => t.name);
    assert.equal(new Set(names).size, names.length, `seed ${seed} reused a name`);
  }
});

test('Thai recognitions are Thai', () => {
  for (const trait of emergentTraitsFor(42, 'th')) {
    assert.match(trait.name, /[฀-๿]/, `got ${trait.name}`);
    assert.match(trait.description, /[฀-๿]/);
  }
});

test('the panel does not show a recognition before it is true', () => {
  /*
   * The leak this design would have shipped with. Every trait in the
   * catalogue reached the panel, so all nine recognitions sat there unearned,
   * each describing in full the thing it claims you were not aiming at.
   *
   * Held ones stay — being told what you have become is the entire payoff.
   */
  const state = playState();
  const fresh = { ...state, sheet: { ...state.sheet, traits: [] as string[] } };
  assert.equal(
    traitsViewOf(fresh).filter((t) => isEmergent(t.id)).length, 0,
    'an unearned recognition was advertised as a goal',
  );

  const noticed = `${EMERGENT_PREFIX}unspeaking`;
  const after = { ...state, sheet: { ...state.sheet, traits: [noticed] } };
  assert.ok(
    traitsViewOf(after).some((t) => t.id === noticed),
    'a recognition already earned was hidden from the person who earned it',
  );
});
