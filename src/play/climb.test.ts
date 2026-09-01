import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeProvider } from '../llm/provider.ts';
import { climb, exitStatus, godown } from './climb.ts';
import { playState } from './fixtures.ts';
import { groundFloor, world } from '../world/fixtures.ts';
import { isFull } from '../world/types.ts';

const floor1 = {
  name: 'The Grey Grove', biome: 'dead forest', culture: 'poachers',
  places: [
    { id: 'landing', name: 'the landing', kind: 'gate', description: '', connections: ['grove'], people: [], affordances: ['rest'] },
    { id: 'grove', name: 'the grove', kind: 'wild', description: '', connections: ['landing', 'rise'], people: [], affordances: ['search'] },
    { id: 'rise', name: 'the second stair', kind: 'gate', description: '', connections: ['grove'], people: [], affordances: ['climb'] },
  ],
  entrance: 'landing', exit: 'rise', people: [], creatures: ['wolf'],
};

const provider = () => new FakeProvider({ structured: [floor1] });

/** Standing on the ground-floor stair, with the way up already found. */
const atTheStair = () => playState({ currentPlace: 'stair', regions: { 'floor-0': groundFloor() } });

test('climbing from the stair generates the floor above and steps into it', async () => {
  const r = await climb(provider(), atTheStair());
  assert.equal(r.error, null);
  assert.equal(r.state.world.currentRegion, 'floor-1');
  assert.equal(r.state.world.currentPlace, 'landing');
  assert.equal(r.generated?.creatures[0], 'wolf');
  assert.equal(isFull(r.state.world.regions['floor-1']), true);
});

test('you cannot climb from anywhere but the way up', async () => {
  const r = await climb(provider(), playState({ currentPlace: 'town', regions: { 'floor-0': groundFloor() } }));
  assert.match(r.error ?? '', /not at the way up/);
});

test('you cannot climb before the way up has been found', async () => {
  const hidden = playState({ currentPlace: 'stair', regions: { 'floor-0': { ...groundFloor(), exit: null } } });
  assert.match((await climb(provider(), hidden)).error ?? '', /has not been found/);
});

test('you cannot descend from ground level', async () => {
  const r = await godown(provider(), playState({ currentPlace: 'gate', regions: { 'floor-0': groundFloor() } }));
  assert.match(r.error ?? '', /already at ground level/);
});

test('a floor already loaded is entered without regenerating it', async () => {
  const first = await climb(provider(), atTheStair());
  // Walk to the stair on floor 1, then back down and up again.
  const p = new FakeProvider({ structured: [] });
  const down = await godown(p, first.state);
  assert.equal(down.error, null);
  assert.equal(down.state.world.currentRegion, 'floor-0');
  assert.equal(p.calls.length, 0, 'the floor below was still loaded, so nothing was generated');
});

test('exitStatus reports where you can leave from', () => {
  assert.deepEqual(exitStatus(atTheStair()), { canClimb: true, canDescend: false });
  const mid = playState({ currentPlace: 'town', regions: { 'floor-0': groundFloor() } });
  assert.deepEqual(exitStatus(mid), { canClimb: false, canDescend: false });
});

test('a compressed floor is rebuilt rather than left unreachable', async () => {
  const first = await climb(provider(), atTheStair());
  // Simulate having climbed far enough that floor 1 compressed behind us.
  const compressed = {
    ...first.state,
    world: { ...first.state.world, currentRegion: 'floor-0', currentPlace: 'stair' },
  };
  const p = new FakeProvider({ structured: [floor1] });
  const again = await climb(p, {
    ...compressed,
    world: {
      ...compressed.world,
      regions: {
        ...compressed.world.regions,
        'floor-1': {
          detail: 'gazetteer' as const, id: 'floor-1', floor: 1, name: 'The Grey Grove',
          biome: 'dead forest', summary: 'grey trees, poachers', knownPeople: [],
          openThreads: [], reputation: 0, compressedAtTurn: 4,
        },
      },
    },
  });
  assert.equal(again.error, null);
  assert.equal(again.state.world.currentRegion, 'floor-1');
  assert.equal(p.calls.length, 1, 'rehydrated from the gazetteer');
});
