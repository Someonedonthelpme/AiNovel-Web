import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkShape, classShapesFor, MAX_CLASSES, MAX_FORBIDDEN, MIN_CLASSES, MIN_FORBIDDEN,
} from './classgen.ts';
import { buildClass, subclassGrant } from './classbuild.ts';
import { canChooseSubclassOf, classOf, CLASSES, subclassOf } from './classes.ts';
import { ARCHETYPES } from '../play/archetypes.ts';
import { MAX_DISCIPLINES, skillTreeFor } from '../play/skilltree.ts';
import { priceSkill } from '../skills/compose.ts';
import type { ActiveSkill } from '../skills/active.ts';

const SEEDS = [1, 3, 7, 21, 42, 108, 512, 2024, 31337, 99, 555, 7777];

const asSkill = (grant: { effect: unknown; range: number; usesPerRest: number }): ActiveSkill =>
  ({ id: 'x', name: '', description: '', kind: 'combat', ability: 'str', ...grant }) as ActiveSkill;

/* -------------------------------------------------------------------------- */
/* The proof: a class the tree can actually be built from                      */
/* -------------------------------------------------------------------------- */

test('every generated class is sound', () => {
  /*
   * The claim everything else rests on, and it earns its keep the way
   * `admissible` does for Signets. A class whose forbidden list overlapped its
   * core would generate a tree with a discipline that is both always and never
   * present, and nothing downstream would report it — the player would simply
   * have a tree that made no sense, differently in every world.
   */
  for (const seed of SEEDS) {
    for (const shape of classShapesFor(seed)) {
      assert.deepEqual(
        checkShape(shape, MAX_DISCIPLINES).map((p) => p.why), [],
        `seed ${seed} generated an unsound ${shape.id}`,
      );
    }
  }
});

test('shutting a class out never starves its tree', () => {
  // `disciplinesFor` draws a subset of up to MAX_DISCIPLINES. Forbid too much
  // and there is nothing left to draw from.
  for (const seed of SEEDS) {
    for (const shape of classShapesFor(seed)) {
      const left = ARCHETYPES.length - shape.forbidden.length;
      assert.ok(left >= MAX_DISCIPLINES, `${shape.id} leaves ${left}`);
      assert.ok(shape.forbidden.length >= MIN_FORBIDDEN && shape.forbidden.length <= MAX_FORBIDDEN);
    }
  }
});

test('core, affinity and forbidden never overlap', () => {
  for (const seed of SEEDS) {
    for (const shape of classShapesFor(seed)) {
      const all = [...shape.core, ...shape.affinity, ...shape.forbidden];
      assert.equal(new Set(all).size, all.length, `${shape.id} lists a discipline twice: ${all.join(', ')}`);
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
      assert.ok(routes.includes('cross'), `${shape.id} can never leave its own disciplines`);
      assert.ok(routes.includes('deepen'), `${shape.id} can only ever leave them`);
    }
  }
});

test('a crossing crosses and a deepening deepens', () => {
  for (const seed of SEEDS) {
    for (const shape of classShapesFor(seed)) {
      for (const sub of shape.subclasses) {
        if (sub.route === 'cross') {
          assert.ok(shape.forbidden.includes(sub.opens), `${sub.id} crosses to ${sub.opens}, never shut out of`);
        } else {
          assert.ok(
            shape.core.includes(sub.opens) || shape.affinity.includes(sub.opens),
            `${sub.id} deepens ${sub.opens}, which it is not`,
          );
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

test('a granted skill belongs to the discipline it opens', () => {
  // The coherence claim, same as everywhere else: a door into `bow` that
  // taught healing would be legal, correctly priced, and read as a bug.
  for (const seed of SEEDS) {
    for (const shape of classShapesFor(seed)) {
      for (const sub of shape.subclasses) {
        const archetype = ARCHETYPES.find((a) => a.id === sub.opens)!;
        const grant = subclassGrant(sub, 'en');
        assert.ok(
          archetype.draws.payloads.includes(grant.effect.kind),
          `${sub.id} opens ${sub.opens} and teaches ${grant.effect.kind}`,
        );
        assert.ok(grant.range <= archetype.draws.maxRange, `${sub.id} reaches ${grant.range}`);
      }
    }
  }
});

test('grants land in the same country as the authored sixteen', () => {
  /*
   * Measured, not asserted. The shipped sixteen price 4.0 to 13.0 with a
   * median of 7.5; a generated grant that outclassed all of them would make
   * the roster strictly better than the game it replaced.
   */
  const authored = CLASSES.flatMap((c) => c.subclasses).map((s) => priceSkill(asSkill(s.grants)));
  const ceiling = Math.max(...authored);

  for (const seed of SEEDS) {
    for (const shape of classShapesFor(seed)) {
      for (const sub of shape.subclasses) {
        const price = priceSkill(asSkill(subclassGrant(sub, 'en')));
        assert.ok(price <= ceiling + 2, `${sub.id} prices ${price.toFixed(1)} against a ceiling of ${ceiling}`);
        assert.ok(price > 0, `${sub.id} grants nothing`);
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
    assert.deepEqual(built.core, shape.core);
    assert.deepEqual(built.forbidden, shape.forbidden);
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

test('a session made before generated classes still resolves', () => {
  // Every save stores `fighter` or `warlock` and no spec. Those words still
  // mean what they always did.
  const old = { classId: 'warlock', subclassId: 'pact_ember' };
  assert.equal(classOf(old)?.id, 'warlock');
  assert.equal(subclassOf(old)?.id, 'pact_ember');
  assert.equal(canChooseSubclassOf(3, { classId: 'warlock' }), true);
  assert.equal(canChooseSubclassOf(3, old), false, 'they have already chosen');
  assert.equal(canChooseSubclassOf(2, { classId: 'warlock' }), false, 'not until level three');
});

test('a generated class grows a tree that obeys its own locks', () => {
  for (const seed of [7, 42, 2024]) {
    const built = buildClass(classShapesFor(seed)[0], null, 'en');
    const tree = skillTreeFor(seed, 'bg', 'en', '', { classId: built.id, classSpec: built });

    assert.ok(tree.nodes.length > 0, 'a generated class grew no tree at all');
    assert.equal(
      tree.nodes.some((n) => built.forbidden.includes(n.archetype)), false,
      'the base tree generated a discipline the class is shut out of',
    );
    assert.ok(
      tree.nodes.some((n) => built.core.includes(n.archetype)),
      'the tree holds none of what the class is built on',
    );
  }
});
