import type { Provider } from '../llm/provider.ts';
import { ensureFloor } from '../world/floorgen.ts';
import type { FloorResult } from '../world/floorgen.ts';
import { ascend, descend } from '../world/travel.ts';
import { bumpCounter } from '../character/persona.ts';
import { grantXp, hpAfterGrowth, xpForNewDepth } from './progress.ts';
import type { LevelUp } from './progress.ts';
import { COUNTERS } from './traits.ts';
import type { PlayState } from './state.ts';

/**
 * Moving between floors, generating what does not exist yet.
 *
 * `travel.ts` deliberately refuses to reach for a generator — it returns a
 * `needsRegion` request instead, which keeps it pure and testable offline. This
 * is the piece that answers that request, and the only place in the play layer
 * that knows floors can be created on demand.
 */

export type ClimbResult = {
  state: PlayState;
  /** Present when a floor had to be built or rebuilt to get there. */
  generated: FloorResult | null;
  error: string | null;
  /** Experience for reaching a depth for the first time. */
  xp: number;
  levelled: LevelUp | null;
};

const failed = (state: PlayState, error: string): ClimbResult =>
  ({ state, generated: null, error, xp: 0, levelled: null });

async function cross(
  provider: Provider,
  state: PlayState,
  move: typeof ascend,
): Promise<ClimbResult> {
  const attempt = move(state.world);

  if (attempt.kind === 'error') return failed(state, attempt.reason);
  if (attempt.kind === 'moved') {
    return { ...arrive(state, attempt.world), generated: null, error: null };
  }

  // The floor is new, or was compressed on the way past. Build it, then step in.
  const built = await ensureFloor(provider, state.world, attempt.floor, state.sheet);
  return { ...arrive(state, built.world), generated: built.result, error: null };
}

/**
 * Crossing a floor boundary, and what it is worth.
 *
 * Reaching a new deepest floor pays experience that is NOT subject to the
 * depth fall-off, because a first descent into somewhere is by definition not
 * something that can be farmed. Going back over old ground pays nothing.
 */
function arrive(state: PlayState, world: PlayState['world']): { state: PlayState; xp: number; levelled: LevelUp | null } {
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
  cross(provider, state, ascend);

export const godown = (provider: Provider, state: PlayState): Promise<ClimbResult> =>
  cross(provider, state, descend);

/** Whether the player is standing somewhere they could leave the floor from. */
export function exitStatus(state: PlayState): { canClimb: boolean; canDescend: boolean } {
  const record = state.world.regions[state.world.currentRegion];
  if (!record || record.detail !== 'full') return { canClimb: false, canDescend: false };
  return {
    canClimb: record.exit !== null && state.world.currentPlace === record.exit,
    canDescend: record.floor > 0 && state.world.currentPlace === record.entrance,
  };
}
