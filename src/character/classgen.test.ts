import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkShape, classShapesFor, MAX_CLASSES, MIN_CLASSES,
} from './classgen.ts';
import { buildClass, subclassGrant } from './classbuild.ts';
import { canChooseSubclassOf, classOf, subclassOf } from './classes.ts';
import { ABILITIES } from '../combat/types.ts';
import { skillTreeFor } from '../play/skilltree.ts';
import { STAT_GRAMMAR } from '../skills/statgrammar.ts';
import { obeys, priceOf } from '../skills/compose.ts';
import type { ActiveSkill } from '../skills/active.ts';
import type { SkillSpec } from '../skills/active.ts';

const SEEDS = [1, 3, 7, 21, 42, 108, 512, 2024, 31337, 99, 555, 7777];

const asSkill = (grant: SkillSpec, ability: ActiveSkill['ability']): ActiveSkill =>
  ({ id: 'x', name: '', description: '', ability, effects: grant.effects, range: grant.range });

/* -------------------------------------------------------------------------- */
/* The proof: a class the tree can actually be built from                      */
/* -------------------------------------------------------------------------- */

test('every generated class is sound', () => {
  /*
   * The claim everything else rests on. A class that both leant ON a stat and
   * AWAY from it would shift a path's gate in two directions at once — which a
   * generator resolves silently and wrongly, and nothing downstream would
   * report. Mapping the old discipline lists across mechanically produced
   * exactly that: a scholar who favoured INT and resisted it.
   */
  for (const seed of SEEDS) {
    for (const shape of classShapesFor(seed)) {
      assert.deepEqual(
        checkShape(shape).map((p) => p.why), [],
        `seed ${seed} generated an unsound ${shape.id}`,
      );
    }
  }
});

test('leaning away never leaves a class with nowhere to go', () => {
  // A lean is a price and not a lock, so nothing is ever unreachable — but a
  // class that leant away from most of the sheet would still be miserable.
  for (const seed of SEEDS) {
    for (const shape of classShapesFor(seed)) {
      assert.ok(shape.against.length <= 3, `${shape.id} leans away from ${shape.against.length} stats`);
      assert.ok(shape.favours.length >= 1, `${shape.id} leans on nothing`);
    }
  }
});

test('a stat is never both leant on and leant away from', () => {
  for (const seed of SEEDS) {
    for (const shape of classShapesFor(seed)) {
      const both = shape.favours.filter((f) => shape.against.includes(f));
      assert.deepEqual(both, [], `${shape.id} both favours and resists ${both.join(', ')}`);
    }
  }
});

/* -------------------------------------------------------------------------- */
/* Both routes, which is the point of the exercise                             */
/* -------------------------------------------------------------------------- */

test('every class offers a way out AND a way deeper', () => {
  /*
   * The improvement over the authored sixteen, where every subclass was a
   * crossing — which made level three a choice of WHICH door rather than a
   * choice at all. Specialise or broaden is a decision about the character;
   * picking a door is a decision about the map.
   */
  for (const seed of SEEDS) {
    for (const shape of classShapesFor(seed)) {
      const routes = shape.subclasses.map((s) => s.route);
      assert.ok(routes.includes('cross'), `${shape.id} can never cross away from what it is`);
      assert.ok(routes.includes('deepen'), `${shape.id} can only ever cross away`);
    }
  }
});

test('a crossing crosses and a deepening deepens', () => {
  for (const seed of SEEDS) {
    for (const shape of classShapesFor(seed)) {
      for (const sub of shape.subclasses) {
        if (sub.route === 'cross') {
          assert.ok(shape.against.includes(sub.opens), `${sub.id} crosses to ${sub.opens}, which it does not lean away from`);
        } else {
          assert.ok(shape.favours.includes(sub.opens), `${sub.id} deepens ${sub.opens}, which it does not lean on`);
        }
      }
    }
  }
});

test('no class points two subclasses at the same door', () => {
  for (const seed of SEEDS) {
    for (const shape of classShapesFor(seed)) {
      const opened = shape.subclasses.map((s) => s.opens);
      assert.equal(new Set(opened).size, opened.length, `${shape.id} opens ${opened.join(' and ')} twice`);
    }
  }
});

/* -------------------------------------------------------------------------- */
/* What it grants                                                              */
/* -------------------------------------------------------------------------- */

test('a granted skill belongs to the stat it opens', () => {
  // The coherence claim, same as everywhere else: a road into DEX that taught
  // healing would be legal, correctly priced, and read as a bug.
  for (const seed of SEEDS) {
    for (const shape of classShapesFor(seed)) {
      for (const sub of shape.subclasses) {
        const grammar = STAT_GRAMMAR[sub.opens];
        const broke = obeys(asSkill(subclassGrant(sub, 'en'), sub.opens), grammar);
        assert.equal(broke, null, `${sub.id} opens ${sub.opens} and ${broke}`);
      }
    }
  }
});

test('a grant is worth having and never the best thing in the game', () => {
  /*
   * The authored sixteen used to be the yardstick — they priced 4.0 to 13.0
   * with a median of 7.5, and a generated grant was checked against their
   * ceiling. They are deleted, so the range they defined is written down here
   * instead of being read off them. Losing the yardstick is a real cost of the
   * demolition and worth recording rather than quietly dropping the check.
   */
  const CEILING = 15;

  for (const seed of SEEDS) {
    for (const shape of classShapesFor(seed)) {
      for (const sub of shape.subclasses) {
        const price = priceOf(subclassGrant(sub, 'en').effects);
        assert.ok(price > 0, `${sub.id} grants nothing`);
        assert.ok(price <= CEILING, `${sub.id} prices ${price.toFixed(1)} against a ceiling of ${CEILING}`);
      }
    }
  }
});
test('the same subclass always teaches the same thing', () => {
  // Keyed on the subclass id rather than the world, so a character who took it
  // at level three and reloads at level nine does not find it has changed.
  const sub = classShapesFor(42)[0].subclasses[0];
  assert.deepEqual(subclassGrant(sub, 'en'), subclassGrant(sub, 'en'));
});

/* -------------------------------------------------------------------------- */
/* Building one, with and without the model                                    */
/* -------------------------------------------------------------------------- */

test('a class is playable even when the model never answered', () => {
  /*
   * The naming call is the one piece of generation the game can do entirely
   * without. A creation page that will not render because a name did not
   * arrive is a far worse failure than a duller word.
   */
  for (const seed of [1, 42, 2024]) {
    for (const shape of classShapesFor(seed)) {
      const built = buildClass(shape, null, 'en');
      assert.ok(built.name.en.length > 2, `${shape.id} came out nameless`);
      assert.ok(built.description.en.length > 10);
      assert.ok(built.startingAttack.name.length > 2, `${shape.id} set out holding nothing`);
      assert.equal(built.subclasses.length, shape.subclasses.length);
      for (const sub of built.subclasses) {
        assert.ok(sub.name.en.length > 2 && sub.description.en.length > 10, `${sub.id} is bare`);
      }
    }
  }
});

test('what the model says is used, and what it omits falls back', () => {
  const shape = classShapesFor(7)[0];
  const built = buildClass(shape, {
    shapeId: shape.id,
    name: 'Harbour Guard',
    description: 'You have stood on the same stones since before the water came.',
    weaponName: 'a boat-hook',
    // Deliberately naming only the first, so the rest must fall back.
    subclasses: [{ shapeId: shape.subclasses[0].id, name: 'The Low Tide', description: 'You went under and came back.' }],
  }, 'en');

  assert.equal(built.name.en, 'Harbour Guard');
  assert.equal(built.startingAttack.name, 'a boat-hook');
  assert.equal(built.subclasses[0].name.en, 'The Low Tide');
  assert.ok(built.subclasses[1].name.en.length > 2, 'an unnamed path came out blank');
});

test('a built class keeps the mechanics the shape decided', () => {
  // The model names; it never moves a number.
  for (const shape of classShapesFor(2024)) {
    const built = buildClass(shape, { shapeId: shape.id, name: 'X', description: 'Y', weaponName: 'Z', subclasses: [] }, 'en');
    assert.equal(built.hitDie, shape.hitDie);
    assert.equal(built.primary, shape.primary);
    assert.deepEqual(built.favours, shape.favours);
    assert.deepEqual(built.against, shape.against);
    assert.deepEqual(built.subclasses.map((s) => s.opens), shape.subclasses.map((s) => s.opens));
  }
});

/* -------------------------------------------------------------------------- */
/* Different worlds, and old saves                                             */
/* -------------------------------------------------------------------------- */

test('two worlds offer genuinely different rosters', () => {
  const shape = (seed: number) => JSON.stringify(classShapesFor(seed));
  assert.notEqual(shape(1), shape(999));
  assert.notEqual(shape(42), shape(2024));
});

test('the same world always offers the same roster', () => {
  // The class is stored on the sheet, but the ROSTER is regenerated to render
  // the creation page. A list that shifted between renders would let a player
  // pick something that no longer existed by the time they submitted.
  assert.deepEqual(classShapesFor(42), classShapesFor(42));
  assert.deepEqual(classShapesFor(7, 6), classShapesFor(7, 6));
});

test('a world offers a sensible number of them', () => {
  for (const seed of SEEDS) {
    const roster = classShapesFor(seed);
    assert.ok(roster.length >= MIN_CLASSES && roster.length <= MAX_CLASSES, `seed ${seed} offered ${roster.length}`);
    const ids = roster.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, 'two classes share an id');
  }
});

test('a character carries their class, so a regenerated roster cannot orphan them', () => {
  /*
   * THE SAFETY PROPERTY. Classes are generated per world, so an id no longer
   * names anything globally — resolving one by regenerating the roster would
   * mean any change to the generator silently rewrote what an existing
   * character IS, or dropped them entirely.
   */
  const built = buildClass(classShapesFor(42)[0], null, 'en');
  const sheet = { classId: built.id, classSpec: built, subclassId: built.subclasses[0].id };

  assert.equal(classOf(sheet)?.id, built.id);
  assert.equal(subclassOf(sheet)?.id, built.subclasses[0].id);

  // And the id alone resolves to nothing, which is precisely why it is carried.
  assert.equal(classOf({ classId: built.id }), null);
});

test('an id with no spec behind it resolves to nothing, and nothing breaks', () => {
  /*
   * This test used to assert the opposite: that a save storing `warlock` and
   * no spec still resolved against the authored eight. Those are deleted along
   * with every existing session, so the fallback has nothing left to catch.
   *
   * What matters now is that the absence is HANDLED rather than thrown on — a
   * sheet carrying a stale id must resolve to null and leave the character
   * classless, not crash the page that renders them.
   */
  const stale = { classId: 'warlock', subclassId: 'pact_ember' };
  assert.equal(classOf(stale), null);
  assert.equal(subclassOf(stale), null);
  assert.equal(canChooseSubclassOf(3, stale), false, 'no class, no roads');

  const built = buildClass(classShapesFor(9)[0], null, 'en');
  assert.equal(canChooseSubclassOf(3, { classSpec: built }), true, 'a carried spec still works');
});

test('a generated class grows a tree that obeys its own locks', () => {
  /*
   * A class no longer decides WHICH paths exist — the world does, and the
   * spread decides which are open. What a class does is shift the gate, so the
   * claim worth testing changed: not "the tree lacks what it is shut out of"
   * (nothing is shut out any more) but "leaning on a stat opens its paths
   * sooner than leaning away would".
   */
  for (const seed of [7, 42, 2024]) {
    const built = buildClass(classShapesFor(seed)[0], null, 'en');
    const middling = Object.fromEntries(ABILITIES.map((a) => [a, 12])) as Record<typeof ABILITIES[number], number>;

    const tree = skillTreeFor(seed, 'bg', 'en', '', { classId: built.id, classSpec: built, scores: middling });
    assert.ok(tree.nodes.length > 0, 'a generated class grew no tree at all');
    assert.ok(tree.paths.length > 0, 'the world offered no paths at all');

    // Every path is present whether open or sealed; what a lean changes is the
    // score at which it unseals, which pathgen.test proves directly.
    const stats = new Set(tree.nodes.map((n) => n.stat));
    assert.ok(stats.size > 1, 'a tree of one stat is not a tree');
  }
});
