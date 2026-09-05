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

import type { Belief } from './belief.ts';

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

/* -------------------------------------------------------------------------- */
/* STORED: temperament                                                         */
/* -------------------------------------------------------------------------- */

/**
 * How someone is WIRED. Four axes, and none of them emerge from circumstance.
 *
 * This replaced a five-axis "personality" of warmth, nerve, discipline, candour
 * and loyalty, which was three models bolted together: warmth, nerve and
 * discipline are a truncated Big Five with Openness missing, `candour` is a
 * behaviour rather than a trait, and `loyalty` was never a property of one
 * person at all — devoted to WHOM? It sat on the persona and no rule ever read
 * it, which is exactly what you would expect of a relationship filed as a trait.
 *
 * The 5D psychology model this game now follows is clear that disposition is
 * not one of its dimensions: behaviour is the OUTPUT of hardware, driven by
 * need, under a role. So what is stored is the hardware — `intuition` and
 * `feeling` are the cognitive wiring the old set was missing (and `intuition`
 * restores Openness), while `nerve` and `discipline` stay because being hungry
 * does not make you brave or make you sloppy in the way it makes you cold.
 *
 * `warmth` and `candour` became DERIVED, because how warm or how open somebody
 * is genuinely does depend on who they are with and what they need.
 */
export const TEMPERAMENT = ['intuition', 'feeling', 'nerve', 'discipline'] as const;
export type TemperamentAxis = (typeof TEMPERAMENT)[number];

/**
 *  intuition   concrete ↔ abstract   how the world is taken in
 *  feeling     logic ↔ values        how a decision is reached
 *  nerve       fearful ↔ bold
 *  discipline  impulsive ↔ controlled
 */
export type Temperament = Record<TemperamentAxis, number>;

/**
 * Stored wide, shown narrow.
 *
 * The old range was −3..+3: seven buckets, which is fine for a sentence and far
 * too coarse for the things that now read these numbers — a skill's magnitude
 * formula and a SIGNED suitability budget. It also made drift a step function
 * of a sixth of the whole range at a time, which is most of why `pressure` had
 * to be invented to smooth it. Only `bandOf` and the UI care about the width.
 */
export const TEMPER_MIN = -10;
export const TEMPER_MAX = 10;

export const neutralTemperament = (): Temperament =>
  ({ intuition: 0, feeling: 0, nerve: 0, discipline: 0 });

export function clampTemperament(proposed: Partial<Temperament>): Temperament {
  const out = neutralTemperament();
  for (const axis of TEMPERAMENT) {
    const value = proposed[axis];
    out[axis] = typeof value === 'number' && Number.isFinite(value) ? clamp(value, TEMPER_MIN, TEMPER_MAX) : 0;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* STORED: needs                                                               */
/* -------------------------------------------------------------------------- */

/**
 * What someone needs, and how much of it they are getting.
 *
 * This replaced `MentalState` (stress, morale, fatigue), which had four
 * problems. `morale` was −3..+3 among 0..10 resources, so it was filed with the
 * resources and behaved like a disposition. Stress and fatigue docked the two
 * pools that CON and VIT already own, so two systems pushed one number from
 * different directions. Everything was a DEFICIT — you could be exhausted,
 * rattled or demoralised and never rested, steady or driven. And none of it
 * said anything about what a person would DO about it.
 *
 * Needs fix all four, and they earn their keep twice: they are the player's
 * condition AND the input to an NPC's decisions, so a world where people have
 * lives runs on the same numbers as the sheet rather than a second system.
 *
 * SATISFACTION, not deficit: 10 is fully met, 0 is desperate. `stress` inverts
 * to `safety`, `fatigue` to `rest`, `morale` to `purpose`.
 */
export const NEEDS = ['rest', 'food', 'safety', 'company', 'purpose'] as const;
export type Need = (typeof NEEDS)[number];
export type Needs = Record<Need, number>;

export const NEED_MAX = 10;

/** Everything met. What a person looks like on a good day. */
export const metNeeds = (): Needs =>
  ({ rest: NEED_MAX, food: NEED_MAX, safety: NEED_MAX, company: NEED_MAX, purpose: NEED_MAX });

export function clampNeeds(proposed: Partial<Needs>): Needs {
  const out = metNeeds();
  for (const need of NEEDS) {
    const value = proposed[need];
    if (typeof value === 'number' && Number.isFinite(value)) out[need] = clamp(value, 0, NEED_MAX);
  }
  return out;
}

/** How short of met a need is. The number anything costed reads. */
export const unmet = (needs: Needs, need: Need): number => NEED_MAX - needs[need];

/* -------------------------------------------------------------------------- */
/* STORED: the drive                                                           */
/* -------------------------------------------------------------------------- */

/**
 * WHY somebody acts — the 5D model's "software", and the one dimension the
 * five old axes said nothing about.
 *
 * A want and a fear, both named in the world's own SUBJECT vocabulary (see
 * `world/subjects.ts`) rather than as free text. That is what lets a piece of
 * lore, a quest, or a thing an NPC is doing be compared against what somebody
 * actually cares about — a set intersection instead of a judgement call.
 *
 * The creation interview has asked for this since the beginning — "what do you
 * want badly enough to climb for, and what are you leaving behind at the
 * bottom?" — and threw the answer away every time.
 */
export type Drive = {
  /** What they are climbing for. */
  want: string;
  /** What they are climbing away from. */
  fear: string;
};

/* -------------------------------------------------------------------------- */
/* DERIVED: disposition                                                        */
/* -------------------------------------------------------------------------- */

/**
 * How somebody comes ACROSS. Computed, never stored.
 *
 * Kept on the old −3..+3 scale because that is what reads well in a sentence
 * and what the panel already draws; the width lives underneath, in temperament.
 */
export const AXES = ['warmth', 'candour', 'nerve', 'discipline', 'intuition', 'feeling'] as const;
export type Axis = (typeof AXES)[number];
export type Personality = Record<Axis, number>;

export const AXIS_MIN = -3;
export const AXIS_MAX = 3;

/** Temperament's wide scale down to the narrow one a sentence is written on. */
export const bandOf = (value: number): number => clamp(value / 3, AXIS_MIN, AXIS_MAX);

/**
 * What an unmet need does to how somebody comes across.
 *
 * Zero at MET, and only ever negative. Being fed does not make you warm; being
 * starved makes you cold. Centring this anywhere but `NEED_MAX` gives every
 * contented person a bonus to warmth, which read as "a neutral person is warmer
 * than their trust says" — deprivation erodes disposition, satisfaction is
 * simply the absence of that.
 */
const pull = (satisfaction: number): number => clamp((satisfaction - NEED_MAX) / 2, -3, 0);

/**
 * Disposition as an OUTPUT of wiring and circumstance.
 *
 * Each derivation is a claim worth being able to argue with:
 *   warmth      you are as warm as you are values-led, and as the company you
 *               are actually getting allows
 *   candour     the opposite of self-control, and only when it feels safe
 *   nerve       your own nerve, worn down by being unsafe
 *   discipline  your own grip, frayed by going unrested
 */
export function dispositionOf(who: { temperament: Temperament; needs: Needs }): Personality {
  const { temperament: t, needs: n } = who;
  return {
    warmth: clamp(bandOf(t.feeling) + pull(n.company), AXIS_MIN, AXIS_MAX),
    candour: clamp(-bandOf(t.discipline) + pull(n.safety), AXIS_MIN, AXIS_MAX),
    nerve: clamp(bandOf(t.nerve) + pull(n.safety), AXIS_MIN, AXIS_MAX),
    discipline: clamp(bandOf(t.discipline) - (n.rest <= 3 ? 1 : 0), AXIS_MIN, AXIS_MAX),
    intuition: bandOf(t.intuition),
    feeling: bandOf(t.feeling),
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
  candour: ['evasive', 'blunt'],
  nerve: ['fearful', 'bold'],
  discipline: ['impulsive', 'controlled'],
  intuition: ['literal', 'imaginative'],
  feeling: ['coldly logical', 'led by what matters'],
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

export function describeMental(needs: Needs): string[] {
  const said: string[] = [];
  if (needs.safety <= 3) said.push('badly rattled');
  else if (needs.safety <= 6) said.push('on edge');
  if (needs.rest <= 3) said.push('exhausted');
  else if (needs.rest <= 6) said.push('tired');
  if (needs.food <= 3) said.push('starving');
  else if (needs.food <= 6) said.push('hungry');
  if (needs.company <= 3) said.push('badly alone');
  else if (needs.company <= 6) said.push('lonely');
  if (needs.purpose <= 3) said.push('adrift');
  // The upside half. The old three could only ever report a deficit.
  else if (needs.purpose >= 9 && needs.rest >= 8) said.push('in good heart');
  return said;
}

/**
 * The trust value register should actually be read at.
 *
 * A warm person opens up sooner than the raw number says, a cold one holds you
 * at arm's length for longer, and someone badly rattled retreats into formality.
 * This is what makes personality *audible* rather than a stat on a sheet.
 */
export function registerTrust(trust: number, who: { temperament: Temperament; needs: Needs }): number {
  const warmthShift = clamp(dispositionOf(who).warmth / 2, -1, 1);
  const rattledShift = who.needs.safety <= 3 ? -1 : 0;
  return trust + warmthShift + rattledShift;
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
  /** How they are wired. Stable. See `dispositionOf` for how they come across. */
  temperament: Temperament;
  /** How they are doing. Fast, and what drives what they do about it. */
  needs: Needs;
  /** What they want and what they are running from. Slow; rarely changes. */
  drive?: Drive;
  /**
   * What this person holds true — histories, rules, deeds, who is whose.
   *
   * Beliefs rather than a list of known ids, because a rumour can be WRONG and
   * an absent opinion is a different thing from a mistaken one. Learning is
   * one-time, and holding a thing is what lets you tell it to somebody else.
   * See `belief.ts`.
   */
  beliefs?: Belief[];
  counters: Counters;
  /**
   * Accumulated push on each axis, spent when it crosses the drift threshold.
   *
   * This is the hysteresis made storable: without it, disposition would be a
   * running total of the last thing that happened rather than a character.
   */
  pressure: Temperament;
};

/** A blank persona, for tests and for people the model said little about. */
export const emptyPersona = (voice: NpcVoice, status: Status = 'peer'): Persona => ({
  voice,
  status,
  temperament: neutralTemperament(),
  needs: metNeeds(),
  counters: {},
  pressure: neutralTemperament(),
});
