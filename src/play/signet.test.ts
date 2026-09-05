import test from 'node:test';
import { dispositionOf } from '../character/persona.ts';
import assert from 'node:assert/strict';
import { admissible, gateOpen, unsatisfiable, validateSignet, visibleSignets } from './signet.ts';
import type { Gate, Reachable, Signet } from './signet.ts';
import { CANDIDATE_SIGNETS, DROPPABLE_FAMILIES, reachableIn, signetsFor, TOWER_HORIZON } from './signetbook.ts';
import { COUNTERS } from './traits.ts';
import type { TraitContext } from './traits.ts';
import { addItem } from '../items/types.ts';
import { material } from '../items/catalogue.ts';
import { mulberry32 } from '../engine/roll.ts';
import { playState } from './fixtures.ts';
import { applySheetAction, sheetRecord } from './sheetaction.ts';
import { foldPlay } from './delta.ts';
import type { PlayState } from './state.ts';

const ctxOf = (state: PlayState): TraitContext => ({
  sheet: state.sheet,
  inventory: state.pc.inventory,
  counters: state.sheet.counters,
  personality: dispositionOf(state.sheet),
});

const world = (over: Partial<PlayState['world']> = {}) => ({ flags: {}, deepestFloor: 0, ...over });

const signet = (gate: Gate, over: Partial<Signet> = {}): Signet => ({
  id: 'test', name: 'Test', description: '',
  augments: { kind: 'trait', id: 'blooded' },
  gate, grant: {}, discovery: 'hidden', ...over,
});

/* -------------------------------------------------------------------------- */
/* Proving a gate can ever open                                                */
/* -------------------------------------------------------------------------- */

test('every shipped Signet can actually be obtained', () => {
  // The one that matters. A Signet behind a gate this tower cannot satisfy is
  // indistinguishable, from inside the game, from one that is merely well
  // hidden — the player would search forever and never be told.
  const checked = signetsFor(playState());
  assert.deepEqual(
    checked.discarded.map((d) => `${d.signet.id}: ${d.why.join('; ')}`),
    [],
    'these would be unobtainable and must be fixed or removed',
  );
  // A count against the authored list means nothing now that the candidates are
  // generated; what matters is that a world is never left with none.
  assert.ok(checked.kept.length > 0, 'a world with no obtainable Signets has no third branch at all');
});

test('a gate demanding something the tower never drops is refused', () => {
  const reach = reachableIn(playState());
  const impossible = signet({ kind: 'itemFromDepth', family: 'crown_', minFloor: 2 });
  const problems = validateSignet(impossible, reach).problems;
  assert.equal(problems.length, 1);
  assert.match(problems[0].why, /family "crown_"/);
});

test('a gate demanding a depth beyond the tower is refused', () => {
  const reach = reachableIn(playState());
  const tooDeep = signet({ kind: 'itemFromDepth', family: 'mat_', minFloor: TOWER_HORIZON + 5 });
  assert.match(validateSignet(tooDeep, reach).problems[0].why, /deeper than this tower goes/);
});

test('a gate on a flag nothing sets is refused', () => {
  const reach = reachableIn(playState());
  assert.match(validateSignet(signet({ kind: 'flag', flag: 'never_set' }), reach).problems[0].why, /nothing in this world sets/);
});

test('a gate on a counter nothing increments is refused', () => {
  const reach = reachableIn(playState());
  const dead = signet({ kind: 'condition', condition: { kind: 'counter', counter: 'dragons_befriended', atLeast: 1 } });
  assert.match(validateSignet(dead, reach).problems[0].why, /nothing increments/);
});

test('a gate on a score that cannot be reached is refused', () => {
  const reach = reachableIn(playState());
  const dead = signet({ kind: 'condition', condition: { kind: 'ability', ability: 'str', atLeast: 30 } });
  assert.match(validateSignet(dead, reach).problems[0].why, /cannot be raised/);
});

test('one open route is enough for an alternative', () => {
  const reach = reachableIn(playState());
  const eitherOr = signet({
    kind: 'any',
    of: [
      { kind: 'flag', flag: 'never_set' },
      { kind: 'condition', condition: { kind: 'counter', counter: COUNTERS.kills, atLeast: 5 } },
    ],
  });
  assert.equal(validateSignet(eitherOr, reach).ok, true);
});

test('an alternative with every route blocked is still refused', () => {
  const reach = reachableIn(playState());
  const doomed = signet({
    kind: 'any',
    of: [
      { kind: 'flag', flag: 'never_set' },
      { kind: 'itemFromDepth', family: 'crown_', minFloor: 1 },
    ],
  });
  assert.match(validateSignet(doomed, reach).problems[0].why, /every alternative is unreachable/);
});

test('an all-gate is only as sound as its worst branch', () => {
  const reach = reachableIn(playState());
  const mixed = signet({
    kind: 'all',
    of: [
      { kind: 'condition', condition: { kind: 'counter', counter: COUNTERS.kills, atLeast: 5 } },
      { kind: 'flag', flag: 'never_set' },
    ],
  });
  assert.equal(validateSignet(mixed, reach).ok, false);
});

test('the droppable families match what the catalogue actually produces', () => {
  // The fragile seam: this set is maintained by hand against items/catalogue.ts.
  const found = material(mulberry32(3), 5);
  assert.ok(
    [...DROPPABLE_FAMILIES].some((f) => found.id.startsWith(f)),
    `the catalogue drops "${found.id}" but no family covers it`,
  );
});

/* -------------------------------------------------------------------------- */
/* Opening a gate                                                              */
/* -------------------------------------------------------------------------- */

test('an item only counts when it came from deep enough', () => {
  const state = playState();
  const shallow: PlayState = { ...state, pc: { ...state.pc, inventory: addItem(state.pc.inventory, material(mulberry32(1), 2)) } };
  const deep: PlayState = { ...state, pc: { ...state.pc, inventory: addItem(state.pc.inventory, material(mulberry32(1), 9)) } };
  const gate: Gate = { kind: 'itemFromDepth', family: 'mat_', minFloor: 8 };

  assert.equal(gateOpen(gate, ctxOf(shallow), world()), false, 'a floor 2 shard is not a floor 9 shard');
  assert.equal(gateOpen(gate, ctxOf(deep), world()), true);
});

test('an unsatisfiable gate is still reported branch by branch', () => {
  const reach: Reachable = {
    maxFloor: 3, droppableFamilies: new Set(), settableFlags: new Set(),
    maxAbility: 20, maxLevel: 20, liveCounters: new Set(),
  };
  const problems = unsatisfiable(
    { kind: 'all', of: [{ kind: 'flag', flag: 'a' }, { kind: 'flag', flag: 'b' }] },
    reach,
  );
  assert.equal(problems.length, 2, 'both failures, so the generator can say why');
});

/* -------------------------------------------------------------------------- */
/* What the player may see                                                     */
/* -------------------------------------------------------------------------- */

test('a hidden Signet is invisible until its gate opens', () => {
  // Listing everything would turn discovery into a checklist, which is the
  // thing this branch exists to avoid.
  const state = playState();
  const hidden = CANDIDATE_SIGNETS.find((s) => s.discovery === 'hidden')!;
  const shown = visibleSignets([hidden], [], ctxOf(state), world());
  assert.deepEqual(shown, []);
});

test('a hinted Signet appears once the world has dropped the hint', () => {
  const state = playState();
  const hinted = CANDIDATE_SIGNETS.find((s) => s.discovery === 'hinted')!;

  assert.deepEqual(visibleSignets([hinted], [], ctxOf(state), world()), []);

  const told = world({ flags: { [`hint_${hinted.id}`]: true } } as never);
  const shown = visibleSignets([hinted], [], ctxOf(state), told);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].available, false, 'knowing it exists is not the same as having it');
});

test('a Signet you already hold stays visible', () => {
  const state = playState();
  const any = CANDIDATE_SIGNETS[0];
  const shown = visibleSignets([any], [any.id], ctxOf(state), world());
  assert.equal(shown[0].held, true);
});

test('a hidden Signet becomes available the moment its gate opens', () => {
  const state = playState();
  const patience = CANDIDATE_SIGNETS.find((s) => s.id === 'signet_long_patience')!;
  const rested: TraitContext = { ...ctxOf(state), counters: { [COUNTERS.shortRests]: 25 } };

  const shown = visibleSignets([patience], [], rested, world());
  assert.equal(shown.length, 1);
  assert.equal(shown[0].available, true);
});

test('admissible keeps the sound and drops the rest, with reasons', () => {
  const reach = reachableIn(playState());
  const good = signet({ kind: 'condition', condition: { kind: 'counter', counter: COUNTERS.kills, atLeast: 1 } }, { id: 'good' });
  const bad = signet({ kind: 'flag', flag: 'never_set' }, { id: 'bad' });

  const result = admissible([good, bad], reach);
  assert.deepEqual(result.kept.map((s) => s.id), ['good']);
  assert.equal(result.discarded[0].signet.id, 'bad');
  assert.ok(result.discarded[0].problems.length > 0);
});

/* -------------------------------------------------------------------------- */
/* Claiming — the step that was never built                                     */
/* -------------------------------------------------------------------------- */

/*
 * `CharacterSheet.signets` was written by no code path at all. Signets were
 * generated, proved reachable, filtered for visibility and tagged "within
 * reach" in the panel — and could never be acquired. `SignetView.available`
 * said "the gate is open and it can be claimed" the whole time.
 */

/** A run far enough along that at least some gates have opened. */
function wellTravelled(): PlayState {
  const base = playState();
  return {
    ...base,
    world: { ...base.world, deepestFloor: 12, flags: { ...base.world.flags } },
    sheet: {
      ...base.sheet,
      level: 8,
      counters: {
        [COUNTERS.kills]: 60, [COUNTERS.fightsWon]: 40, [COUNTERS.floorsClimbed]: 20,
        [COUNTERS.deepestFloor]: 12, [COUNTERS.placesFound]: 40, [COUNTERS.peopleMet]: 20,
        [COUNTERS.shortRests]: 30, [COUNTERS.longRests]: 10, [COUNTERS.itemsUsed]: 25,
      },
    },
  };
}

const openHere = (state: PlayState) =>
  signetsFor(state).kept.find((s) =>
    gateOpen(s.gate, ctxOf(state), { flags: state.world.flags, deepestFloor: state.world.deepestFloor }));

test('a signet whose gate is open can be claimed, and is then held', () => {
  const state = wellTravelled();
  const target = openHere(state);
  assert.ok(target, 'a well-travelled run should have reached at least one signet');

  const after = applySheetAction(state, { type: 'claimSignet', id: target.id });
  assert.equal(after.error, null);
  assert.ok((after.state.sheet.signets ?? []).includes(target.id), 'it is on the sheet');
});

test('claiming the same signet twice is refused', () => {
  const state = wellTravelled();
  const target = openHere(state);
  assert.ok(target);

  const once = applySheetAction(state, { type: 'claimSignet', id: target.id }).state;
  const twice = applySheetAction(once, { type: 'claimSignet', id: target.id });
  assert.match(twice.error ?? '', /already yours/);
});

test('an unknown signet id is refused rather than throwing', () => {
  const after = applySheetAction(wellTravelled(), { type: 'claimSignet', id: 'no_such_thing' });
  assert.match(after.error ?? '', /no such signet/);
});

test('a claimed signet survives a reload, because claiming is an event', () => {
  const state = wellTravelled();
  const target = openHere(state);
  assert.ok(target);

  const replayed = foldPlay(state, [sheetRecord({ type: 'claimSignet', id: target.id })]);
  assert.ok((replayed.sheet.signets ?? []).includes(target.id));
});
