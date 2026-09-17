import type { Edges } from '../social/edge.ts';
import type { Provider } from '../llm/provider.ts';
import { generateFloor } from '../world/floorgen.ts';
import type { FloorResult } from '../world/floorgen.ts';
import { ascend, clockOf, descend, installRegion, stairCost, traverse } from '../world/travel.ts';
import { advanceJourneys, fadeGrudges } from './journey.ts';
import { bumpCounter } from '../character/persona.ts';
import { adopt, firsthand } from '../character/belief.ts';
import { forbids, ruleClaim } from '../rules/ruleset.ts';
import { playerSubject } from './signetbook.ts';
import type { Law } from '../rules/ruleset.ts';
import { grantXp, hpAfterGrowth, xpForNewDepth } from './progress.ts';
import type { LevelUp } from './progress.ts';
import { COUNTERS } from './traits.ts';
import type { PlayState } from './state.ts';
import type { Person, PersonId, Region, RegionId, Stratum, World } from '../world/types.ts';

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
   * WHERE, when the structure is not a stack.
   *
   * A crossing was always up or down, which is only true of a tower. An outer
   * world has ways out that are neither, so the record names the far side and
   * `direction` is left as the stack's shorthand for it.
   */
  to?: RegionId;
  /**
   * The generated floor. Null when the region already existed in full detail,
   * because travel is pure in that case and replays from the world alone.
   */
  built: {
    region: Region;
    people: Record<PersonId, Person>;
    edges?: Edges;
    /**
     * A structure this floor BEGINS, if it begins one.
     *
     * "Four dungeons inside a twenty-floor tower" needs somebody to say where a
     * dungeon starts, and nothing could: the root tower was written at genesis
     * and no second stratum was ever added. It travels in the record because a
     * world's shape changing is exactly the kind of thing a replay must not
     * have to guess at.
     */
    stratum?: Stratum;
  } | null;
};

export type ClimbResult = {
  state: PlayState;
  /** Present when a floor had to be built or rebuilt to get there. */
  generated: FloorResult | null;
  error: string | null;
  /** Experience for reaching a depth for the first time. */
  xp: number;
  levelled: LevelUp | null;
  /**
   * What to append to the log.
   *
   * Present even when the crossing was REFUSED, because running into a law is
   * how somebody learns it is there, and a lesson that is not in the log does
   * not survive a reload.
   */
  record: ClimbRecord | null;
};

const failed = (state: PlayState, error: string, record: ClimbRecord | null = null): ClimbResult =>
  ({ state, generated: null, error, xp: 0, levelled: null, record });

/**
 * What hitting a law leaves behind.
 *
 * Firsthand, because you were there. This runs inside the fold, so the same
 * refusal replays to the same belief and nothing extra has to be logged.
 */
const taught = (state: PlayState, law: Law | undefined): PlayState =>
  law
    ? {
        ...state,
        sheet: {
          ...state.sheet,
          beliefs: adopt(state.sheet.beliefs ?? [], firsthand(ruleClaim(law.constraint))),
        },
      }
    : state;

/**
 * The crossing this direction means, asked by somebody in particular.
 *
 * `ascend` takes no subject: no law names climbing UP today, and inventing a
 * parameter for a check nobody makes is the dead field this step is about.
 */
const moveFor = (state: PlayState, record: { direction: 'up' | 'down'; to?: RegionId }) => {
  if (record.to) return traverse(state.world, record.to);
  return record.direction === 'up' ? ascend(state.world) : descend(state.world, playerSubject(state));
};

/** Apply a recorded crossing. The only place a climb changes state. */
export function applyClimb(state: PlayState, record: ClimbRecord): ClimbResult {
  const attempt = moveFor(state, record);

  if (attempt.kind === 'error') return failed(taught(state, attempt.law), attempt.reason, record);
  if (attempt.kind === 'moved') {
    return { ...arrive(state, attempt.world), generated: null, error: null, record };
  }

  // Replaying a log whose crossing recorded no floor, onto a world that has
  // none either. Failing loudly beats folding to a state travel already refused.
  if (!record.built) return failed(state, `floor ${attempt.floor} was never built`, record);

  const { region, people, edges, stratum } = record.built;
  // MERGED, never replaced: a crossing brings new faces and their first
  // impressions, and must not touch what the floors below already earned.
  const withPeople: World = {
    ...state.world,
    people: { ...state.world.people, ...people },
    edges: { ...state.world.edges, ...edges },
    // A floor that begins a wing adds it to what the world holds. Merged, never
    // replaced: the tower this hangs inside is already in there.
    ...(stratum ? { strata: { ...state.world.strata, [stratum.id]: stratum } } : {}),
  };
  return {
    ...arrive(state, installRegion(withPeople, region, region.entrance)),
    generated: null,
    error: null,
    record,
  };
}

async function cross(
  provider: Provider, state: PlayState, direction: 'up' | 'down', to?: RegionId,
): Promise<ClimbResult> {
  const attempt = moveFor(state, { direction, to });

  // The floor is new, or was compressed on the way past. Build it BEFORE
  // applying anything, so one record drives the live crossing and every replay.
  const generated = attempt.kind === 'needsRegion'
    ? await generateFloor(provider, state.world, attempt.floor, state.sheet, attempt.gazetteer, attempt.regionId)
    : null;

  const record: ClimbRecord = {
    kind: 'climb',
    direction,
    ...(to ? { to } : {}),
    built: generated
      ? {
        region: generated.region,
        people: generated.people,
        edges: generated.edges,
        // A wing the floor opened travels with it: the world's SHAPE changing
        // is the last thing a replay should have to guess at.
        ...(generated.stratum ? { stratum: generated.stratum } : {}),
      }
      : null,
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
function arrive(state: PlayState, crossed: World): { state: PlayState; xp: number; levelled: LevelUp | null } {
  // A crossing is a stair (7.1b, hours since 7.1e): it covers its time, and whoever is on the road covers it with you.
  const clock = clockOf(state.world) + stairCost(crossed, state.world.currentRegion, crossed.currentRegion);
  const world = fadeGrudges(state.world, advanceJourneys({ ...crossed, clock }, clockOf(state.world), clock));

  let counters = bumpCounter(state.sheet.counters, COUNTERS.floorsClimbed);

  const deepest = world.deepestFloor;
  const isNewDepth = deepest > state.world.deepestFloor;
  if (isNewDepth) counters = { ...counters, [COUNTERS.deepestFloor]: deepest };

  /*
   * What crosses with you is the world's law.
   *
   * "Memories do not reset" is one of the design's own tower rules, which means
   * a world can be written where they DO — and this is the seam it happens on,
   * inside the fold, so a replay forgets in exactly the same places. Everything
   * the person had worked out goes, not only the rules: a reset that spared
   * what was convenient would not be a reset.
   */
  const forgets = forbids(world, playerSubject(state), 'keepMemories') !== null;

  let sheet = forgets
    ? { ...state.sheet, counters, beliefs: [] }
    : { ...state.sheet, counters };
  let xp = 0;
  let levelled: LevelUp | null = null;

  if (isNewDepth) {
    xp = xpForNewDepth(deepest);
    const granted = grantXp(sheet, xp, forbids(world, playerSubject(state), 'gainLevels') === null);
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

/**
 * Take a named way out, in a world whose regions are not a stack.
 *
 * `direction` is still recorded because the depth curves read it for what a
 * crossing is worth; where you actually went is `to`.
 */
export const travelTo = (provider: Provider, state: PlayState, to: RegionId): Promise<ClimbResult> =>
  cross(provider, state, 'up', to);

/** Whether the player is standing somewhere they could leave the floor from. */
export function exitStatus(state: PlayState): { canClimb: boolean; canDescend: boolean } {
  const record = state.world.regions[state.world.currentRegion];
  if (!record || record.detail !== 'full') return { canClimb: false, canDescend: false };
  // `record.floor > 0` used to live here — a SECOND copy of "the ground is the
  // bottom", in the layer that decides what the player is offered. A law the
  // panel does not consult is a law the panel will contradict: it hid the way
  // down in a world that permits digging, and from the one person exempt.
  const stopped = record.floor === 0
    && forbids(state.world, playerSubject(state), 'descendBelowGround') !== null;

  return {
    canClimb: record.exit !== null && state.world.currentPlace === record.exit,
    canDescend: !stopped && state.world.currentPlace === record.entrance,
  };
}
