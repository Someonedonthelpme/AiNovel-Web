import test from 'node:test';
import { dispositionOf } from '../character/persona.ts';
import assert from 'node:assert/strict';
import { mulberry32 } from '../engine/roll.ts';
import { canAllocate, entryOpen } from './allocate.ts';
import type { Allocation } from './allocate.ts';
import { graftFor, GRAFT_MAX, GRAFT_MIN } from './graft.ts';
import type { GraftSource, GraftSpec } from './graft.ts';
import { skillTreeFor } from './skilltree.ts';
import { grownBy, quietTraitsOf } from './fixtures.ts';
import type { SkillNode } from './skilltree.ts';
import { playState } from './fixtures.ts';
import type { TraitContext } from './traits.ts';

const source: GraftSource = { kind: 'trait', id: 'butcher', name: 'Butcher' };

const anchor = (id: string, x = 60, y = 60): SkillNode => ({
  id, name: id, description: '', kind: 'minor', path: 'p', stat: 'str',
  ring: 3, x, y, connections: [], grant: {},
});

const grow = (spec: GraftSpec, anchors: SkillNode[], seed = 5) =>
  graftFor(mulberry32(seed), { id: 'g', spec, source, anchors, language: 'en' });

const held = (...ids: string[]): Allocation => ({ taken: ['start', ...ids] });

const ctxOf = (): TraitContext => {
  const state = playState();
  return {
    sheet: { ...state.sheet, skillPoints: 5 },
    inventory: state.pc.inventory,
    counters: state.sheet.counters,
    personality: dispositionOf(state.sheet),
  };
};

/* -------------------------------------------------------------------------- */
/* The three ways in                                                           */
/* -------------------------------------------------------------------------- */

test('a sequence branch needs one held node, like everywhere else', () => {
  const [head] = grow({ stat: 'str', entry: 'sequence', size: 3 }, [anchor('a')]);
  assert.equal(entryOpen(head, held()), false, 'nothing held, no way in');
  assert.equal(entryOpen(head, held('a')), true);
});

test('a parallel branch needs nothing held at all', () => {
  // The book or trait that grew it already paid the entry. This is the one
  // place on the tree you can spend without having walked there.
  const [head] = grow({ stat: 'wis', entry: 'parallel', size: 3 }, [anchor('a')]);
  assert.equal(head.freeStanding, true);
  assert.equal(head.connections.length, 0, 'no edge to anything');
  assert.equal(entryOpen(head, held()), true);
});

test('a combination branch needs every one of its anchors, not any', () => {
  // The only thing on the tree you plan for rather than walk to.
  const nodes = grow({ stat: 'agi', entry: 'combination', size: 4, needs: 2 }, [
    anchor('a', 60, 60), anchor('b', 40, 60), anchor('c', 60, 40),
  ]);
  const head = nodes[0];
  assert.ok((head.requiresAll ?? []).length >= 2);

  const [first, second] = head.requiresAll!;
  assert.equal(entryOpen(head, held(first)), false, 'one is not enough');
  assert.equal(entryOpen(head, held(second)), false);
  assert.equal(entryOpen(head, held(first, second)), true);
});

test('the refusal says which kind of gate it is', () => {
  // "you have not reached that yet" and "several parts have to meet" are
  // different problems, and conflating them makes the tree feel broken.
  const tree = skillTreeFor(3, 'bg', 'en', '', {
    classId: 'fighter', traits: grownBy(3, { classId: 'fighter' }).traits,
  });
  const combo = tree.nodes.find((n) => n.requiresAll?.length);
  if (!combo) return;

  const refusal = canAllocate(tree, held(), ctxOf(), combo.id).reason ?? '';
  assert.match(refusal, /several parts/);
});

test('a combination falls back to a road when there is nothing to bridge', () => {
  // One anchor cannot make a bridge. Refusing to generate would leave the
  // trait that earned it paying out nothing.
  const nodes = grow({ stat: 'agi', entry: 'combination', size: 3 }, [anchor('a')]);
  assert.ok(nodes.length > 0);
  assert.equal(nodes[0].requiresAll, undefined);
});

/* -------------------------------------------------------------------------- */
/* Shape and size                                                              */
/* -------------------------------------------------------------------------- */

test('a branch is between two and five nodes, whatever it asks for', () => {
  for (const size of [-4, 0, 1, 2, 5, 9, 40]) {
    const nodes = grow({ stat: 'str', entry: 'sequence', size }, [anchor('a')]);
    assert.ok(nodes.length >= GRAFT_MIN, `${size} gave ${nodes.length}`);
    assert.ok(nodes.length <= GRAFT_MAX, `${size} gave ${nodes.length}`);
  }
});

test('every branch teaches something', () => {
  // A branch that only moves numbers is the thing this system was built to
  // stop being the whole tree.
  for (const entry of ['sequence', 'parallel', 'combination'] as const) {
    const nodes = grow({ stat: 'int', entry, size: 4 }, [anchor('a'), anchor('b', 40, 40)]);
    assert.ok(nodes.some((n) => n.teaches), `${entry} taught nothing`);
  }
});

test('a branch says what grew it', () => {
  const nodes = grow({ stat: 'str', entry: 'sequence', size: 3 }, [anchor('a')]);
  assert.ok(nodes.every((n) => n.grafted?.id === 'butcher'));
  assert.ok(nodes.every((n) => n.grafted?.kind === 'trait'));
});

test('the same source always grows the same branch', () => {
  const spec: GraftSpec = { stat: 'str', entry: 'sequence', size: 4 };
  assert.deepEqual(grow(spec, [anchor('a')], 11), grow(spec, [anchor('a')], 11));
});

/* -------------------------------------------------------------------------- */
/* Growing onto the tree                                                       */
/* -------------------------------------------------------------------------- */

test('earning things grows the tree', () => {
  // Named from what this world actually offers rather than from the authored
  // catalogue — that list stopped being what a run contains once traits and
  // Signets were generated, and hardcoded ids would silently match nothing.
  const grows = grownBy(7, { classId: 'rogue' }, 3);
  const { traits } = grows;
  const signets = grows.signets.slice(0, 1);
  assert.ok(traits.length === 3 && signets.length === 1, 'this world grows nothing to test with');

  const bare = skillTreeFor(7, 'bg', 'en', '', { classId: 'rogue' });
  const earned = skillTreeFor(7, 'bg', 'en', '', { classId: 'rogue', traits, signets });
  assert.ok(earned.nodes.length > bare.nodes.length + 6, 'four sources should be visible');
});

test('branches usually hang off other branches, not only the main tree', () => {
  /*
   * What makes the tree grow in layers rather than sprouting tufts around the
   * same old web.
   *
   * Asserted across seeds rather than on one, because it is deliberately a
   * bias and not a rule — an unlucky seed can send every branch to the main
   * tree, and forcing it every time would grow one long tail instead of a web.
   */
  const seeds = [1, 3, 5, 7, 9, 12, 21, 33, 55, 77];
  const layeredIn = seeds.filter((seed) => {
    const grows = grownBy(seed, { classId: 'warlock' });
    const tree = skillTreeFor(seed, 'bg', 'en', '', {
      classId: 'warlock',
      traits: grows.traits,
      signets: grows.signets.slice(0, 2),
    });
    const byId = new Map(tree.nodes.map((n) => [n.id, n]));
    return tree.nodes.some(
      (n) => n.grafted
        && n.connections.some((c) => byId.get(c)?.grafted && byId.get(c)!.grafted!.id !== n.grafted!.id),
    );
  });

  assert.ok(
    layeredIn.length >= seeds.length * 0.7,
    `only ${layeredIn.length}/${seeds.length} seeds grew a branch onto another`,
  );
});

test('a trait that opens nothing still just gives its bonus', () => {
  // Most traits do not grow branches. A tree that sprouted on every tally
  // would be noise.
  const quiet = skillTreeFor(7, 'bg', 'en', '', {
    classId: 'rogue', traits: quietTraitsOf(7, { classId: 'rogue' }).slice(0, 2),
  });
  const bare = skillTreeFor(7, 'bg', 'en', '', { classId: 'rogue' });
  assert.equal(quiet.nodes.length, bare.nodes.length);
});

test('everything is reachable, counting free-standing branches as their own roots', () => {
  /*
   * The orphan walk, corrected for parallel entries.
   *
   * A free-standing node is unreachable from the origin BY DESIGN — that is
   * what parallel means. So the walk starts from the origin and from every
   * free-standing root. Anything still unvisited is a genuine orphan: a node
   * nobody could ever buy.
   */
  for (const seed of [1, 7, 21, 55, 108]) {
    const sub = { classId: 'bard', subclassId: 'skirmisher' };
    const tree = skillTreeFor(seed, 'bg', 'en', '', {
      ...sub,
      level: 10,
      traits: grownBy(seed, sub).traits,
      signets: grownBy(seed, sub).signets.slice(0, 2),
      books: [
        { bookId: 'book_a', name: 'A Soldier’s Notes', set: { stat: 'str', entry: 'parallel', size: 2 } },
        { bookId: 'book_b', name: 'The Long Watch', set: { stat: 'cha', entry: 'parallel', size: 3 } },
      ],
    });

    const byId = new Map(tree.nodes.map((n) => [n.id, n]));
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

    const orphans = tree.nodes.filter((n) => !seen.has(n.id)).map((n) => n.id);
    assert.deepEqual(orphans, [], `seed ${seed} stranded ${orphans.length} nodes`);
  }
});

test('a grown tree outgrows the points you will ever have', () => {
  // Deliberate. A tree you can finish is a tree that stops asking you
  // anything, and points arrive one a level while branches arrive with every
  // trait, Signet, book and subclass stage.
  const everything = { classId: 'wizard', subclassId: 'abjurer' };
  const grows = grownBy(4, everything, 8);
  const tree = skillTreeFor(4, 'bg', 'en', '', {
    ...everything,
    level: 20,
    traits: grows.traits,
    signets: grows.signets,
    books: [
      { bookId: 'book_a', name: 'One', set: { stat: 'str', entry: 'parallel', size: 2 } },
      { bookId: 'book_b', name: 'Two', set: { stat: 'cha', entry: 'parallel', size: 3 } },
      { bookId: 'book_c', name: 'Three', set: { stat: 'int', entry: 'parallel', size: 3 } },
    ],
  });

  // A character at level 20 has roughly 20 points to their name.
  assert.ok(tree.nodes.length > 60, `only ${tree.nodes.length} nodes to choose between`);
});
