import test from 'node:test';
import assert from 'node:assert/strict';
import { CLASSES } from '../character/classes.ts';
import { favouredThemes, generateTraits, THEMES } from './traitgen.ts';
import type { TraitOrigin } from './traitgen.ts';
import { MAX_TRAITS, MIN_TRAITS, traitsFor } from './traitbook.ts';
import { isEmergent } from './emergent.ts';
import { WRITTEN_COUNTERS } from './traits.ts';
import type { Trait } from './traits.ts';

const SEEDS = [1, 3, 7, 21, 42, 108, 512, 2024, 31337];

const en = (over: Partial<TraitOrigin> = {}): TraitOrigin => ({ language: 'en', ...over });

/*
 * The declared half. `traitsFor` returns both kinds, because they travel the
 * same road once minted — but only these are drawn from themes, only these are
 * topped up by the character, and only these can be shown as goals. The
 * emergent ones have their own file and their own tests.
 */
const declared = (seed: number, origin?: TraitOrigin) =>
  traitsFor(seed, origin).filter((t) => !isEmergent(t.id));

/* -------------------------------------------------------------------------- */
/* The property the whole top-up design rests on                               */
/* -------------------------------------------------------------------------- */

test('taking a subclass adds traits and disturbs none of them', () => {
  /*
   * The safety argument, stated as a test.
   *
   * `sheet.traits` stores ids. A catalogue that could REMOVE an entry would
   * orphan a trait already earned — its bonus would vanish and the branch it
   * grew would fall off the tree mid-run. A catalogue that merely RENUMBERED
   * one would be subtler and worse: a trait earned at thirty kills would
   * quietly start reading forty, and a replayed log would disagree with the
   * character it produced.
   *
   * So: everything present before the choice must still be present after, and
   * byte-identical.
   */
  for (const held of CLASSES) {
    for (const sub of held.subclasses) {
      for (const seed of [7, 42, 2024]) {
        const before = traitsFor(seed, en({ classId: held.id }));
        const after = traitsFor(seed, en({ classId: held.id, subclassId: sub.id }));
        const byId = new Map(after.map((t) => [t.id, t]));

        for (const trait of before) {
          assert.deepEqual(
            byId.get(trait.id), trait,
            `${held.id}/${sub.id} seed ${seed} disturbed ${trait.id}`,
          );
        }
        assert.ok(after.length > before.length, `${held.id}/${sub.id} added nothing`);
      }
    }
  }
});

test('a character only ever adds to the list a bare world offers', () => {
  // The same claim one level up: the base list is a pure function of the seed,
  // so who walks in cannot take anything away from it.
  for (const seed of SEEDS) {
    const bare = traitsFor(seed);
    const someone = traitsFor(seed, en({
      classId: 'fighter', subclassId: 'banner', background: 'a soldier of the low wall',
    }));
    const byId = new Map(someone.map((t) => [t.id, t]));

    for (const trait of bare) {
      assert.deepEqual(byId.get(trait.id), trait, `seed ${seed} disturbed ${trait.id}`);
    }
  }
});

test('a background arriving does not move what the class already added', () => {
  // Sources draw from their own streams, so one appearing cannot shift another.
  for (const seed of SEEDS) {
    const without = traitsFor(seed, en({ classId: 'ranger' }));
    const withOne = traitsFor(seed, en({ classId: 'ranger', background: 'a scholar of the third house' }));
    const byId = new Map(withOne.map((t) => [t.id, t]));
    for (const trait of without) assert.deepEqual(byId.get(trait.id), trait);
  }
});

/* -------------------------------------------------------------------------- */
/* A trait still describes somebody                                            */
/* -------------------------------------------------------------------------- */

test('a trait asks one thing or two, never a checklist', () => {
  /*
   * A skill is a mechanism and a trait is a characterisation. Drawing freely
   * gives "thirty kills and twenty short rests and a charisma of fifteen" —
   * mechanically valid, and a person no name fits. The authored twelve never
   * used more than two conditions either.
   */
  for (const seed of SEEDS) {
    for (const trait of traitsFor(seed, en({ classId: 'rogue' }))) {
      assert.ok(
        trait.requires.length >= 1 && trait.requires.length <= 2,
        `${trait.id} asks ${trait.requires.length} things`,
      );
    }
  }
});

test('every condition in a trait comes from one theme', () => {
  const describe = (t: Trait) => t.requires.map((c) =>
    c.kind === 'counter' ? `counter:${c.counter}`
      : c.kind === 'ability' ? `ability:${c.ability}`
        : c.kind === 'personality' ? `personality:${c.axis}` : c.kind);

  const themeTerms = THEMES.map((theme) => new Set(theme.terms.map((t) =>
    t.kind === 'counter' ? `counter:${t.counter}`
      : t.kind === 'ability' ? `ability:${t.ability}`
        : t.kind === 'personality' ? `personality:${t.axis}` : 'level')));

  for (const seed of SEEDS) {
    for (const trait of declared(seed, en({ classId: 'bard' }))) {
      const terms = describe(trait);
      assert.ok(
        themeTerms.some((set) => terms.every((t) => set.has(t))),
        `${trait.id} mixes themes: ${terms.join(' + ')}`,
      );
    }
  }
});

test('a trait only ever gates on a counter something writes', () => {
  /*
   * The failure that made "A Known Face" unearnable in every world ever
   * generated. Under generation it would have been worse — a dead counter
   * would be drawn into a different trait in every world, and nothing in the
   * game would ever say so.
   */
  for (const seed of SEEDS) {
    for (const trait of traitsFor(seed, en({ classId: 'wizard', subclassId: 'abjurer' }))) {
      for (const c of trait.requires) {
        if (c.kind === 'counter') {
          assert.ok(WRITTEN_COUNTERS.includes(c.counter), `${trait.id} gates on ${c.counter}`);
        }
      }
    }
  }
});

test('a trait never asks for a score a person cannot reach', () => {
  // Thresholds move with the world's demand; a ceiling does not.
  for (const seed of SEEDS) {
    for (const trait of traitsFor(seed, en({ classId: 'barbarian' }))) {
      for (const c of trait.requires) {
        if (c.kind === 'ability') assert.ok(c.atLeast <= 20, `${trait.id} wants ${c.atLeast}`);
        if (c.kind === 'level') assert.ok(c.atLeast <= 20, `${trait.id} wants level ${c.atLeast}`);
      }
    }
  }
});

test('every trait is named, described, and gives something', () => {
  for (const seed of SEEDS) {
    for (const trait of traitsFor(seed, en({ classId: 'oracle' }))) {
      assert.ok(trait.name.length > 2, `${trait.id} is barely named`);
      assert.ok(trait.description.length > 10, `${trait.id} says nothing`);
      assert.ok(trait.grants?.ability || trait.grants?.note, `${trait.id} grants nothing`);
    }
  }
});

test('a world never offers the same trait twice', () => {
  for (const seed of SEEDS) {
    const traits = traitsFor(seed, en({ classId: 'fighter', subclassId: 'banner' }));
    const ids = traits.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length, `seed ${seed} repeated an id`);
  }
});

test('most traits grow nothing, and some do', () => {
  // A tree that sprouted on every tally would be noise; one that sprouted on
  // none would make the whole graft system unreachable through traits.
  const all = SEEDS.flatMap((seed) => traitsFor(seed, en({ classId: 'ranger' })));
  const opens = all.filter((t) => t.opens).length;
  assert.ok(opens > 0, 'no trait ever grew a branch');
  assert.ok(opens < all.length, 'every trait grew a branch');

  for (const trait of all) {
    if (!trait.opens) continue;
    assert.ok(trait.opens.size >= 2 && trait.opens.size <= 5, `${trait.id} grows ${trait.opens.size}`);
  }
});

/* -------------------------------------------------------------------------- */
/* Different people, different worlds                                          */
/* -------------------------------------------------------------------------- */

test('two classes in the same world are offered different things', () => {
  const shape = (classId: string) =>
    traitsFor(42, en({ classId })).map((t) => t.id).sort().join(',');
  assert.notEqual(shape('fighter'), shape('bard'));
  assert.notEqual(shape('wizard'), shape('barbarian'));
});

test('one class in two worlds is offered different things again', () => {
  const shape = (seed: number) =>
    traitsFor(seed, en({ classId: 'fighter' })).map((t) => `${t.name}|${JSON.stringify(t.requires)}`).sort();
  assert.notDeepEqual(shape(1), shape(999));
  assert.notDeepEqual(shape(42), shape(2024));
});

test('a background leans the list where its words point', () => {
  // The extras are what make a soldier's run different from a scholar's in the
  // same tower, as the same class.
  const soldier = favouredThemes(42, { background: 'a soldier of the low wall' });
  const scholar = favouredThemes(42, { background: 'a scholar of the third house' });

  assert.equal(soldier.find((f) => f.source === 'background')!.theme.id, 'violence');
  assert.equal(scholar.find((f) => f.source === 'background')!.theme.id, 'curiosity');
});

test('a background nothing recognises still leans somewhere, and stays there', () => {
  // Model-written backgrounds will not always contain a word we know. Falling
  // back to a hash keeps the run varied AND deterministic, which matters more
  // than the lean being apt.
  const odd = 'one who counts the rain';
  const once = favouredThemes(7, { background: odd });
  assert.deepEqual(once, favouredThemes(7, { background: odd }));
  assert.ok(once.some((f) => f.source === 'background'));
});

test('the same world offers the same person the same list', () => {
  /*
   * Non-negotiable. Traits are evaluated inside the fold, so a catalogue that
   * shifted between loads would rewrite a character's history: a trait earned
   * on turn forty would be unearned on reload, or earned twice.
   */
  const origin = en({ classId: 'warlock', subclassId: 'pact_ember', background: 'an apothecary' });
  assert.deepEqual(traitsFor(42, origin), traitsFor(42, origin));
  assert.deepEqual(traitsFor(7), traitsFor(7));
});

test('a world offers a sensible number before anyone tops it up', () => {
  for (const seed of SEEDS) {
    const bare = declared(seed);
    assert.ok(
      bare.length >= MIN_TRAITS && bare.length <= MAX_TRAITS,
      `seed ${seed} offered ${bare.length}`,
    );
  }
});

test('Thai names are Thai, not translated English', () => {
  const traits = generateTraits({ seed: 42, count: 6, origin: { language: 'th' } });
  for (const trait of traits) assert.match(trait.name, /[฀-๿]/, `got ${trait.name}`);
});

test('a trait is always earned by something you did', () => {
  /*
   * Found by reading the output: drawing freely produced "Blooded Work: be
   * unkind" — a single personality condition, which is not an achievement but
   * a description handed out for free on turn one. A score or a leaning may
   * QUALIFY a deed; it cannot BE the deed.
   */
  for (const seed of SEEDS) {
    for (const held of CLASSES) {
      for (const trait of traitsFor(seed, en({ classId: held.id }))) {
        assert.ok(
          // A shape counts: it is a relation between things you did, and is
          // in fact the purest form of the claim.
          trait.requires.some((c) => c.kind === 'counter' || c.kind === 'level' || c.kind === 'shape'),
          `${trait.id} (${trait.name}) is earned by existing: ${JSON.stringify(trait.requires)}`,
        );
      }
    }
  }
});

test('no two traits in one list share a name', () => {
  // Two "Named Debt" read as a bug however different their conditions are.
  for (const seed of SEEDS) {
    for (const held of CLASSES) {
      for (const sub of [undefined, held.subclasses[0]?.id]) {
        const names = traitsFor(seed, en({ classId: held.id, subclassId: sub })).map((t) => t.name);
        assert.equal(new Set(names).size, names.length, `seed ${seed} ${held.id}/${sub}: ${names.join(', ')}`);
      }
    }
  }
});
