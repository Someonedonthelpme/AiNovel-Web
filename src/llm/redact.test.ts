import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNoLeak, hiddenStrings, toWriterView } from './redact.ts';
import { playState } from '../play/fixtures.ts';
import { firstFloor, groundFloor, world } from '../world/fixtures.ts';
import { moveWithinRegion } from '../world/travel.ts';
import type { PlayState } from '../play/state.ts';

const brief = { intent: 'describe', mustInclude: [], mustNotMention: [], tone: 'plain', length: 'short' as const };

const at = (place: string): PlayState => {
  const base = playState();
  return { ...base, world: { ...base.world, currentPlace: place } };
};

/* -------------------------------------------------------------------------- */
/* The guard still guards                                                      */
/* -------------------------------------------------------------------------- */

test('places the player has not found and cannot see are hidden', () => {
  // Standing at the gate, only the town is connected; everything past it is
  // out of sight.
  const hidden = hiddenStrings(at('gate').world);
  assert.ok(hidden.includes('the dry well'), 'an unvisited place two steps away is a secret');
  assert.ok(hidden.includes('the first stair'));
  assert.ok(hidden.includes('the covered market'));
});

test('a name the map already shows is not a secret, but what is inside it still is', () => {
  // Regression: the local map labels every connected place and the game offers
  // "go to <name>" as a suggestion. Treating those names as secrets made the
  // guard contradict the interface, and the turn died instead of the spoiler.
  const region = { ...groundFloor() };
  region.places = region.places.map((p) =>
    p.id === 'well' ? { ...p, description: 'a rope still hangs into the dark' } : p,
  );
  const w = world({ currentPlace: 'town', regions: { 'floor-0': region } });

  const hidden = hiddenStrings(w);
  assert.ok(!hidden.includes('the dry well'), 'its name is on the map and in the suggestions');
  assert.ok(hidden.includes('a rope still hangs into the dark'), 'what you would find there is not');
});

test('everything on another floor is hidden, discovered or not', () => {
  const w = world({
    currentPlace: 'town',
    regions: { 'floor-0': groundFloor(), 'floor-1': firstFloor() },
  });
  const hidden = hiddenStrings(w);
  assert.ok(hidden.includes('the grey grove'), 'the Writer has no business knowing what is upstairs');
});

test('a leaked secret is caught rather than narrated', () => {
  const state = at('gate');
  const view = toWriterView(state, { brief, canonFacts: ['a rumour about the dry well'] });
  assert.throws(() => assertNoLeak(view, state.world), /leaked hidden content/);
});

test('a Director brief cannot smuggle a secret past the boundary', () => {
  const state = at('gate');
  const view = toWriterView(state, {
    brief: { ...brief, mustInclude: ['hint at the first stair'] },
  });
  assert.throws(() => assertNoLeak(view, state.world), /leaked hidden content/);
});

/* -------------------------------------------------------------------------- */
/* ...but the ground under your feet is not a secret                           */
/* -------------------------------------------------------------------------- */

test('the place you are standing in is never hidden', () => {
  // Regression: genesis built every place with `discovered: false`, so the floor
  // the player opened on counted among the world's secrets.
  assert.ok(!hiddenStrings(at('town').world).includes('Ashfall'));
  assert.ok(!hiddenStrings(at('gate').world).includes('the low gate'));
});

test('prose the player has already read is not scanned for secrets', () => {
  // Regression: what is visible changes as you walk, so a place named while
  // standing beside it turned into a "leak" one step later — and every turn
  // that remembered it died.
  const state = at('gate');
  const view = toWriterView(state, { brief, recentTurns: ['They spoke of the first stair.'] });
  assert.doesNotThrow(() => assertNoLeak(view, state.world));

  // ...but a secret arriving anywhere else is still caught.
  const leaking = toWriterView(state, { brief, canonFacts: ['the first stair is bricked up'] });
  assert.throws(() => assertNoLeak(leaking, state.world), /leaked hidden content/);
});

test('walking somewhere new does not trip the leak check on the place you left', () => {
  // Regression: this made EVERY move fail with a 500. The previous place's name
  // is in `recentTurns` verbatim, so the moment it counted as hidden the turn
  // could never be written.
  const before = at('town');
  const moved = moveWithinRegion(before.world, 'well');
  assert.equal(moved.kind, 'moved');
  if (moved.kind !== 'moved') return;

  const state: PlayState = { ...before, world: moved.world };
  const view = toWriterView(state, { brief, recentTurns: ['Anan left Ashfall behind.'] });
  assert.doesNotThrow(() => assertNoLeak(view, state.world));
});

test('a name the map has shown stays shown after you walk on', () => {
  // Regression: the guard runs against the world AFTER the move, but the
  // Director's brief was written for the scene BEFORE it. With an adjacency-only
  // rule the neighbours of the room you just left became secrets mid-turn, and
  // every such turn died with a leak error.
  const before = at('town');
  assert.ok(!hiddenStrings(before.world).includes('the covered market'));

  const moved = moveWithinRegion(before.world, 'stair');
  assert.equal(moved.kind, 'moved');
  if (moved.kind !== 'moved') return;

  assert.ok(
    !hiddenStrings(moved.world).includes('the covered market'),
    'the town is discovered, so its neighbours stay named',
  );
});

test('leaving a place discovers it, because you were there', () => {
  const moved = moveWithinRegion(at('town').world, 'well');
  assert.equal(moved.kind, 'moved');
  if (moved.kind !== 'moved') return;
  const byId = new Map(moved.world.regions['floor-0'].detail === 'full'
    ? moved.world.regions['floor-0'].places.map((p) => [p.id, p])
    : []);
  assert.equal(byId.get('town')?.discovered, true, 'the place you walked out of');
  assert.equal(byId.get('well')?.discovered, true, 'and the one you walked into');
});

test('a walk across the whole floor never leaks', () => {
  // The real failure was cumulative: every place visited stays in the prose.
  let state = at('town');
  const history: string[] = ['Ashfall'];

  for (const step of ['well', 'town', 'market', 'town', 'stair']) {
    const moved = moveWithinRegion(state.world, step);
    assert.equal(moved.kind, 'moved', `could not walk to ${step}`);
    if (moved.kind !== 'moved') return;
    state = { ...state, world: moved.world };

    const view = toWriterView(state, { brief, recentTurns: [...history] });
    assert.doesNotThrow(() => assertNoLeak(view, state.world), `leaked after walking to ${step}`);
    history.push(view.place.name);
  }
});
