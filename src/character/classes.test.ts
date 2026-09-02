import test from 'node:test';
import assert from 'node:assert/strict';
import { canChooseSubclass, classById, CLASSES, subclassById, subclassSkill, SUBCLASS_LEVEL } from './classes.ts';
import { ARCHETYPES } from '../play/archetypes.ts';
import { skillTreeFor } from '../play/skilltree.ts';
import { grownBy } from '../play/fixtures.ts';
import { applySheetAction } from '../play/sheetaction.ts';
import { activeSkills } from '../session/sheet.ts';
import { playState } from '../play/fixtures.ts';
import type { PlayState } from '../play/state.ts';

const SEEDS = [1, 7, 21, 55, 108, 512, 2024];

const withClass = (state: PlayState, classId: string, over = {}): PlayState => ({
  ...state,
  sheet: { ...state.sheet, classId, ...over },
});

/* -------------------------------------------------------------------------- */
/* The hard lock                                                               */
/* -------------------------------------------------------------------------- */

test('a class is never generated a discipline it is locked out of', () => {
  // The property the whole design rests on. If a Fighter could ever roll black
  // magic onto their own tree, an island into it would be worth nothing — it
  // would just be more nodes arriving late.
  for (const held of CLASSES) {
    for (const seed of SEEDS) {
      const tree = skillTreeFor(seed, 'bg', 'en', '', { classId: held.id });
      for (const forbidden of held.forbidden) {
        assert.equal(
          tree.disciplines.includes(forbidden),
          false,
          `${held.id} was given ${forbidden} on seed ${seed}`,
        );
      }
    }
  }
});

test('a class always gets its core, and opens on the first of them', () => {
  for (const held of CLASSES) {
    for (const seed of SEEDS) {
      const tree = skillTreeFor(seed, 'bg', 'en', '', { classId: held.id });
      assert.equal(tree.home, held.core[0], `${held.id} should open on ${held.core[0]}`);
      for (const core of held.core) {
        assert.ok(tree.disciplines.includes(core), `${held.id} lost its core ${core} on seed ${seed}`);
      }
    }
  }
});

test('two classes on the same world get genuinely different trees', () => {
  const fighter = skillTreeFor(21, 'bg', 'en', '', { classId: 'fighter' });
  const wizard = skillTreeFor(21, 'bg', 'en', '', { classId: 'wizard' });

  assert.notEqual(fighter.home, wizard.home);
  assert.ok(fighter.disciplines.includes('sword') && !wizard.disciplines.includes('sword'));
  assert.ok(wizard.disciplines.includes('magic') && !fighter.disciplines.includes('magic'));
});

test('no class is locked out of its own core, or of everything', () => {
  // A configuration error here would be silent: the tree would simply be short.
  for (const held of CLASSES) {
    for (const core of held.core) {
      assert.equal(held.forbidden.includes(core), false, `${held.id} forbids its own core ${core}`);
    }
    assert.ok(
      held.forbidden.length < ARCHETYPES.length - held.core.length,
      `${held.id} forbids too much to fill a tree`,
    );
  }
});

/* -------------------------------------------------------------------------- */
/* Subclasses                                                                  */
/* -------------------------------------------------------------------------- */

test('every subclass opens a way somewhere, and mostly somewhere barred', () => {
  for (const held of CLASSES) {
    assert.ok(held.subclasses.length >= 2, `${held.id} needs a choice, not a formality`);
    for (const sub of held.subclasses) {
      assert.ok(ARCHETYPES.some((a) => a.id === sub.opens), `${sub.id} opens onto nothing`);
      assert.equal(held.core.includes(sub.opens), false, `${sub.id} opens what ${held.id} already has`);
    }
  }
});

test('choosing a subclass grows a branch that was not there before', () => {
  // The point of the whole feature: a choice that visibly reshapes the tree.
  const held = classById('fighter')!;
  const sub = held.subclasses[0];

  const before = skillTreeFor(9, 'bg', 'en', '', { classId: held.id, level: 3 });
  const after = skillTreeFor(9, 'bg', 'en', '', { classId: held.id, subclassId: sub.id, level: 3 });

  const grown = after.nodes.filter((n) => n.grafted?.kind === 'subclass');
  assert.equal(before.nodes.some((n) => n.grafted?.kind === 'subclass'), false);
  assert.ok(grown.length > 0, 'the subclass should have opened something');
  assert.ok(grown.every((n) => n.archetype === sub.opens), `the branch should be ${sub.opens}`);
});

test('a subclass pays out again as the character grows', () => {
  // Three stages rather than one parcel: a permanent choice should buy an arc.
  const held = classById('fighter')!;
  const sub = held.subclasses[0];
  const at = (level: number) =>
    skillTreeFor(9, 'bg', 'en', '', { classId: held.id, subclassId: sub.id, level })
      .nodes.filter((n) => n.grafted?.kind === 'subclass').length;

  assert.equal(at(2), 0, 'nothing before the first stage');
  assert.ok(at(3) > 0);
  assert.ok(at(6) > at(3), 'the second stage deepens it');
  assert.ok(at(10) > at(6), 'and so does the third');
});

test('the first subclass stage is a combination, not a walk', () => {
  // The crossing only opens once several parts of your own tree line up, so an
  // Eldritch Knight has to have genuinely walked the sword first.
  const tree = skillTreeFor(9, 'bg', 'en', '', {
    classId: 'fighter', subclassId: 'eldritch_knight', level: 3,
  });
  const head = tree.nodes.find((n) => n.grafted?.kind === 'subclass' && n.requiresAll?.length);
  assert.ok(head, 'the first stage should need more than one held node');
  assert.ok((head!.requiresAll ?? []).length >= 2);
});

test('the subclass island reaches somewhere the class could never go', () => {
  const held = classById('fighter')!;
  const knight = held.subclasses.find((s) => s.opens === 'magic')!;
  assert.ok(held.forbidden.includes('magic'), 'magic is barred to a fighter');

  const tree = skillTreeFor(9, 'bg', 'en', '', { classId: held.id, subclassId: knight.id, level: 3 });
  assert.ok(
    tree.nodes.some((n) => n.archetype === 'magic'),
    'and the only route in is the subclass',
  );
});

test('a subclass branch is open, not waiting on a tally', () => {
  // It was earned by taking the subclass. Gating it again would mean choosing
  // one and seeing nothing happen.
  const tree = skillTreeFor(9, 'bg', 'en', '', { classId: 'rogue', subclassId: 'poisoner', level: 3 });
  const branch = tree.nodes.filter((n) => n.grafted?.kind === 'subclass');
  assert.ok(branch.length > 0);
  assert.ok(branch.every((n) => !n.requires?.length), 'no requirement left on it');
});

test('nothing is orphaned once a subclass island is attached', () => {
  // The chaotic generator has to keep its promise: a node nothing connects to
  // is a node nobody can ever buy.
  for (const seed of SEEDS) {
    const who = { classId: 'warlock', subclassId: 'pact_voice' };
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
  const base = withClass(playState(), 'rogue');

  assert.match(applySheetAction(base, { type: 'chooseSubclass', id: 'poisoner' }).error ?? '', /level/);

  const ready = withClass(playState(), 'rogue', { level: SUBCLASS_LEVEL });
  assert.match(
    applySheetAction(ready, { type: 'chooseSubclass', id: 'eldritch_knight' }).error ?? '',
    /no such path/,
    'a fighter path is not on offer to a rogue',
  );

  const taken = applySheetAction(ready, { type: 'chooseSubclass', id: 'poisoner' });
  assert.equal(taken.error, null);
  assert.match(
    applySheetAction(taken.state, { type: 'chooseSubclass', id: 'confidence' }).error ?? '',
    /already chosen/,
  );
});

test('taking a subclass grants its signature skill', () => {
  const ready = withClass(playState(), 'wizard', { level: SUBCLASS_LEVEL });
  const taken = applySheetAction(ready, { type: 'chooseSubclass', id: 'abjurer' });

  assert.equal(taken.error, null);
  assert.equal(taken.state.sheet.subclassId, 'abjurer');

  const granted = subclassSkill(subclassById('wizard', 'abjurer')!, 'th');
  assert.ok(
    activeSkills(taken.state.sheet).some((s) => s.id === granted.id),
    'the signature skill should be usable straight away',
  );
});

test('the offer only stands when it can actually be taken', () => {
  assert.equal(canChooseSubclass(1, 'rogue', undefined), false);
  assert.equal(canChooseSubclass(SUBCLASS_LEVEL, 'rogue', undefined), true);
  assert.equal(canChooseSubclass(9, 'rogue', 'poisoner'), false, 'already chosen');
  assert.equal(canChooseSubclass(9, undefined, undefined), false, 'no class, no paths');
});

/* -------------------------------------------------------------------------- */
/* Not breaking what came before                                               */
/* -------------------------------------------------------------------------- */

test('a session with no class behaves exactly as it did', () => {
  // Every save made before classes existed has none. A stored tree must not
  // rearrange itself under a character who has already spent points on it.
  const before = skillTreeFor(21, 'harbour_guard', 'en', 'Harbour Guard');
  const same = skillTreeFor(21, 'harbour_guard', 'en', 'Harbour Guard', {});
  assert.deepEqual(before.nodes, same.nodes);
  assert.equal(before.home, 'guard', 'still inferred from the background');
});

test('the same class and subclass always give the same tree', () => {
  const a = skillTreeFor(4, 'bg', 'en', '', { classId: 'bard', subclassId: 'skirmisher', level: 10 });
  const b = skillTreeFor(4, 'bg', 'en', '', { classId: 'bard', subclassId: 'skirmisher', level: 10 });
  assert.deepEqual(a.nodes, b.nodes);
  assert.deepEqual(a.disciplines, b.disciplines);
});

test('every class is coherent enough to build a character from', () => {
  for (const held of CLASSES) {
    assert.ok([6, 8, 10, 12].includes(held.hitDie), `${held.id} has a strange die`);
    assert.ok(held.startingAttack.damage.sides > 0, `${held.id} cannot hit anything`);
    assert.equal(classById(held.id)?.id, held.id);
    assert.ok(held.name.th.trim() && held.description.th.trim(), `${held.id} is not translated`);
  }
});
