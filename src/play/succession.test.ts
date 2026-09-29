import test from 'node:test';
import assert from 'node:assert/strict';
import { holderUnder } from './succession.ts';
import { holderOf } from '../world/holding.ts';
import { person, place, world } from '../world/fixtures.ts';
import { nudge, PLAYER } from '../social/edge.ts';
import type { AlUnit, SuccessionLawId } from '../world/al.ts';
import type { Person, Place, World } from '../world/types.ts';

/*
 * DESIGN 6c §3k-i: `successionOf` finally has a reader. Who holds a settlement
 * nobody bought is derived from who is there; the AL unit's succession law says HOW.
 * `standing` (highest status) is today's behaviour; `stationRank` ranks by absolute
 * `Station`; `elective` is the SUM of what everyone else present trusts each candidate.
 */

const units = (law?: SuccessionLawId): Record<string, AlUnit> => ({
  v: { id: 'v', kind: 'village', parent: 'd' },
  d: { id: 'd', kind: 'district', parent: 's', ...(law ? { succession: law } : {}) },
  s: { id: 's', kind: 'state' },
});

// `lord` outranks by status but is a plain villager by station; `guard` is a watcher by
// trade, so `standing` and `stationRank` disagree about who is first.
function cast(over: Record<string, Partial<Person>> = {}): World {
  const w = world();
  const watcher = { background: { id: 'watcher' } } as never;
  return {
    ...w,
    people: {
      lord: person('lord', { status: 'superior', ...over.lord }),
      guard: person('guard', { status: 'peer', sheet: watcher, ...over.guard }),
      clerk: person('clerk', { status: 'peer', ...over.clerk }),
    },
  };
}
const village = (over: Partial<Place> = {}): Place => place('hamlet', { kind: 'settlement', people: ['lord', 'guard', 'clerk'], alUnit: 'v', ...over });
const under = (w: World, law?: SuccessionLawId, p: Place = village()) => holderUnder(w, { alUnits: units(law) }, p);

test('with no law set, the holder is exactly what holderOf says', () => {
  const w = cast();
  assert.equal(under(w), holderOf(village(), w.people));
  assert.equal(under(w), 'lord');
});

test('stationRank: the highest Station wins even where standing would pick another', () => {
  assert.equal(under(cast(), 'stationRank'), 'guard');
});

test('elective: the person the OTHERS trust most, not the highest-ranked', () => {
  let edges = nudge({}, 'lord', 'guard', 'trust', 3);
  edges = nudge(edges, 'clerk', 'guard', 'trust', 2);
  edges = nudge(edges, 'guard', 'lord', 'trust', 1);
  assert.equal(under({ ...cast(), edges }, 'elective'), 'guard');
});

test('elective sums trust rather than averaging it: two +2s beat one +3', () => {
  let edges = nudge({}, 'lord', 'guard', 'trust', 2);
  edges = nudge(edges, 'clerk', 'guard', 'trust', 2);     // guard: sum 4, mean 2
  edges = nudge(edges, 'lord', 'clerk', 'trust', 3);      // clerk: sum 3, mean 3
  assert.equal(under({ ...cast(), edges }, 'elective'), 'guard');
});

test('a village with no law of its own follows its parent district', () => {
  assert.equal(units('stationRank').v.succession, undefined);
  assert.equal(under(cast(), 'stationRank'), 'guard');
});

test('a stored holder is never overridden by any law', () => {
  for (const law of ['standing', 'stationRank', 'elective'] as const) {
    assert.equal(under(cast(), law, village({ holder: PLAYER })), PLAYER);
  }
});

test('the dead never inherit under any law', () => {
  const w = cast({ guard: { alive: false } });
  assert.equal(under(w, 'stationRank'), 'lord');
});

test('elective ties fall back to standing', () => {
  assert.equal(under(cast(), 'elective'), 'lord');   // nobody trusts anybody: all sums 0
});
