import type { Provider } from '../llm/provider.ts';
import { ensureFloor } from '../world/floorgen.ts';
import type { FloorResult } from '../world/floorgen.ts';
import { ascend, descend } from '../world/travel.ts';
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
};

const failed = (state: PlayState, error: string): ClimbResult => ({ state, generated: null, error });

async function cross(
  provider: Provider,
  state: PlayState,
  move: typeof ascend,
): Promise<ClimbResult> {
  const attempt = move(state.world);

  if (attempt.kind === 'error') return failed(state, attempt.reason);
  if (attempt.kind === 'moved') {
    return { state: { ...state, world: attempt.world }, generated: null, error: null };
  }

  // The floor is new, or was compressed on the way past. Build it, then step in.
  const built = await ensureFloor(provider, state.world, attempt.floor, state.sheet);
  return { state: { ...state, world: built.world }, generated: built.result, error: null };
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
