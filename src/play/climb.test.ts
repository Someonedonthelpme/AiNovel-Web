import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeProvider } from '../llm/provider.ts';
import { applyClimb, climb, exitStatus, godown } from './climb.ts';
import { clockOf, stairCost } from '../world/travel.ts';
import { foldPlay } from './delta.ts';
import { playState } from './fixtures.ts';
import { generatedFloor, groundFloor, person, world } from '../world/fixtures.ts';
import { generateFloor } from '../world/floorgen.ts';
import { compressExcept } from '../world/lod.ts';
import { RESETS } from '../world/types.ts';
import type { Reset } from '../world/types.ts';
import { axisOf, nudge, PLAYER } from '../social/edge.ts';
import { populationAt } from '../character/population.ts';
import { speciesFor } from '../character/species.ts';
import { journeysOf } from './journey.ts';
import { applyTurn } from './delta.ts';
import type { PlayState, TurnRecord } from './state.ts';
import { isFull } from '../world/types.ts';
import type { PlaceKind, Region } from '../world/types.ts';
import { adopt, believes, firsthand } from '../character/belief.ts';
import { xpToNext } from './progress.ts';
import { ruleClaim, STANDARD } from '../rules/ruleset.ts';
import { signetsFor } from './signetbook.ts';

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

/** The floor `floor1` describes, as a region a record can carry. */
const builtFloor = (): Region => ({
  detail: 'full',
  id: 'floor-1', floor: 1, name: floor1.name, biome: floor1.biome, culture: floor1.culture,
  danger: 1,
  places: floor1.places.map((p) => ({ ...p, kind: p.kind as PlaceKind, discovered: false })),
  entrance: floor1.entrance, exit: floor1.exit, creatures: floor1.creatures,
});

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

/* -------------------------------------------------------------------------- */
/* A climb is an event                                                         */
/* -------------------------------------------------------------------------- */

/*
 * The regression these guard.
 *
 * Floor generation is the one model call that changes world state, and it used
 * to reach storage only inside a snapshot — so replaying a climbed session
 * landed on a `currentRegion` naming a region that was not there, and the
 * counters and depth experience the crossing paid went with it. `foldPlay` is
 * synchronous and holds no Provider, so it could never rebuild either.
 */

test('a climb produces a record carrying the floor it had to build', async () => {
  const r = await climb(provider(), atTheStair());
  assert.equal(r.record?.kind, 'climb');
  assert.equal(r.record?.direction, 'up');
  assert.equal(r.record?.built?.region.name, 'The Grey Grove');
});

test('replaying that record reaches the same state, with no provider', async () => {
  const start = atTheStair();
  const live = await climb(provider(), start);

  // Exactly what a load with every snapshot deleted would do.
  const replayed = foldPlay(start, [live.record!]);

  assert.equal(replayed.world.currentRegion, 'floor-1');
  assert.equal(replayed.world.currentPlace, 'landing');
  assert.equal(isFull(replayed.world.regions['floor-1']), true);
  assert.equal(replayed.world.deepestFloor, live.state.world.deepestFloor);
  assert.deepEqual(replayed.sheet.counters, live.state.sheet.counters);
  assert.equal(replayed.sheet.xp, live.state.sheet.xp);
  assert.equal(replayed.sheet.level, live.state.sheet.level);
});

test('a crossing onto a floor already loaded records no floor, and still replays', async () => {
  const start = atTheStair();
  const up = await climb(provider(), start);
  const down = await godown(new FakeProvider({ structured: [] }), up.state);

  assert.equal(down.record?.built, null, 'nothing was generated, so nothing is stored');

  const replayed = foldPlay(start, [up.record!, down.record!]);
  assert.equal(replayed.world.currentRegion, 'floor-0');
  assert.equal(replayed.world.turn, down.state.world.turn);
});

/* -------------------------------------------------------------------------- */
/* A LAW IS LEARNED BY HITTING IT                                              */
/* -------------------------------------------------------------------------- */

test('a refused descent teaches the player the rule', async () => {
  const r = await godown(provider(), playState());

  assert.match(r.error ?? '', /already at ground level/);
  assert.ok(
    believes(r.state.sheet.beliefs ?? [], ruleClaim('descendBelowGround')),
    'running into a law is how somebody finds out it is there',
  );
});

test('the lesson survives a fold, which is why a refusal is logged at all', async () => {
  const start = playState();
  const live = await godown(provider(), start);

  assert.ok(live.record, 'a refused attempt must still reach the log or the lesson dies on reload');

  // Exactly what a load with every snapshot deleted would do.
  const replayed = foldPlay(start, [live.record!]);
  assert.ok(believes(replayed.sheet.beliefs ?? [], ruleClaim('descendBelowGround')));
});

test('a world that permits digging teaches nothing about it', async () => {
  const base = playState();
  const free = { ...base, world: { ...base.world, rules: { ...STANDARD, laws: [] } } };

  const r = await godown(provider(), free);
  assert.ok(!believes(r.state.sheet.beliefs ?? [], ruleClaim('descendBelowGround')));
});


test('a Signet is a rule exemption: its holder digs where the law stops everyone else', async () => {
  // The design's whole claim for Signets, and the first thing `Signet` has ever
  // done that a stat line could not. Standing at the way down, under a law that
  // binds everyone: the difference between the two runs is one held Signet.
  const atTheGate = playState({ currentPlace: 'gate', regions: { 'floor-0': groundFloor() } });

  const exemption = signetsFor(atTheGate).kept.find((s) => s.exempts);
  assert.ok(exemption, 'a world under a law must hide one Signet that sets it aside');
  assert.equal(exemption.exempts, 'descendBelowGround');

  const refused = await godown(provider(), atTheGate);
  assert.match(refused.error ?? '', /already at ground level/);

  const holder = { ...atTheGate, sheet: { ...atTheGate.sheet, signets: [exemption.id] } };
  const dug = await godown(provider(), holder);
  assert.equal(dug.error, null, 'the law does not bind the holder of its exemption');
  assert.equal(dug.state.world.currentRegion, 'floor--1');
});

test('the exemption belongs to the holder, and the panel agrees', () => {
  // exitStatus had its own copy of "the ground is the bottom" (`floor > 0`),
  // which no law could reach — the panel would hide the way down in a world
  // whose law permits digging, and for the one person exempt from it.
  const atTheGate = playState({ currentPlace: 'gate', regions: { 'floor-0': groundFloor() } });
  assert.equal(exitStatus(atTheGate).canDescend, false);

  const exemption = signetsFor(atTheGate).kept.find((s) => s.exempts)!;
  const holder = { ...atTheGate, sheet: { ...atTheGate.sheet, signets: [exemption.id] } };
  assert.equal(exitStatus(holder).canDescend, true);

  const lawless = { ...atTheGate, world: { ...atTheGate.world, rules: { ...STANDARD, laws: [] } } };
  assert.equal(exitStatus(lawless).canDescend, true, 'a world that permits digging shows the way down');
});

test('a world that forbids levelling stops the climb paying out, and banks it', async () => {
  // The depth reward and the fight reward are the only two ways a level is ever
  // bought, so the law has to hold at both. This is the one the panel shows.
  // Poised one point short of level 2, so the crossing decides it either way.
  const poised = playState({ currentPlace: 'stair', regions: { 'floor-0': groundFloor() } });
  const brink = { ...poised, sheet: { ...poised.sheet, xp: xpToNext(1) - 1 } };

  const rose = await climb(provider(), brink);
  assert.equal(rose.state.sheet.level, 2, 'without the law, that crossing is a level');

  const capped = {
    ...brink,
    world: { ...brink.world, rules: { ...STANDARD, laws: [
      { axis: 'progression' as const, constraint: 'gainLevels' as const, binds: 'all' as const },
    ] } },
  };
  const held = await climb(provider(), capped);

  assert.equal(held.error, null);
  assert.ok(held.xp > 0, 'the depth is still worth something');
  assert.equal(held.levelled, null, 'but nobody rises in a world whose law forbids it');
  assert.equal(held.state.sheet.level, 1);
  assert.equal(held.state.sheet.xp, xpToNext(1) - 1 + held.xp, 'banked, not burnt');
});

test('a world whose law resets memory keeps nothing across the crossing', async () => {
  // The knowledge axis, and the design's own example: "memories do not reset"
  // is a RULE, which means a world can be written where they do. The reset
  // happens in the fold, on arrival, so a replay forgets in the same places.
  const base = playState({ currentPlace: 'stair', regions: { 'floor-0': groundFloor() } });
  const knowing = {
    ...base,
    sheet: { ...base.sheet, beliefs: adopt([], firsthand(ruleClaim('descendBelowGround'))) },
  };

  const ordinary = await climb(provider(), knowing);
  assert.ok(
    believes(ordinary.state.sheet.beliefs ?? [], ruleClaim('descendBelowGround')),
    'an ordinary world carries what you worked out up the stairs with you',
  );

  const resetting = {
    ...knowing,
    world: { ...knowing.world, rules: { ...STANDARD, laws: [
      { axis: 'knowledge' as const, constraint: 'keepMemories' as const, binds: 'all' as const },
    ] } },
  };
  const forgot = await climb(provider(), resetting);

  assert.equal(forgot.error, null);
  assert.deepEqual(forgot.state.sheet.beliefs ?? [], [], 'and this one arrives knowing nothing');
});

/* -------------------------------------------------------------------------- */
/* CROSSINGS THAT ARE NEITHER UP NOR DOWN                                      */
/* -------------------------------------------------------------------------- */

test('a world that is not a stack is walked sideways, and the log replays it', () => {
  // A crossing was always "up" or "down", which is only true of a tower. An
  // outer world is a structure with its own connections, and the record has to
  // be able to say WHERE rather than which direction.
  const hub = { ...groundFloor(), id: 'outer-hub', floor: 0,
    exits: [{ to: 'outer-market', via: 'gate', floor: 0 }] };
  const market = { ...groundFloor(), id: 'outer-market', floor: 0, name: 'The Salt Market',
    exits: [{ to: 'outer-hub', via: 'gate', floor: 0 }] };

  const outer = playState({
    currentRegion: 'outer-hub',
    currentPlace: 'gate',
    regions: { 'outer-hub': hub, 'outer-market': market },
  });

  const record = { kind: 'climb' as const, direction: 'up' as const, to: 'outer-market', built: null };
  const moved = applyClimb(outer, record);

  assert.equal(moved.error, null);
  assert.equal(moved.state.world.currentRegion, 'outer-market');

  const replayed = foldPlay(outer, [record]);
  assert.equal(replayed.world.currentRegion, 'outer-market', 'and a reload walks the same way');
});

test('a floor can begin a new wing, and the wing survives a fold', () => {
  // "Four dungeons inside a twenty-floor tower" needs somebody to say where a
  // dungeon starts. Nothing could: genesis wrote the root tower and nothing
  // ever added another, so nesting had a reader and no writer.
  const base = playState({ currentPlace: 'stair', regions: { 'floor-0': groundFloor() } });
  const wing = {
    id: 'wing-1', name: 'The Sunken Wing', kind: 'static' as const, parent: 'tower',
    from: 1, to: 3, theme: { biome: 'flooded stone', culture: 'divers', people: 'salvagers' },
  };

  const record = {
    kind: 'climb' as const,
    direction: 'up' as const,
    built: { region: builtFloor(), people: {}, stratum: wing },
  };

  const climbed = applyClimb(base, record);
  assert.equal(climbed.error, null);
  assert.deepEqual(climbed.state.world.strata?.['wing-1'], wing, 'the wing is part of the world now');

  const replayed = foldPlay(base, [record]);
  assert.deepEqual(replayed.world.strata?.['wing-1'], wing, 'and a reload still knows about it');
});

// W3: a stair is abstract, so where you stood on the floor below means nothing above.
test('a climb clears your place on the map: you arrive at the centre of the landing', async () => {
  const stair = atTheStair();
  const before = { ...stair, world: { ...stair.world, at: { map: 'hub:floor-0:stair', x: 3, y: 4 } } };
  const r = await climb(provider(), before);
  assert.equal(r.error, null);
  assert.equal(r.state.world.at, undefined);
});

// 6b stage 7.1b: a climb is a crossing too, so it covers time on the world clock.
test('climbing covers time on the clock', async () => {
  // A clock that is not the turn count, or a world reading its turns would pass this for free.
  const stair = atTheStair();
  const before = { ...stair, world: { ...stair.world, clock: 100 } };
  const r = await climb(provider(), before);
  assert.equal(r.error, null);
  // Respecified by 7.1e-i: a stair takes hours (`stairCost`), not a place link's minutes.
  assert.equal(clockOf(r.state.world), 100 + stairCost(before.world, 'floor-0', 'floor-1'));
});

/* -------------------------------------------------------------------------- */
/* 6c, the first stratum law: a LOOP resets a floor until it is cleared         */
/* -------------------------------------------------------------------------- */

/** A tower whose floors 1–5 carry this reset law, standing at the ground stair. */
function loopTower({ holder = true, law = 'untilCleared' as Reset | null } = {}) {
  const base = atTheStair();
  const start: PlayState = {
    ...base,
    world: {
      ...base.world,
      seed: 11,
      species: speciesFor(11),
      strata: { tower: { id: 'tower', name: 'The Tower', kind: 'dynamic', from: 1, to: 5, ...(law ? { laws: { reset: law } } : {}) } },
    },
  };
  const floor = builtFloor();
  const region: Region = {
    ...floor,
    places: floor.places.map((p) => (p.id === 'grove' ? { ...p, people: ['keeper'] } : p)),
    ...(holder ? { boss: 'keeper' } : {}),
  };
  const up = {
    kind: 'climb' as const,
    direction: 'up' as const,
    built: { region, people: { keeper: person('keeper', { name: 'Keeper Ysolt', homeRegion: 'floor-1' }) }, edges: {} },
  };
  return { start, up };
}

const down = { kind: 'climb' as const, direction: 'down' as const, built: null };

/** Climb onto the floor, change what is there, walk back to the stair and leave. */
function liveThenLeave(
  tower: ReturnType<typeof loopTower>,
  { kill = false, survivor = false, keeperSetsOut = false, keeperDies = false } = {},
) {
  const built = applyClimb(tower.start, tower.up).state;
  const w = built.world;
  const here = w.regions['floor-1'] as Region;
  const survivorId = 'survivor:floor-1:4:foe1';
  const lived: PlayState = {
    ...built,
    sheet: { ...built.sheet, xp: (built.sheet.xp ?? 0) + 5 },
    pc: { ...built.pc, coin: built.pc.coin + 7 },
    world: {
      ...w,
      currentPlace: 'landing',
      facts: [...w.facts, { id: 'f-keeper', text: 'the keeper lies about the stair', region: 'floor-1', people: ['keeper'], establishedAtTurn: w.turn }],
      regions: { ...w.regions, 'floor-1': { ...here, places: here.places.map((p) => ({ ...p, discovered: true })) } },
      people: {
        ...w.people,
        keeper: { ...w.people.keeper, oneLine: 'has seen you before', ...(keeperDies ? { alive: false } : {}) },
        ...(survivor ? { [survivorId]: person(survivorId, { homeRegion: 'floor-1' }) } : {}),
      },
      edges: nudge(w.edges ?? {}, 'keeper', PLAYER, 'resentment', 3),
      reputation: { ...w.reputation, 'floor-1': 2 },
      ...(kill ? { populations: { ...w.populations, grove: [] } } : {}),
      ...(keeperSetsOut ? { journeys: [{ who: 'keeper', for: 'keeper', region: 'floor-1', place: 'grove', progress: 0, departs: 0 }] } : {}),
    },
  };
  const left = applyClimb(lived, down);
  assert.equal(left.error, null, 'the way down has to be open for this to say anything');
  return { built, lived, back: left.state, survivorId };
}

test('the reset vocabulary is closed, and a stratum without the law never resets', () => {
  assert.deepEqual([...RESETS], ['never', 'untilCleared']);
  const { back } = liveThenLeave(loopTower({ law: null }));   // null, not undefined: undefined takes the default
  assert.equal(axisOf(back.world.edges ?? {}, 'keeper', PLAYER, 'resentment'), 3, 'what you did stays');
});

test('leaving an uncleared loop floor puts its places and people back as they were built', () => {
  const { built, back } = liveThenLeave(loopTower());
  assert.deepEqual(back.world.regions['floor-1'], built.world.regions['floor-1']);
  assert.deepEqual(back.world.people.keeper, built.world.people.keeper);
});

test('and their feelings toward you', () => {
  const { back } = liveThenLeave(loopTower());
  assert.equal(axisOf(back.world.edges ?? {}, 'keeper', PLAYER, 'resentment'), 0);
  assert.equal(back.world.reputation?.['floor-1'] ?? 0, 0);
});

test('and its crowd', () => {
  const { built, lived, back } = liveThenLeave(loopTower(), { kill: true });
  assert.notDeepEqual(populationAt(lived.world, 'floor-1', 'grove', 1), populationAt(built.world, 'floor-1', 'grove', 1), 'the killing has to show');
  assert.deepEqual(populationAt(back.world, 'floor-1', 'grove', 1), populationAt(built.world, 'floor-1', 'grove', 1));
});

test('the player keeps memories, items and XP', () => {
  const { lived, back } = liveThenLeave(loopTower());
  assert.deepEqual(back.world.facts, lived.world.facts);
  assert.deepEqual(back.pc.inventory, lived.pc.inventory);
  assert.equal(back.pc.coin, lived.pc.coin);
  assert.equal(back.sheet.xp, lived.sheet.xp);
});

test('whoever the loop made there goes with it, and nobody from there is on the road', () => {
  const { back, survivorId } = liveThenLeave(loopTower(), { survivor: true, keeperSetsOut: true });
  assert.equal(back.world.people[survivorId], undefined);
  assert.equal(journeysOf(back.world).some((j) => j.who === 'keeper'), false);
});

test('a floor whose holder is dead is cleared, and stays as you left it', () => {
  const { back } = liveThenLeave(loopTower(), { keeperDies: true });
  assert.equal(back.world.people.keeper.alive, false);
  assert.equal(axisOf(back.world.edges ?? {}, 'keeper', PLAYER, 'resentment'), 3);
});

test('a loop floor with no holder has nothing to clear, so it never resets', () => {
  const { built, back } = liveThenLeave(loopTower({ holder: false }));
  assert.notDeepEqual(back.world.regions['floor-1'], built.world.regions['floor-1']);
});

test('a loop floor is never compressed — the reset needs it exactly', () => {
  const w = compressExcept(liveThenLeave(loopTower()).back.world, [], 9);
  assert.equal(isFull(w.regions['floor-1']), true);
});

test('the reset replays from the log', () => {
  const { start, up } = loopTower();
  const turn = (delta: TurnRecord['delta']): TurnRecord => ({
    kind: 'turn', input: '', mode: 'exploration', classification: 'NEUTRAL', addressed: null,
    roll: null, delta, rejected: [], prose: '',
  });
  const records = [up, turn({ moveTo: 'grove', trust: { keeper: -2 } }), turn({ moveTo: 'landing' }), down];
  let live = start;
  for (const r of records) live = r.kind === 'climb' ? applyClimb(live, r).state : applyTurn(live, r).state;
  assert.equal(live.world.currentRegion, 'floor-0', 'the walk has to end back down');
  assert.deepEqual(foldPlay(start, records), live);
  assert.equal(axisOf(live.world.edges ?? {}, 'keeper', PLAYER, 'trust'), 0, 'and the reset is in it');
});

test('with its holder, a band floor loops: left uncleared, it is put back', async () => {
  // Floor 1 of the band, built by the floor generator — no hand-made holder.
  const { start } = loopTower();
  const inBand = {
    ...start.world,
    strata: {
      tower: { id: 'tower', name: 'the tower', kind: 'dynamic' as const, from: 0 },
      loop: { id: 'loop', name: 'the loop', kind: 'dynamic' as const, parent: 'tower', from: 1, to: 10, laws: { reset: 'untilCleared' as const } },
    },
  };
  const r = await generateFloor(new FakeProvider({ structured: [generatedFloor({ bossName: 'Ysolt', bossOneLine: 'keeps this floor' })] }), inBand, 1, start.sheet);
  assert.ok(r.region.boss, 'the generator has to have made a holder for this to say anything');
  const up = { kind: 'climb' as const, direction: 'up' as const, built: { region: r.region, people: r.people, edges: r.edges } };

  const built = applyClimb({ ...start, world: inBand }, up).state;
  const here = built.world.regions[r.region.id] as Region;
  const lived: PlayState = {
    ...built,
    world: {
      ...built.world,
      currentPlace: here.entrance,
      regions: { ...built.world.regions, [here.id]: { ...here, places: here.places.map((p) => ({ ...p, discovered: true })) } },
    },
  };
  const back = applyClimb(lived, down).state;
  assert.equal(back.world.currentRegion, 'floor-0');
  assert.deepEqual(back.world.regions[r.region.id], built.world.regions[r.region.id]);
});

test("climbing into an unthemed era band gives it the first floor's land, and a fold keeps it", async () => {
  const strata = {
    tower: { id: 'tower', name: 'the tower', kind: 'dynamic' as const, from: 0 },
    era: { id: 'era', name: 'the eras', kind: 'dynamic' as const, parent: 'tower', from: 1, to: 10, laws: { time: 'era' as const } },
  };
  const base = playState({ currentPlace: 'stair', regions: { 'floor-0': groundFloor() }, strata });
  const r = await climb(provider(), base);
  const record = r.record!;
  const land = record.built!.region;
  const theme = { biome: land.biome, culture: land.culture, people: land.culture };
  assert.deepEqual(r.state.world.strata?.era?.theme, theme);
  assert.deepEqual(foldPlay(base, [record]).world.strata?.era?.theme, theme, 'and a reload still knows it');
});
