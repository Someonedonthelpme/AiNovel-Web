import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeProvider } from '../llm/provider.ts';
import { playTurn } from './turn.ts';
import { foldPlay } from './delta.ts';
import { crowdAround, figuresOn, inView, peopleHere, VIEW } from './onroad.ts';
import { populationAt } from '../character/population.ts';
import { playState } from './fixtures.ts';
import { speciesFor } from '../character/species.ts';
import { nudge, PLAYER } from '../social/edge.ts';
import { firsthand } from '../character/belief.ts';
import { hearOf, presentHere, sightingClaim } from './sighting.ts';
import { drawMap, fieldId, hubId, portalsOf } from '../world/map.ts';
import { routeOf } from '../world/route.ts';
import { clockOf, travelTime } from '../world/travel.ts';
import { groundFloor } from '../world/fixtures.ts';
import type { PlayState } from './state.ts';
import type { GameMap, Cell } from '../world/map.ts';

/*
 * W5 (DESIGN 6c §2c): a field carries the people crossing it. A grudge on the
 * road is MET there, not at the door of the place it was heading for.
 */

const noModel = () => ({ director: new FakeProvider({}), writer: new FakeProvider({}), rng: () => 0.5 });
const foesOf = (s: PlayState) => Object.values(s.combat?.combatants ?? {}).filter((c) => c.side === 'foe');
const FIELD = fieldId('floor-2', 'town', 'well');
const crowdOf = (s: PlayState) => (crowdAround(s.world, 2) ?? []).map((c) => c.subspecies);

/** Floor 2, dangerous, with the smith somewhere on it and the player in the town. */
function onFloorTwo(over: { resentment?: number } = {}): PlayState {
  const base = playState();
  const floor = { ...groundFloor(), id: 'floor-2', floor: 2, danger: 8, name: 'The Grey Grove' };
  const seen = sightingClaim(PLAYER, 'floor-2', 'town', 0);
  const smith = base.world.people.smith;
  return {
    ...base,
    world: {
      ...base.world,
      seed: 11,
      species: speciesFor(11),
      currentRegion: 'floor-2',
      regions: { 'floor-2': floor },
      currentPlace: 'town',
      people: { ...base.world.people, smith: { ...smith, beliefs: hearOf(smith.beliefs ?? [], firsthand(seen)) } },
      edges: nudge(base.world.edges, 'smith', PLAYER, 'resentment', over.resentment ?? 3),
    },
  };
}

/** The smith on the road from the well toward the town, `part` of the way across. */
function coming(s: PlayState, part: number): PlayState {
  const cost = travelTime(s.world, 'well', 'town');
  return {
    ...s,
    world: { ...s.world, journeys: [{ who: 'smith', for: 'smith', region: 'floor-2', place: 'well', progress: Math.floor(cost * part), departs: 0 }] },
  };
}

/** The player one step onto the field toward the well. */
function setOut(s: PlayState): PlayState {
  const field = drawMap(s.world, FIELD);
  const end = portalsOf(s.world, field).find((p) => 'to' in p && p.to === hubId('floor-2', 'town'))!;
  return { ...s, world: { ...s.world, at: { map: FIELD, x: end.x, y: end.y } } };
}

test('a traveller mid-link stands on that field, as far along as they have come', () => {
  const s = coming(onFloorTwo(), 0.5);
  const path = routeOf(s.world, 'well', 'town').path;
  const [figure] = figuresOn(s.world, FIELD);
  assert.equal(figure?.who, 'smith');
  assert.deepEqual({ x: figure.x, y: figure.y }, path[Math.floor((path.length - 1) * 0.5)]);
});

test('a traveller standing in a place is on no field', () => {
  const s = onFloorTwo();
  const inPlace = { ...s, world: { ...s.world, journeys: [{ who: 'smith', for: 'smith', region: 'floor-2', place: 'town', progress: 0, departs: 0 }] } };
  assert.deepEqual(figuresOn(inPlace.world, FIELD), []);
});

test('sight reaches twelve tiles, and not through a wall', () => {
  const open = { id: 't', kind: 'field', rows: Array.from({ length: 3 }, () => '.'.repeat(30)) } as GameMap;
  const at = (x: number, y = 1): Cell => ({ x, y });
  assert.equal(inView(open, at(0), at(VIEW)), true);
  assert.equal(inView(open, at(0), at(VIEW + 1)), false);
  const walled = { ...open, rows: ['.'.repeat(30), '.....#'.padEnd(30, '.'), '.'.repeat(30)] } as GameMap;
  assert.equal(inView(walled, { x: 4, y: 1 }, { x: 6, y: 1 }), false);
});

test('DONE: a grudge on the road is MET on a field', async () => {
  const s = setOut(coming(onFloorTwo(), 0.5));
  const r = await playTurn(noModel(), s, 'go to the dry well', 'exploration', []);
  assert.equal(r.record.delta.walkTo?.stop, 'sighted');
  assert.equal(r.record.delta.walkTo?.met, 'smith');
  assert.equal(r.state.world.at?.map, FIELD, 'met on the road, not at a door');
  assert.equal(foesOf(r.state)[0]?.person, 'smith');
  const replayed = foldPlay(s, [r.record]);
  assert.deepEqual(replayed.world.at, r.state.world.at, 'and replays without figures or tiles');
  assert.equal(clockOf(replayed.world), clockOf(r.state.world));
});

test('someone already in view when you set off does not stop you again', async () => {
  const first = await playTurn(noModel(), setOut(coming(onFloorTwo({ resentment: 0 }), 0.5)), 'go to the dry well', 'exploration', []);
  assert.equal(first.record.delta.walkTo?.stop, 'sighted', 'the first sight stops you');
  assert.equal(first.state.combat, null, 'nobody hostile, so no fight');
  const on = await playTurn(noModel(), first.state, 'go to the dry well', 'exploration', []);
  assert.notEqual(on.record.delta.walkTo?.stop, 'sighted');
  assert.ok((on.record.delta.walkTo?.seconds ?? 0) > 0, 'and you move');
});

test('a sighting on the road says who you saw', async () => {
  const r = await playTurn(noModel(), setOut(coming(onFloorTwo({ resentment: 0 }), 0.5)), 'go to the dry well', 'exploration', []);
  assert.match(r.record.prose, /Ora the smith/);
});

test('on a field, who is with you is who is in view — not the people of the place you left', () => {
  const alone = setOut(onFloorTwo());
  assert.deepEqual(peopleHere(alone).map((p) => p.id), []);
  const met = setOut(coming(onFloorTwo(), 0.5));
  assert.deepEqual(peopleHere({ ...met, world: { ...met.world, at: { ...met.world.at!, ...figuresOn(met.world, FIELD)[0] } } }).map((p) => p.id), ['smith']);
  assert.deepEqual(peopleHere(onFloorTwo()).map((p) => p.id).sort(), ['smith', 'warden']);
});

// The Director and the redaction wall read `presentHere`, which must stay free of
// tiles. On a field it is whoever you MET — never the people of the place you left,
// who are a road behind you.
test('out on the road, the Director is told nobody is with you until you meet somebody', () => {
  const alone = setOut(onFloorTwo());
  assert.deepEqual(presentHere(alone.world), []);
  const met = { ...alone, world: { ...alone.world, journeys: [{ who: 'smith', for: 'smith', region: 'floor-2', place: 'town', progress: 0, departs: 0 }] } };
  assert.deepEqual(presentHere(met.world), ['smith']);
  assert.deepEqual(presentHere(onFloorTwo().world).sort(), ['smith', 'warden']);
});

// A field belongs to both places it joins, so its crowd is drawn from both ends
// (DESIGN 6c §2c, W5) — a road between a settlement and the wild carries some of each.
test('a hunt on a field draws its crowd from both ends', () => {
  const s = setOut(onFloorTwo());
  // Every cohort of both ends, sizes and all: a road is as peopled as what it joins.
  assert.deepEqual(crowdOf(s).sort(), [
    ...(populationAt(s.world, 'floor-2', 'town', 2) ?? []).map((c) => c.subspecies),
    ...(populationAt(s.world, 'floor-2', 'well', 2) ?? []).map((c) => c.subspecies),
  ].sort());
  const inTown = onFloorTwo();
  assert.deepEqual(crowdOf(inTown).sort(),
    (populationAt(inTown.world, 'floor-2', 'town', 2) ?? []).map((c) => c.subspecies).sort());
});
