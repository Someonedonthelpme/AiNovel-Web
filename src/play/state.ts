import type { ActiveCondition, CombatState } from '../combat/types.ts';
import type { CombatAction } from './combat.ts';
import type { SocialRoll } from '../engine/roll.ts';
import type { CharacterSheet } from '../session/sheet.ts';
import { derive } from '../session/sheet.ts';
import type { PersonId, World } from '../world/types.ts';

/**
 * The state the play loop folds over.
 *
 * The event log stays the source of truth and `PlayState` is a fold over it, so
 * a session can be replayed, resumed, branched from any turn, or debugged by
 * reading what actually happened. Dice are RECORDED in the turn record rather
 * than re-rolled, which is what keeps the fold deterministic.
 */

export type PlayState = {
  world: World;
  sheet: CharacterSheet;
  pc: {
    hp: number;
    maxHp: number;
    conditions: ActiveCondition[];
    coin: number;
  };
  /** The fight in progress, if any. A finished fight is discarded, not kept. */
  combat: CombatState | null;
  ended: null | { reason: string };
};

export const MODES = ['conversation', 'exploration'] as const;
export type Mode = (typeof MODES)[number];

export const CLASSES = ['ADVANCES', 'NEUTRAL', 'DIVERGES', 'IMPOSSIBLE'] as const;
export type Classification = (typeof CLASSES)[number];

/** What the Director is permitted to change. Everything else is engine-owned. */
export type WorldDelta = {
  /** Must be an edge from where the player stands. */
  moveTo?: string;
  /** New canon, embedded for later retrieval by the guard. */
  learnFacts?: string[];
  /** Per-person trust CHANGES, not absolutes. */
  trust?: Record<PersonId, number>;
  flags?: Record<string, boolean>;
  timeSpent?: number;
  /** Finding the way up. */
  revealExit?: string;
  /**
   * A fight breaks out. The Director says only THAT one starts; depth decides
   * what shows up, because the difficulty curve is the whole progression.
   */
  startCombat?: boolean;
};

export type TurnRecord = {
  kind: 'turn';
  input: string;
  mode: Mode;
  classification: Classification;
  addressed: PersonId | null;
  /** Recorded, never re-rolled. */
  roll: SocialRoll | null;
  /** The validated delta that was actually applied. */
  delta: WorldDelta;
  /** What the Director asked for and was refused, with reasons. */
  rejected: string[];
  prose: string;
  /**
   * The choices made in a fight this turn, if one broke out.
   *
   * A whole encounter is ONE event in the log. Only the decisions are stored —
   * every roll is derived from state, so replaying these actions reproduces the
   * identical fight rather than a differently unlucky one.
   */
  combatActions?: CombatAction[];
};

export type PlayEvent = { kind: 'start' } | TurnRecord;

export function initialPlayState(world: World, sheet: CharacterSheet): PlayState {
  const d = derive(sheet);
  return {
    world,
    sheet,
    pc: { hp: d.maxHp, maxHp: d.maxHp, conditions: [], coin: 0 },
    combat: null,
    ended: null,
  };
}
