import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../engine/roll.ts';
import { addItem, countOf } from '../items/types.ts';
import { TOWER_DEPTH } from '../items/catalogue.ts';
import { chainedBook, CHAIN_LENGTH, provableChain, volumeFloor, volumeId } from '../skills/book.ts';
import { candidateSignetsFor, signetsFor, TOWER_HORIZON } from './signetbook.ts';
import { MAX_TRAITS, MIN_TRAITS, traitsFor } from './traitbook.ts';
import { isEmergent } from './emergent.ts';
import { COUNTERS } from './traits.ts';
import { counterOf } from '../character/persona.ts';
import { applyTurn } from './delta.ts';
import type { TurnRecord } from './state.ts';
import { skillTreeFor } from './skilltree.ts';
import { useItem } from './rest.ts';
import { playState } from './fixtures.ts';
import type { PlayState } from './state.ts';

/* -------------------------------------------------------------------------- */
/* A book grows its own discipline                                             */
/* -------------------------------------------------------------------------- */

test('a book grows the discipline it is about, not a default one', () => {
  // Regression: every book's set defaulted to wisdom, so a book about
  // steadiness grew the wrong branch entirely.
  const tree = skillTreeFor(5, 'bg', 'en', '', {
    classId: 'fighter',
    books: [
      { bookId: 'a', name: 'On Holding Ground', set: { stat: 'vit', entry: 'parallel', size: 3 } },
      { bookId: 'b', name: 'Field Marks', set: { stat: 'int', entry: 'parallel', size: 2 } },
    ],
  });

  const grown = tree.nodes.filter((n) => n.grafted?.kind === 'book');
  // Each book grew a set on the STAT it teaches out of, so three books about
  // three different things cannot all land on one branch.
  const stats = new Set(grown.map((n) => n.stat));
  assert.ok(stats.size > 1, `three books grew ${stats.size} kind of branch`);
});

test('a book set free-stands, whatever it is about', () => {
  const tree = skillTreeFor(5, 'bg', 'en', '', {
    classId: 'fighter',
    books: [{ bookId: 'a', name: 'A', set: { stat: 'cha', entry: 'parallel', size: 3 } }],
  });
  const head = tree.nodes.find((n) => n.grafted?.kind === 'book' && n.freeStanding);
  assert.ok(head, 'you read your way in rather than walking');
});

/* -------------------------------------------------------------------------- */
/* Chains                                                                      */
/* -------------------------------------------------------------------------- */

test('a series runs in order, each volume needing the last', () => {
  const volumes = [0, 1, 2].map((v) => chainedBook(mulberry32(3), 1, v));
  assert.equal(volumes[0].needsBook, undefined, 'the first stands alone');
  assert.equal(volumes[1].needsBook, volumeId(1, 0));
  assert.equal(volumes[2].needsBook, volumeId(1, 1));
});

test('later volumes are worth more', () => {
  const first = chainedBook(mulberry32(3), 1, 0);
  const last = chainedBook(mulberry32(3), 1, CHAIN_LENGTH - 1);
  assert.ok(last.set.size > first.set.size);
  assert.ok(last.foundOn! > first.foundOn!);
});

test('every volume of a series teaches something different', () => {
  // Regression: they shared one generator, so a whole series taught the same
  // skill and the second volume was refused as already known.
  const taught = [0, 1, 2].map((v) => chainedBook(mulberry32(3), 4, v).teaches.id);
  assert.equal(new Set(taught).size, taught.length, `duplicates: ${taught.join(', ')}`);
});

test('a series is only printed when the whole of it is reachable', () => {
  // The same failure the Signet walk exists to prevent: a book whose
  // prerequisite never drops refuses to open forever, and the player has no way
  // to learn why.
  for (let series = 0; series < 6; series++) {
    assert.equal(provableChain(series, TOWER_DEPTH), true, `series ${series} is unreadable`);
  }
  assert.equal(provableChain(0, 2), false, 'a shallow tower cannot finish a series');
});

test('the tower depth the drops assume matches the depth Signets are proved against', () => {
  // Two constants, one promise. They are apart to avoid a cycle, so a test has
  // to hold them together.
  assert.equal(TOWER_DEPTH, TOWER_HORIZON);
});

test('reading out of order is refused, and says why', () => {
  const base = playState();
  const second = chainedBook(mulberry32(3), 1, 1);
  const carrying: PlayState = { ...base, pc: { ...base.pc, inventory: addItem(base.pc.inventory, second) } };

  const early = useItem(carrying, second.id);
  assert.match(early.error ?? '', /follows on from something/);
  assert.ok(countOf(carrying.pc.inventory, second.id) > 0, 'and it is not wasted');
});

test('reading in order shelves both, and the shelf grows both branches', () => {
  const base = playState();
  const first = chainedBook(mulberry32(3), 1, 0);
  const second = chainedBook(mulberry32(3), 1, 1);

  let state: PlayState = {
    ...base,
    pc: { ...base.pc, inventory: addItem(addItem(base.pc.inventory, first), second) },
  };

  state = useItem(state, first.id).state;
  const then = useItem(state, second.id);
  assert.equal(then.error, null, 'the second opens once the first is read');
  assert.equal(then.state.sheet.library?.length, 2);

  const tree = skillTreeFor(4, 'bg', 'en', '', { classId: 'ranger', books: then.state.sheet.library });
  const fromBooks = new Set(tree.nodes.filter((n) => n.grafted?.kind === 'book').map((n) => n.grafted!.id));
  assert.equal(fromBooks.size, 2, 'both volumes are on the tree');
});

/* -------------------------------------------------------------------------- */
/* Traits that differ by world                                                 */
/* -------------------------------------------------------------------------- */

test('two worlds ask different things of you', () => {
  const a = traitsFor(1);
  const b = traitsFor(999);
  assert.notDeepEqual(a.map((t) => t.id).sort(), b.map((t) => t.id).sort());
});

test('a world offers a subset, and always the same one', () => {
  for (const seed of [1, 7, 42, 108, 2024]) {
    // The DECLARED half. Emergent traits ride in the same list once minted,
    // but a world does not offer a subset of those — it cannot decline to
    // notice what somebody actually did.
    const world = traitsFor(seed).filter((t) => !isEmergent(t.id));
    assert.ok(world.length >= MIN_TRAITS && world.length <= MAX_TRAITS);
    // Both halves, because both are folded: a replayed log has to earn the
    // same declared traits AND notice the same shapes at the same moments.
    assert.deepEqual(traitsFor(seed), traitsFor(seed), 'a replayed log must earn the same traits');
  }
});

test('thresholds move but stay sane', () => {
  // A world reads as demanding or forgiving; it does not ask for nothing, and
  // it does not ask for the impossible.
  for (const seed of [1, 7, 42, 108, 2024]) {
    for (const trait of traitsFor(seed)) {
      for (const condition of trait.requires) {
        if (condition.kind === 'counter') {
          assert.ok(condition.atLeast >= 1, `${trait.id} asks for ${condition.atLeast}`);
          assert.ok(condition.atLeast <= 100, `${trait.id} asks for ${condition.atLeast}`);
        }
      }
    }
  }
});

test('a varied trait still gates on a counter something increments', () => {
  // The check that made the authored catalogue safe has to survive the world
  // being allowed to rewrite it.
  const live = new Set<string>(Object.values(COUNTERS));
  for (const seed of [1, 7, 42, 108, 2024]) {
    for (const trait of traitsFor(seed)) {
      for (const condition of trait.requires) {
        if (condition.kind === 'counter') {
          assert.ok(live.has(condition.counter), `${trait.id} gates on dead counter ${condition.counter}`);
        }
      }
    }
  }
});

test('the branch a trait grows is this world’s business too', () => {
  const opens = (seed: number) =>
    traitsFor(seed).filter((t) => t.opens).map((t) => `${t.id}:${t.opens!.stat}:${t.opens!.entry}`);
  assert.notDeepEqual(opens(1).sort(), opens(999).sort());
});

/* -------------------------------------------------------------------------- */
/* Signets that differ by world                                                */
/* -------------------------------------------------------------------------- */

test('two worlds hide different Signets', () => {
  const describe = (seed: number) =>
    candidateSignetsFor(seed).map((s) => JSON.stringify({ gate: s.gate, opens: s.opens }));
  assert.notDeepEqual(describe(1), describe(999));
});

test('a varied Signet is still proved obtainable before it ships', () => {
  /*
   * The reason the walk matters MORE now than when they were authored: varying
   * a depth or a tally is exactly the sort of change that could quietly push a
   * gate past what the tower can supply, and a hidden Signet behind a broken
   * gate is indistinguishable from one that is merely well concealed.
   */
  for (const seed of [1, 7, 42, 108, 512, 2024, 31337]) {
    const state = playState();
    const world: PlayState = { ...state, world: { ...state.world, seed } };
    const checked = signetsFor(world);

    assert.deepEqual(
      checked.discarded.map((d) => `${d.signet.id}: ${d.why.join('; ')}`),
      [],
      `seed ${seed} produced an unobtainable Signet`,
    );
    assert.ok(checked.kept.length > 0);
  }
});

test('a varied Signet never asks for a depth the tower does not reach', () => {
  for (const seed of [1, 7, 42, 108, 2024]) {
    for (const signet of candidateSignetsFor(seed)) {
      const walk = (gate: typeof signet.gate): void => {
        if (gate.kind === 'all' || gate.kind === 'any') gate.of.forEach(walk);
        if (gate.kind === 'itemFromDepth') {
          assert.ok(gate.minFloor <= TOWER_HORIZON, `${signet.id} wants floor ${gate.minFloor}`);
        }
      };
      walk(signet.gate);
    }
  }
});

test('volumes appear at the depth their series says', () => {
  for (let series = 0; series < 6; series++) {
    for (let volume = 1; volume < CHAIN_LENGTH; volume++) {
      assert.ok(
        volumeFloor(series, volume) > volumeFloor(series, volume - 1),
        'a later volume is found deeper',
      );
    }
  }
});

/* -------------------------------------------------------------------------- */
/* Every counter a trait may gate on has to actually move                      */
/* -------------------------------------------------------------------------- */

test('meeting somebody counts, so the trait gating on it can be earned', () => {
  /*
   * Regression, and an ugly one: `people_met` sat in the counter registry with
   * NOTHING writing it, so "A Known Face" was unearnable in every world ever
   * generated — and the Signet proof treated the counter as live, because the
   * registry says a name exists, not that anything increments it.
   */
  const start = playState();
  assert.equal(counterOf(start.sheet.counters, COUNTERS.peopleMet), 0);

  const turn: TurnRecord = {
    kind: 'turn', input: 'look around', mode: 'exploration', classification: 'NEUTRAL',
    addressed: null, roll: null, delta: {}, rejected: [], prose: '',
  };
  const after = applyTurn(start, turn).state;

  assert.ok(
    counterOf(after.sheet.counters, COUNTERS.peopleMet) > 0,
    'standing among people you have never met should count',
  );
});

test('the same faces are not counted twice', () => {
  const turn: TurnRecord = {
    kind: 'turn', input: 'look around', mode: 'exploration', classification: 'NEUTRAL',
    addressed: null, roll: null, delta: {}, rejected: [], prose: '',
  };
  const once = applyTurn(playState(), turn).state;
  const twice = applyTurn(once, turn).state;

  assert.equal(
    counterOf(twice.sheet.counters, COUNTERS.peopleMet),
    counterOf(once.sheet.counters, COUNTERS.peopleMet),
    'they are not strangers the second time',
  );
});
