import test from 'node:test';
import assert from 'node:assert/strict';
import {
  axisOf, EDGE_AXES, EDGE_MAX, EDGE_MIN, edgeBetween, hostileToward, nudge, nudgeAll,
  openingEdges, PLAYER, reachedBy, regardedBy, setRoles, trustToward,
} from './edge.ts';
import type { EdgeAxis, Edges } from './edge.ts';
import { markOf, witnessDeed } from './deed.ts';
import { applyDelta, applyTurn } from '../play/delta.ts';
import { playState } from '../play/fixtures.ts';
import type { TurnRecord } from '../play/state.ts';

/* -------------------------------------------------------------------------- */
/* The shape                                                                   */
/* -------------------------------------------------------------------------- */

test('an edge is DIRECTIONAL, so the two of them may disagree completely', () => {
  // The thing one number could never say: she is fond of him and he has barely
  // noticed her. Unrequited anything needs exactly this.
  let edges = nudge({}, 'her', 'him', 'regard', 4);
  edges = nudge(edges, 'him', 'her', 'regard', -1);

  assert.equal(axisOf(edges, 'her', 'him', 'regard'), 4);
  assert.equal(axisOf(edges, 'him', 'her', 'regard'), -1);
});

test('the graph is SPARSE: nothing exists until something happened', () => {
  assert.equal(edgeBetween({}, 'a', 'b'), null);
  assert.equal(axisOf({}, 'a', 'b', 'trust'), 0, 'and an absent edge reads as nought, not as an error');

  // An axis that has never moved is not stored either, so a town of two
  // hundred is the dozen relationships that happened, not forty thousand.
  const edges = nudge({}, 'a', 'b', 'trust', 2);
  assert.deepEqual(Object.keys(edges['a>b'].axes), ['trust']);
});

test('nudging by nothing forms no edge', () => {
  assert.deepEqual(nudge({}, 'a', 'b', 'trust', 0), {});
});

test('nobody has a relationship with themselves', () => {
  assert.deepEqual(nudge({}, 'a', 'a', 'trust', 3), {});
});

test('every axis clamps to the same band', () => {
  for (const axis of EDGE_AXES) {
    assert.equal(axisOf(nudge({}, 'a', 'b', axis, 99), 'a', 'b', axis), EDGE_MAX, axis);
    assert.equal(axisOf(nudge({}, 'a', 'b', axis, -99), 'a', 'b', axis), EDGE_MIN, axis);
  }
});

test('one act can move several axes at once, which is what an act usually does', () => {
  const edges = nudgeAll({}, 'a', 'b', { trust: -2, respect: -2, resentment: 1 });
  assert.equal(axisOf(edges, 'a', 'b', 'trust'), -2);
  assert.equal(axisOf(edges, 'a', 'b', 'resentment'), 1);
  assert.equal(axisOf(edges, 'a', 'b', 'fear'), 0, 'and leaves what it did not touch alone');
});

test('roles are a SET, because your brother may also be your creditor', () => {
  const edges = setRoles({}, 'a', 'b', ['brother', 'creditor', 'brother']);
  assert.deepEqual(edgeBetween(edges, 'a', 'b')?.roles, ['brother', 'creditor']);
});

test('who you regard and who regards you are different sets', () => {
  let edges = nudge({}, 'a', 'b', 'trust', 1);
  edges = nudge(edges, 'c', 'a', 'fear', 2);

  assert.deepEqual(reachedBy(edges, 'a'), ['b']);
  assert.deepEqual(regardedBy(edges, 'a'), ['c']);
});

/* -------------------------------------------------------------------------- */
/* EVERY AXIS HAS A WRITER                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The failure mode this exists to prevent.
 *
 * A rich relationship model dies as a dozen numbers all hovering near zero,
 * because nothing ever pushes any one of them hard enough — which is this
 * codebase's signature bug in a new hat. So an axis is declared only once
 * something writes it, and the list below names what does the writing.
 *
 * `guilt` and `obligation` arrived exactly that way, with the deeds that write
 * them. `desire` and `envy` are still absent for want of one, and `loyalty`
 * arrives with companions.
 */
const WRITERS: Record<EdgeAxis, string> = {
  trust: 'the Director delta, and the register',
  familiarity: 'having dealt with somebody at all',
  regard: 'how a social check actually went',
  respect: 'the register: observing what is owed',
  resentment: 'the register: roughness to a superior',
  fear: 'the register: roughness from somebody above you',
  guilt: 'harming somebody you thought well of',
  obligation: 'being spared by somebody who could have finished it',
};

const turn = (over: Partial<TurnRecord> = {}): TurnRecord => ({
  kind: 'turn', input: '', mode: 'conversation', classification: 'NEUTRAL',
  addressed: 'smith', roll: null, delta: {}, rejected: [], prose: '', ...over,
});

/** Every axis some path actually moved, driving the real fold. */
function written(): Set<EdgeAxis> {
  const moved = new Set<EdgeAxis>();
  const base = playState();

  const record = (r: TurnRecord) => {
    const after = applyTurn(base, r).state.world.edges;
    for (const axis of EDGE_AXES) if (axisOf(after, 'smith', PLAYER, axis) !== 0) moved.add(axis);
  };

  // The Director moving trust.
  record(turn({ delta: { trust: { smith: 2 } } }));
  // A check going well, and going badly.
  record(turn({ roll: { tier: 'hit', total: 12, dice: [6, 6], modifier: 0 } as never }));
  record(turn({ roll: { tier: 'miss', total: 3, dice: [1, 2], modifier: 0 } as never }));
  // And how the player chose to speak, to each kind of standing there is.
  for (const status of ['superior', 'peer', 'inferior'] as const) {
    const world = {
      ...base.world,
      people: { ...base.world.people, smith: { ...base.world.people['smith'], status } },
    };
    const after = applyTurn({ ...base, world }, turn({ input: 'มึงเอาอะไรวะ' })).state.world.edges;
    for (const axis of EDGE_AXES) if (axisOf(after, 'smith', PLAYER, axis) !== 0) moved.add(axis);
  }

  /*
   * `guilt` and `obligation` are written by DEEDS rather than by a turn's
   * exchange, so they are driven here through the same public entry point.
   */
  const fond = nudge(base.world.edges, PLAYER, 'smith', 'regard', 3);
  const hurt = witnessDeed(fond, { kind: 'killed', doer: PLAYER, toward: 'smith', at: 'town' }, ['smith', 'warden'], 1);
  const spared = witnessDeed({}, { kind: 'spared', doer: PLAYER, toward: 'smith', at: 'town' }, ['smith'], 1);
  for (const axis of EDGE_AXES) {
    if (axisOf(hurt.edges, PLAYER, 'smith', axis) !== 0) moved.add(axis);
    if (axisOf(spared.edges, 'smith', PLAYER, axis) !== 0) moved.add(axis);
  }

  return moved;
}

test('EVERY declared edge axis is actually written by something', () => {
  const moved = written();
  for (const axis of EDGE_AXES) {
    assert.ok(moved.has(axis), `"${axis}" is stored and nothing writes it (claimed: ${WRITERS[axis]})`);
  }
});

test('the writer list still covers the axes, so adding one without a writer fails here', () => {
  // Behaviour coverage cannot be introspected, so this is the device
  // `ruleset.test.ts` and `counters.test.ts` both use: name what is proved, and
  // assert the claim still covers the thing it is about.
  assert.deepEqual(Object.keys(WRITERS).sort(), [...EDGE_AXES].sort());
});

/* -------------------------------------------------------------------------- */
/* What each writer actually does                                              */
/* -------------------------------------------------------------------------- */

test('dealing with somebody at all is what forms the edge', () => {
  const base = playState();
  assert.equal(edgeBetween(base.world.edges, 'smith', PLAYER), null, 'strangers to begin with');

  const after = applyTurn(base, turn()).state.world.edges;
  assert.equal(axisOf(after, 'smith', PLAYER, 'familiarity'), 1);
});

test('a turn addressing nobody forms no edge at all', () => {
  const base = playState();
  const after = applyTurn(base, turn({ addressed: null })).state.world.edges;
  assert.deepEqual(after ?? {}, base.world.edges ?? {});
});

test('THE REGISTER MOVES THE NUMBERS, which for its whole life it did not', () => {
  /*
   * `registerConsequence` had zero callers outside its own file. The flagship
   * mechanic — "the language is the gameplay, so it has to move the numbers" —
   * moved nothing whatsoever. Speaking roughly is an act now, and it costs.
   */
  const base = playState();
  const world = {
    ...base.world,
    people: { ...base.world.people, smith: { ...base.world.people['smith'], status: 'superior' as const } },
  };
  const rude = applyTurn({ ...base, world }, turn({ input: 'มึงเอาอะไรวะ' })).state.world.edges;

  assert.ok(axisOf(rude, 'smith', PLAYER, 'trust') < 0, 'roughness to a superior costs trust');
  assert.ok(axisOf(rude, 'smith', PLAYER, 'respect') < 0, 'and respect');
  assert.ok(axisOf(rude, 'smith', PLAYER, 'resentment') > 0, 'and is held against you');
});

test('roughness DOWNWARD frightens, which is what makes standing mean something', () => {
  // Fear is the axis the direction decides. (Resentment comes too, once the
  // deed layer lands on top — being threatened by somebody above you is both
  // frightening AND resented, and `register.test.ts` proves the register's own
  // half of that separately.)
  const feared = (status: 'superior' | 'inferior') => {
    const base = playState();
    const world = {
      ...base.world,
      people: { ...base.world.people, smith: { ...base.world.people['smith'], status } },
    };
    const after = applyTurn({ ...base, world }, turn({ input: 'มึงเอาอะไรวะ' })).state.world.edges;
    return axisOf(after, 'smith', PLAYER, 'fear');
  };

  assert.ok(feared('inferior') > 0, 'somebody below you is frightened');
  assert.equal(feared('superior'), 0, 'somebody above you is not');
});

test('relationships are folded, so a replayed session has the same ones', () => {
  // The determinism contract: the log is truth and the state is a fold. A
  // relationship that lived only in the live loop would vanish on reload,
  // which is the trap drift, the fight and the lossy snapshot all fell into.
  const base = playState();
  const record = turn({ delta: { trust: { smith: 2 } }, input: 'มึงเอาอะไรวะ' });

  const once = applyTurn(base, record).state.world.edges;
  const twice = applyTurn(base, record).state.world.edges;
  assert.deepEqual(once, twice);
});

/* -------------------------------------------------------------------------- */
/* The opening cast                                                            */
/* -------------------------------------------------------------------------- */

test('a generated cast opens with what it already thinks of you', () => {
  const edges: Edges = openingEdges({}, [{ id: 'warden', trust: -2 }, { id: 'smith', trust: 0 }]);
  assert.equal(trustToward(edges, 'warden'), -2, 'a warden is wary before you say a word');
  assert.equal(edgeBetween(edges, 'smith', PLAYER), null, 'and indifference stores nothing');
});

test('an opening edge never overwrites one already earned', () => {
  const held = nudge({}, 'kell', PLAYER, 'trust', 3);
  const after = openingEdges(held, [{ id: 'kell', trust: 1 }]);
  assert.equal(trustToward(after, 'kell'), 4, 'it adds, and clamps — it does not reset');
});

/*
 * 6b stage 5: a person whose grudge has gone far enough fights you. The axis is
 * RESENTMENT, not regard — contempt is not a grudge — and fear holds it back.
 */
test('a grudge they are not too afraid to act on makes them hostile', () => {
  const toward = (axes: Partial<Record<EdgeAxis, number>>) => nudgeAll({}, 'ora', PLAYER, axes);
  assert.equal(hostileToward(toward({ resentment: 3 }), 'ora'), true);
  assert.equal(hostileToward(toward({ resentment: 2 }), 'ora'), false, 'a grudge short of 3');
  assert.equal(hostileToward(toward({ resentment: 3, fear: 3 }), 'ora'), false, 'fear holds them back');
  assert.equal(hostileToward(toward({ regard: -3 }), 'ora'), false, 'contempt is not a grudge');
  assert.equal(hostileToward(toward(markOf('humiliated').onToward), 'ora'), true, 'a real deed reaches it');
});

test('the Director cannot swing a relationship end to end in one turn', () => {
  const capped = applyDelta(playState(), { trust: { smith: 99 } });
  assert.ok(trustToward(capped.world.edges, 'smith') <= EDGE_MAX);
});
