import test from 'node:test';
import assert from 'node:assert/strict';
import { canChooseSubclassOf, subclassSkill, SUBCLASS_LEVEL } from './classes.ts';
import { classShapesFor } from './classgen.ts';
import { buildClass } from './classbuild.ts';
import { ABILITIES } from '../combat/types.ts';
import { skillTreeFor } from '../play/skilltree.ts';
import { grownBy } from '../play/fixtures.ts';
import { applySheetAction } from '../play/sheetaction.ts';
import { activeSkills } from '../session/sheet.ts';
import { playState } from '../play/fixtures.ts';
import type { PlayState } from '../play/state.ts';

const SEEDS = [1, 7, 21, 55, 108, 512, 2024];

/*
 * A class to test the subclass MECHANICS against.
 *
 * There is no authored roster any more, so these tests build one the way the
 * game does. What is being proved here is the machinery — when a subclass may
 * be taken, what it grows, that it pays out in stages — none of which depends
 * on WHICH class it is. The generated roster's own soundness is classgen's job.
 */
const someClass = (seed = 9) => buildClass(classShapesFor(seed)[0], null, 'en');

const withClass = (state: PlayState, classId: string, over = {}): PlayState => ({
  ...state,
  sheet: { ...state.sheet, classId, ...over },
});

/* -------------------------------------------------------------------------- */
/* The hard lock                                                               */
/* -------------------------------------------------------------------------- */

test('one world offers one set of paths, and a spread decides what is open', () => {
  /*
   * A REAL CHANGE OF CLAIM, recorded rather than quietly dropped. Two classes
   * used to get different trees because a class DECIDED which disciplines were
   * printed. The world decides now, and a spread decides which of them are
   * open — so the same tower shows the same paths to everybody, and what
   * differs is how much of it you can reach.
   *
   * That is the point of the move: what you cannot reach is a goal you can
   * see, rather than something that was never printed for you.
   */
  const brawn = Object.fromEntries(ABILITIES.map((a) => [a, 8])) as Record<typeof ABILITIES[number], number>;
  const strong = { ...brawn, str: 15, vit: 15 };
  const clever = { ...brawn, int: 15, wis: 15 };

  const a = skillTreeFor(21, 'bg', 'en', '', { scores: strong });
  const b = skillTreeFor(21, 'bg', 'en', '', { scores: clever });

  assert.deepEqual(a.paths, b.paths, 'the world offers the same paths to both');
  assert.notEqual(a.home, b.home, 'but they open next to different ones');

  const sealed = (t: typeof a) => t.nodes.filter((n) => n.requires?.some((r) => r.kind === 'ability')).length;
  assert.notEqual(sealed(a), sealed(b), 'and different amounts of it are sealed to them');
});

test('choosing a subclass grows a branch that was not there before', () => {
  // The point of the whole feature: a choice that visibly reshapes the tree.
  const held = someClass();
  const sub = held.subclasses[0];

  const before = skillTreeFor(9, 'bg', 'en', '', { classSpec: held, level: 3 });
  const after = skillTreeFor(9, 'bg', 'en', '', { classSpec: held, subclassId: sub.id, level: 3 });

  const grown = after.nodes.filter((n) => n.grafted?.kind === 'subclass');
  assert.equal(before.nodes.some((n) => n.grafted?.kind === 'subclass'), false);
  assert.ok(grown.length > 0, 'the subclass should have opened something');
  assert.ok(grown.every((n) => n.stat === sub.opens), `the branch should be ${sub.opens}`);
});

test('a subclass pays out again as the character grows', () => {
  // Three stages rather than one parcel: a permanent choice should buy an arc.
  const held = someClass();
  const sub = held.subclasses[0];
  const at = (level: number) =>
    skillTreeFor(9, 'bg', 'en', '', { classSpec: held, subclassId: sub.id, level })
      .nodes.filter((n) => n.grafted?.kind === 'subclass').length;

  assert.equal(at(2), 0, 'nothing before the first stage');
  assert.ok(at(3) > 0);
  assert.ok(at(6) > at(3), 'the second stage deepens it');
  assert.ok(at(10) > at(6), 'and so does the third');
});

test('the first subclass stage is a combination, not a walk', () => {
  // The crossing only opens once several parts of your own tree line up, so an
  // Eldritch Knight has to have genuinely walked the sword first.
  const held = someClass();
  const tree = skillTreeFor(9, 'bg', 'en', '', {
    classSpec: held, subclassId: held.subclasses[0].id, level: 3,
  });
  const head = tree.nodes.find((n) => n.grafted?.kind === 'subclass' && n.requiresAll?.length);
  assert.ok(head, 'the first stage should need more than one held node');
  assert.ok((head!.requiresAll ?? []).length >= 2);
});

test('a subclass branch is open, not waiting on a tally', () => {
  // It was earned by taking the subclass. Gating it again would mean choosing
  // one and seeing nothing happen.
  const held = someClass();
  const tree = skillTreeFor(9, 'bg', 'en', '', { classSpec: held, subclassId: held.subclasses[0].id, level: 3 });
  const branch = tree.nodes.filter((n) => n.grafted?.kind === 'subclass');
  assert.ok(branch.length > 0);
  assert.ok(branch.every((n) => !n.requires?.length), 'no requirement left on it');
});

test('nothing is orphaned once a subclass island is attached', () => {
  // The chaotic generator has to keep its promise: a node nothing connects to
  // is a node nobody can ever buy.
  for (const seed of SEEDS) {
    const held = someClass(seed);
    const who = { classSpec: held, subclassId: held.subclasses[0].id };
    const grows = grownBy(seed, who, 2);
    const tree = skillTreeFor(seed, 'bg', 'en', '', {
      ...who, level: 10, traits: grows.traits, signets: grows.signets.slice(0, 1),
    });
    const byId = new Map(tree.nodes.map((n) => [n.id, n]));
    // Free-standing branches are unreachable from the origin BY DESIGN — that
    // is what `parallel` means — so each is a root of its own.
    const roots = [tree.start, ...tree.nodes.filter((n) => n.freeStanding).map((n) => n.id)];
    const seen = new Set<string>(roots);
    const queue = [...roots];

    while (queue.length) {
      const here = byId.get(queue.shift()!);
      for (const next of here?.connections ?? []) {
        if (!seen.has(next) && byId.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    assert.equal(seen.size, tree.nodes.length, `seed ${seed}: ${tree.nodes.length - seen.size} orphaned`);
  }
});

/* -------------------------------------------------------------------------- */
/* Taking one                                                                  */
/* -------------------------------------------------------------------------- */

test('a subclass cannot be taken early, twice, or from another class', () => {
  const held = someClass();
  const other = someClass(21);
  const mine = held.subclasses[0];
  const base = playState();
  const withMe = (over = {}): PlayState =>
    ({ ...base, sheet: { ...base.sheet, classId: held.id, classSpec: held, ...over } });

  assert.match(applySheetAction(withMe(), { type: 'chooseSubclass', id: mine.id }).error ?? '', /level/);

  const ready = withMe({ level: SUBCLASS_LEVEL });
  assert.match(
    applySheetAction(ready, { type: 'chooseSubclass', id: other.subclasses[0].id }).error ?? '',
    /no such path/,
    'a road from another class is not on offer',
  );

  const taken = applySheetAction(ready, { type: 'chooseSubclass', id: mine.id });
  assert.equal(taken.error, null);
  assert.match(
    applySheetAction(taken.state, { type: 'chooseSubclass', id: held.subclasses[1].id }).error ?? '',
    /already chosen/,
    'and only one may ever be taken',
  );
});
test('taking a subclass grants its signature skill', () => {
  const held = someClass();
  const sub = held.subclasses[0];
  const base = playState();
  const ready: PlayState = {
    ...base,
    sheet: { ...base.sheet, classId: held.id, classSpec: held, level: SUBCLASS_LEVEL },
  };
  const taken = applySheetAction(ready, { type: 'chooseSubclass', id: sub.id });

  assert.equal(taken.error, null);
  assert.equal(taken.state.sheet.subclassId, sub.id);

  const granted = subclassSkill(sub, 'th');
  assert.ok(
    activeSkills(taken.state.sheet).some((s) => s.id === granted.id),
    'the signature skill should be usable straight away',
  );
});

test('the offer only stands when it can actually be taken', () => {
  const held = someClass();
  const sub = held.subclasses[0];

  assert.equal(canChooseSubclassOf(1, { classSpec: held }), false, 'not before the level');
  assert.equal(canChooseSubclassOf(SUBCLASS_LEVEL, { classSpec: held }), true);
  assert.equal(canChooseSubclassOf(9, { classSpec: held, subclassId: sub.id }), false, 'already chosen');
  assert.equal(canChooseSubclassOf(9, {}), false, 'no class, no roads');
});

/* -------------------------------------------------------------------------- */
/* Not breaking what came before                                               */
/* -------------------------------------------------------------------------- */

test('a tree still builds for a character with no class at all', () => {
  // The class is optional and always was — a sheet without one gets the
  // world's paths ungated, which is what the creation-page preview relies on.
  const bare = skillTreeFor(21, 'harbour_guard', 'en', 'Harbour Guard');
  const same = skillTreeFor(21, 'harbour_guard', 'en', 'Harbour Guard', {});

  assert.deepEqual(bare.nodes, same.nodes);
  assert.ok(bare.nodes.length > 0, 'no class should still mean a tree');
  assert.ok(bare.paths.length > 0);
});
test('the same class and subclass always give the same tree', () => {
  const held = someClass();
  const opts = { classSpec: held, subclassId: held.subclasses[0].id, level: 10 };
  const a = skillTreeFor(4, 'bg', 'en', '', opts);
  const b = skillTreeFor(4, 'bg', 'en', '', opts);
  assert.deepEqual(a.nodes, b.nodes);
  assert.deepEqual(a.paths, b.paths);
});

test('every generated class is coherent enough to build a character from', () => {
  for (const seed of SEEDS) {
    for (const shape of classShapesFor(seed)) {
      const held = buildClass(shape, null, 'en');
      assert.ok([6, 8, 10, 12].includes(held.hitDie), `${held.id} has a strange die`);
      assert.ok(held.startingAttack.damage.sides > 0, `${held.id} cannot hit anything`);
      assert.ok(held.name.en.trim() && held.description.en.trim(), `${held.id} is unnamed`);
    }
  }
});

test('a subclass goes where its route says it goes', () => {
  /*
   * Crossings were "usually" rather than always in the authored roster:
   * twelve of sixteen opened somewhere the class could already reach. Enforced
   * per route now, against the generated classes that replaced them.
   */
  for (const seed of SEEDS) {
    for (const shape of classShapesFor(seed)) {
      const held = buildClass(shape, null, 'en');
      for (const sub of held.subclasses) {
        if (sub.route === 'cross') {
          assert.ok((held.against ?? []).includes(sub.opens),
            `${held.id}/${sub.id} crosses to ${sub.opens}, which it does not lean away from`);
        } else {
          assert.ok((held.favours ?? []).includes(sub.opens),
            `${held.id}/${sub.id} deepens ${sub.opens}, which it does not lean on`);
        }
      }
    }
  }
});
test('a class does not point both its subclasses at the same road', () => {
  // Two roads into one stat would make the choice at level three a choice of
  // flavour text.
  for (const seed of SEEDS) {
    for (const shape of classShapesFor(seed)) {
      const opened = shape.subclasses.map((sub) => sub.opens);
      assert.equal(new Set(opened).size, opened.length, `${shape.id} opens ${opened.join(' and ')}`);
    }
  }
});

