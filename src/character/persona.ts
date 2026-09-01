/**
 * The part of a character that everyone has.
 *
 * The player and an NPC were previously two unrelated shapes: one had abilities
 * and a hit die, the other had a trust number and nothing else. That made NPCs
 * interchangeable — there was nothing to interact WITH. A persona is the shared
 * core: how they speak, where they stand socially, who they are, how they are
 * holding up, and what they have done.
 *
 * It is deliberately cheap. Every villager can afford one; only people who fight
 * or travel with you also need a full sheet.
 */

/** Social standing relative to the player. Decides what a pronoun costs. */
export const STATUSES = ['superior', 'peer', 'inferior'] as const;
export type Status = (typeof STATUSES)[number];

/**
 * How someone speaks, banded by trust.
 *
 * Band keys are the trust FLOOR at which that form takes over, so a lookup is
 * "the highest floor at or below the current trust". This is what lets the
 * player hear a relationship change.
 */
export type NpcVoice = {
  selfPronoun: string;
  /** What they call themselves when frightened or furious. */
  underStress: string;
  /** trust floor -> how they address the player. */
  addressBands: Record<string, string>;
  /** trust floor -> sentence-ending particle. */
  particleBands: Record<string, string>;
  tics: string[];
};

export const AXES = ['warmth', 'nerve', 'discipline', 'candour', 'loyalty'] as const;
export type Axis = (typeof AXES)[number];

/**
 * Disposition, on the same -3..+3 scale as trust so the two read together.
 *
 *  warmth      cold ↔ warm
 *  nerve       fearful ↔ bold
 *  discipline  impulsive ↔ controlled
 *  candour     deceptive ↔ blunt
 *  loyalty     treacherous ↔ devoted — decides whether an order is obeyed
 */
export type Personality = Record<Axis, number>;

export const AXIS_MIN = -3;
export const AXIS_MAX = 3;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

export const neutralPersonality = (): Personality => ({
  warmth: 0, nerve: 0, discipline: 0, candour: 0, loyalty: 0,
});

export function clampPersonality(proposed: Partial<Personality>): Personality {
  const out = neutralPersonality();
  for (const axis of AXES) {
    const value = proposed[axis];
    out[axis] = typeof value === 'number' && Number.isFinite(value) ? clamp(value, AXIS_MIN, AXIS_MAX) : 0;
  }
  return out;
}

/**
 * How someone is holding up right now.
 *
 * Deliberately separate from personality, and on a different clock: this moves
 * fast and recovers, while disposition drifts slowly. Collapsing the two gives
 * an NPC whose character changes every scene, which reads as incoherent rather
 * than alive.
 */
export type MentalState = {
  /** 0..10. Rises with danger and injury, falls with rest. */
  stress: number;
  /** -3..+3. Rises with victory and kindness, falls with defeat and betrayal. */
  morale: number;
  /** 0..10. Rises with time and travel, falls with rest. */
  fatigue: number;
};

export const STRESS_MAX = 10;
export const FATIGUE_MAX = 10;

export const restingMind = (): MentalState => ({ stress: 0, morale: 0, fatigue: 0 });

export function clampMental(proposed: Partial<MentalState>): MentalState {
  return {
    stress: clamp(proposed.stress ?? 0, 0, STRESS_MAX),
    morale: clamp(proposed.morale ?? 0, AXIS_MIN, AXIS_MAX),
    fatigue: clamp(proposed.fatigue ?? 0, 0, FATIGUE_MAX),
  };
}

/**
 * Tallies the engine keeps: kills by kind, floors climbed, lies told.
 *
 * These are what make a trait condition like "kill thirty beasts" checkable
 * rather than a matter of opinion.
 */
export type Counters = Record<string, number>;

export const bumpCounter = (counters: Counters, key: string, by = 1): Counters => ({
  ...counters,
  [key]: (counters[key] ?? 0) + by,
});

export const counterOf = (counters: Counters, key: string): number => counters[key] ?? 0;

/* -------------------------------------------------------------------------- */
/* Describing a persona to a model                                             */
/* -------------------------------------------------------------------------- */

const LABELS: Record<Axis, [low: string, high: string]> = {
  warmth: ['cold', 'warm'],
  nerve: ['fearful', 'bold'],
  discipline: ['impulsive', 'controlled'],
  candour: ['evasive', 'blunt'],
  loyalty: ['self-serving', 'devoted'],
};

/** Only the axes that are actually pronounced; a neutral trait is not a trait. */
export function describePersonality(personality: Personality, threshold = 2): string[] {
  const said: string[] = [];
  for (const axis of AXES) {
    const value = personality[axis];
    if (Math.abs(value) < threshold) continue;
    const [low, high] = LABELS[axis];
    said.push(value > 0 ? high : low);
  }
  return said;
}

export function describeMental(mental: MentalState): string[] {
  const said: string[] = [];
  if (mental.stress >= 7) said.push('badly rattled');
  else if (mental.stress >= 4) said.push('on edge');
  if (mental.fatigue >= 7) said.push('exhausted');
  else if (mental.fatigue >= 4) said.push('tired');
  if (mental.morale <= -2) said.push('demoralised');
  else if (mental.morale >= 2) said.push('in good spirits');
  return said;
}

/**
 * The trust value register should actually be read at.
 *
 * A warm person opens up sooner than the raw number says, a cold one holds you
 * at arm's length for longer, and someone badly rattled retreats into formality.
 * This is what makes personality *audible* rather than a stat on a sheet.
 */
export function registerTrust(trust: number, personality: Personality, mental: MentalState): number {
  const warmthShift = clamp(personality.warmth / 2, -1, 1);
  const stressShift = mental.stress >= 7 ? -1 : 0;
  return trust + warmthShift + stressShift;
}

/**
 * Everything a character is, short of what it takes to fight.
 *
 * The player and a market trader share this exactly. What separates them is a
 * full sheet, which only people who fight or travel with you need.
 */
export type Persona = {
  voice: NpcVoice;
  status: Status;
  personality: Personality;
  mental: MentalState;
  counters: Counters;
  /**
   * Accumulated push on each axis, spent when it crosses the drift threshold.
   *
   * This is the hysteresis made storable: without it, disposition would be a
   * running total of the last thing that happened rather than a character.
   */
  pressure: Personality;
};

/** A blank persona, for tests and for people the model said little about. */
export const emptyPersona = (voice: NpcVoice, status: Status = 'peer'): Persona => ({
  voice,
  status,
  personality: neutralPersonality(),
  mental: restingMind(),
  counters: {},
  pressure: neutralPersonality(),
});
