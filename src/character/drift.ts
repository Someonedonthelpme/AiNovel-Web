import type { Tier } from '../engine/roll.ts';
import type { Tone } from '../llm/register.ts';
import {
  AXES, AXIS_MAX, AXIS_MIN, FATIGUE_MAX, STRESS_MAX,
} from './persona.ts';
import type { Axis, MentalState, Personality, Persona } from './persona.ts';

/**
 * How people change.
 *
 * Two clocks, deliberately. State of mind moves fast and recovers — a bad hour
 * leaves someone rattled, a night's rest does not. Disposition moves slowly and
 * only under sustained pressure, because a character who turns cold the moment
 * you snap at them once is not a character, it is a mood ring.
 *
 * All of it is computed here, in code, from what actually happened. The model is
 * told the result so it can write how it shows; it never decides the change.
 */

/** Things that happen to someone, in the vocabulary the engine can actually emit. */
export type DriftCause =
  /** A check they were involved in resolved. */
  | { kind: 'check'; tier: Tier }
  /** The relationship moved. Positive is warmer. */
  | { kind: 'trust'; change: number }
  /** How the player addressed them. */
  | { kind: 'address'; tone: Tone }
  /** Time and distance. */
  | { kind: 'travel'; cost: number }
  /** Standing somewhere dangerous. */
  | { kind: 'danger'; level: number }
  /** Recovering. */
  | { kind: 'rest'; quality: number };

/**
 * Pressure needed before a disposition actually shifts one step.
 *
 * This is the hysteresis. Set it too low and NPCs flip character scene to
 * scene; too high and nobody ever changes. Six is roughly "this kept happening"
 * rather than "this happened once".
 */
export const PERSONALITY_THRESHOLD = 6;

/** Pressure bleeds off, so isolated moments never accumulate into a change. */
export const PRESSURE_DECAY = 1;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

type Deltas = { mental: Partial<MentalState>; pressure: Partial<Personality> };

const EMPTY: Deltas = { mental: {}, pressure: {} };

/** What one thing that happened does to a person. */
function effectOf(cause: DriftCause): Deltas {
  switch (cause.kind) {
    case 'check':
      // Failing is wearing; succeeding steadies you.
      if (cause.tier === 'hit') return { mental: { morale: 1, stress: -1 }, pressure: { nerve: 1 } };
      if (cause.tier === 'miss') return { mental: { morale: -1, stress: 1 }, pressure: { nerve: -1 } };
      return { mental: { stress: 1 }, pressure: {} };

    case 'trust':
      // Being treated well warms people; being let down hardens them.
      if (cause.change > 0) return { mental: { morale: 1 }, pressure: { warmth: 1, loyalty: 1 } };
      if (cause.change < 0) return { mental: { morale: -1 }, pressure: { warmth: -1, loyalty: -1 } };
      return EMPTY;

    case 'address':
      // Being spoken to crudely costs more than the trust hit alone: it is the
      // repeated slight that eventually changes who someone is toward you.
      if (cause.tone === 'crude') return { mental: { stress: 1, morale: -1 }, pressure: { warmth: -2, loyalty: -1 } };
      if (cause.tone === 'deferential' || cause.tone === 'formal') return { mental: {}, pressure: { warmth: 1 } };
      return EMPTY;

    case 'travel':
      return { mental: { fatigue: Math.max(1, Math.round(cause.cost)) }, pressure: {} };

    case 'danger':
      // Deep floors are wearing even when nothing attacks you.
      return {
        mental: { stress: clamp(cause.level / 4, 0, 3) },
        pressure: { nerve: cause.level >= 8 ? -1 : 0 },
      };

    case 'rest':
      return {
        mental: {
          stress: -Math.max(1, Math.round(cause.quality)),
          fatigue: -Math.max(1, Math.round(cause.quality)),
          morale: cause.quality >= 2 ? 1 : 0,
        },
        pressure: {},
      };
  }
}

export type AxisChange = { axis: Axis; from: number; to: number };

export type DriftResult = {
  persona: Persona;
  /** Dispositions that actually shifted. These are story beats worth narrating. */
  changed: AxisChange[];
};

/**
 * Apply everything that happened to one person.
 *
 * Mental state moves immediately and is clamped. Disposition only accumulates
 * pressure; it shifts a single step when that pressure crosses the threshold,
 * and never more than one step at a time however bad the day was.
 */
export function applyDrift(persona: Persona, causes: DriftCause[]): DriftResult {
  const mental: MentalState = { ...persona.mental };
  const pressure: Personality = { ...persona.pressure };
  // Which axes were actually pushed this turn. Decay must only touch the rest,
  // or a steady pressure of one per turn cancels itself and nobody ever changes.
  const pushed = new Set<Axis>();

  for (const cause of causes) {
    const effect = effectOf(cause);
    mental.stress += effect.mental.stress ?? 0;
    mental.morale += effect.mental.morale ?? 0;
    mental.fatigue += effect.mental.fatigue ?? 0;
    for (const axis of AXES) {
      const push = effect.pressure[axis] ?? 0;
      if (push === 0) continue;
      pressure[axis] += push;
      pushed.add(axis);
    }
  }

  mental.stress = clamp(mental.stress, 0, STRESS_MAX);
  mental.morale = clamp(mental.morale, AXIS_MIN, AXIS_MAX);
  mental.fatigue = clamp(mental.fatigue, 0, FATIGUE_MAX);

  const personality: Personality = { ...persona.personality };
  const changed: AxisChange[] = [];

  for (const axis of AXES) {
    if (Math.abs(pressure[axis]) >= PERSONALITY_THRESHOLD) {
      const step = Math.sign(pressure[axis]);
      const from = personality[axis];
      const to = clamp(from + step, AXIS_MIN, AXIS_MAX);
      if (to !== from) changed.push({ axis, from, to });
      personality[axis] = to;
      // Spend the pressure whether or not the axis could move, so someone
      // already at the extreme does not fire a change every single turn.
      pressure[axis] -= step * PERSONALITY_THRESHOLD;
    } else if (pressure[axis] !== 0 && !pushed.has(axis)) {
      // Bleed off only what nothing reinforced, so one bad exchange fades but a
      // pattern of them still builds.
      const decay = Math.sign(pressure[axis]) * Math.min(PRESSURE_DECAY, Math.abs(pressure[axis]));
      pressure[axis] -= decay;
    }
  }

  return { persona: { ...persona, mental, personality, pressure }, changed };
}

const AXIS_STORY: Record<Axis, [colder: string, warmer: string]> = {
  warmth: ['has grown colder toward you', 'has warmed to you'],
  nerve: ['is losing their nerve', 'is steadier than they were'],
  discipline: ['is fraying at the edges', 'has tightened their grip on themselves'],
  candour: ['is guarding their words more', 'speaks more plainly than they used to'],
  loyalty: ['is drifting away from you', 'is more committed to you than before'],
};

/**
 * A shifted disposition rendered as something the Writer can use.
 *
 * This is the point of tracking it: a change the player can feel in how someone
 * speaks, rather than a number that moved silently.
 */
export function describeChanges(changed: AxisChange[]): string[] {
  return changed.map(({ axis, from, to }) => AXIS_STORY[axis][to > from ? 1 : 0]);
}
