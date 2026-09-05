import type { Edges } from '../social/edge.ts';
import type { Provider } from '../llm/provider.ts';
import { generateFloor } from '../world/floorgen.ts';
import type { FloorResult } from '../world/floorgen.ts';
import { ascend, descend, installRegion } from '../world/travel.ts';
import { bumpCounter } from '../character/persona.ts';
import { grantXp, hpAfterGrowth, xpForNewDepth } from './progress.ts';
import type { LevelUp } from './progress.ts';
import { COUNTERS } from './traits.ts';
import type { PlayState } from './state.ts';
import type { Person, PersonId, Region, World } from '../world/types.ts';

/**
 * Moving between floors, generating what does not exist yet.
 *
 * `travel.ts` deliberately refuses to reach for a generator — it returns a
 * `needsRegion` request instead, which keeps it pure and testable offline. This
 * is the piece that answers that request, and the only place in the play layer
 * that knows floors can be created on demand.
 *
 * A CLIMB IS AN EVENT, and that is not a detail.
 *
 * Floor generation is the one model call that changes world state, and it used
 * to reach the database only inside a snapshot. `foldPlay` is synchronous and
 * holds no `Provider`, so it could never reproduce it — which made the
 * invariant stated in `state.ts` and `sessions.ts` ("delete every snapshot and
 * nothing changes but how long loading takes") FALSE for any session that had
 * ever climbed. Replay landed on a `currentRegion` naming a region that was not
 * there. Worse, the crossing itself was unrecorded too: the counters, the depth
 * experience and the level it bought survived only in the snapshot.
 *
 * Recording the crossing fixes both, and it is the seam every later
 * dynamic-world feature needs — anything that changes the world between turns
 * must be either a pure function of `world.turn` or an event like this one.
 *
 * `applyClimb` is pure and drives BOTH the live path and replay, so the two
 * cannot drift apart. Fetching the floor is the live path's only extra job.
 */

/** A crossing, and the floor that had to be built to make it, if any. */
export type ClimbRecord = {
  kind: 'climb';
  direction: 'up' | 'down';
  /**
   * The generated floor. Null when the region already existed in full detail,
   * because travel is pure in that case and replays from the world alone.
   */
  built: { region: Region; people: Record<PersonId, Person>; edges?: Edges } | null;
};

export type ClimbResult = {
  state: PlayState;
  /** Present when a floor had to be built or rebuilt to get there. */
  generated: FloorResult | null;
  error: string | null;
  /** Experience for reaching a depth for the first time. */
  xp: number;
  levelled: LevelUp | null;
  /** What to append to the log. Null when the climb failed. */
  record: ClimbRecord | null;
};

const failed = (state: PlayState, error: string): ClimbResult =>
  ({ state, generated: null, error, xp: 0, levelled: null, record: null });

const moveFor = (direction: 'up' | 'down') => (direction === 'up' ? ascend : descend);

/** Apply a recorded crossing. The only place a climb changes state. */
export function applyClimb(state: PlayState, record: ClimbRecord): ClimbResult {
  const attempt = moveFor(record.direction)(state.world);

  if (attempt.kind === 'error') return failed(state, attempt.reason);
  if (attempt.kind === 'moved') {
    return { ...arrive(state, attempt.world), generated: null, error: null, record };
  }

  // Replaying a log whose crossing recorded no floor, onto a world that has
  // none either. Failing loudly beats folding to a state travel already refused.
  if (!record.built) return failed(state, `floor ${attempt.floor} was never built`);

  const { region, people, edges } = record.built;
  // MERGED, never replaced: a crossing brings new faces and their first
  // impressions, and must not touch what the floors below already earned.
  const withPeople: World = {
    ...state.world,
    people: { ...state.world.people, ...people },
    edges: { ...state.world.edges, ...edges },
  };
  return {
    ...arrive(state, installRegion(withPeople, region, region.entrance)),
    generated: null,
    error: null,
    record,
  };
}

async function cross(provider: Provider, state: PlayState, direction: 'up' | 'down'): Promise<ClimbResult> {
  const attempt = moveFor(direction)(state.world);
  if (attempt.kind === 'error') return failed(state, attempt.reason);

  // The floor is new, or was compressed on the way past. Build it BEFORE
  // applying anything, so one record drives the live crossing and every replay.
  const generated = attempt.kind === 'needsRegion'
    ? await generateFloor(provider, state.world, attempt.floor, state.sheet, attempt.gazetteer)
    : null;

  const record: ClimbRecord = {
    kind: 'climb',
    direction,
    built: generated ? { region: generated.region, people: generated.people, edges: generated.edges } : null,
  };

  return { ...applyClimb(state, record), generated };
}

/**
 * Crossing a floor boundary, and what it is worth.
 *
 * Reaching a new deepest floor pays experience that is NOT subject to the
 * depth fall-off, because a first descent into somewhere is by definition not
 * something that can be farmed. Going back over old ground pays nothing.
 */
function arrive(state: PlayState, world: World): { state: PlayState; xp: number; levelled: LevelUp | null } {
  let counters = bumpCounter(state.sheet.counters, COUNTERS.floorsClimbed);

  const deepest = world.deepestFloor;
  const isNewDepth = deepest > state.world.deepestFloor;
  if (isNewDepth) counters = { ...counters, [COUNTERS.deepestFloor]: deepest };

  let sheet = { ...state.sheet, counters };
  let xp = 0;
  let levelled: LevelUp | null = null;

  if (isNewDepth) {
    xp = xpForNewDepth(deepest);
    const granted = grantXp(sheet, xp);
    sheet = granted.sheet;
    levelled = granted.levelled;
  }

  const grown = hpAfterGrowth(sheet, state.pc.inventory, state.pc.hp, state.pc.maxHp);
  return {
    state: { ...state, world, sheet, pc: { ...state.pc, hp: grown.hp, maxHp: grown.maxHp } },
    xp,
    levelled,
  };
}

export const climb = (provider: Provider, state: PlayState): Promise<ClimbResult> =>
  cross(provider, state, 'up');

export const godown = (provider: Provider, state: PlayState): Promise<ClimbResult> =>
  cross(provider, state, 'down');

/** Whether the player is standing somewhere they could leave the floor from. */
export function exitStatus(state: PlayState): { canClimb: boolean; canDescend: boolean } {
  const record = state.world.regions[state.world.currentRegion];
  if (!record || record.detail !== 'full') return { canClimb: false, canDescend: false };
  return {
    canClimb: record.exit !== null && state.world.currentPlace === record.exit,
    canDescend: record.floor > 0 && state.world.currentPlace === record.entrance,
  };
}
