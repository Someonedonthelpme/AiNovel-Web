import type { Tier } from '../engine/roll.ts';
import { STANDARD } from '../rules/ruleset.ts';
import type { Ruleset } from '../rules/ruleset.ts';
import type { Tone } from '../llm/register.ts';
import { NEEDS, NEED_MAX, TEMPERAMENT, TEMPER_MAX, TEMPER_MIN } from './persona.ts';
import type { Needs, Persona, Temperament, TemperamentAxis } from './persona.ts';

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
export const PERSONALITY_THRESHOLD = STANDARD.persona.driftThreshold;

/** Pressure bleeds off, so isolated moments never accumulate into a change. */
export const PRESSURE_DECAY = STANDARD.persona.pressureDecay;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

/**
 * Needs move IMMEDIATELY and signed — positive restores, negative wears down.
 * Temperament only accumulates pressure.
 */
type Deltas = { needs: Partial<Needs>; pressure: Partial<Temperament> };

const EMPTY: Deltas = { needs: {}, pressure: {} };

/** What one thing that happened does to a person. */
function effectOf(cause: DriftCause): Deltas {
  switch (cause.kind) {
    case 'check':
      // Failing is wearing; succeeding steadies you and tells you it was worth it.
      // A clean result confirms that the plain reading was right; an ambiguous
      // one is what teaches somebody to look for what is underneath it.
      if (cause.tier === 'hit') return { needs: { safety: 1, purpose: 1 }, pressure: { nerve: 1, intuition: -1 } };
      if (cause.tier === 'miss') return { needs: { safety: -1, purpose: -1 }, pressure: { nerve: -1 } };
      return { needs: { safety: -1 }, pressure: { intuition: 1 } };

    case 'trust':
      // Being treated well meets the need other people exist to meet.
      if (cause.change > 0) return { needs: { company: 2 }, pressure: { feeling: 1 } };
      if (cause.change < 0) return { needs: { company: -2 }, pressure: { feeling: -1 } };
      return EMPTY;

    case 'address':
      // Being spoken to crudely costs more than the trust hit alone: it is the
      // repeated slight that eventually changes who someone is toward you.
      if (cause.tone === 'crude') return { needs: { company: -2, safety: -1 }, pressure: { feeling: -1 } };
      if (cause.tone === 'deferential' || cause.tone === 'formal') return { needs: { company: 1 }, pressure: {} };
      return EMPTY;

    case 'travel':
      // A hard march frays the grip somebody keeps on themselves.
      return {
        needs: { rest: -Math.max(1, Math.round(cause.cost)), food: -1 },
        pressure: { discipline: cause.cost >= 3 ? -1 : 0 },
      };

    case 'danger':
      // Deep floors are wearing even when nothing attacks you.
      return {
        needs: { safety: -clamp(cause.level / 4, 0, 3) },
        pressure: { nerve: cause.level >= 8 ? -1 : 0 },
      };

    case 'rest': {
      const eased = Math.max(1, Math.round(cause.quality));
      // Making camp is eating as well as sleeping — a short rest spends a
      // ration, so food is restored here rather than needing a cause of its own.
      // And a kept routine is where self-control actually comes from.
      return {
        needs: { rest: eased, safety: eased, food: eased, purpose: cause.quality >= 2 ? 1 : 0 },
        pressure: { discipline: cause.quality >= 2 ? 1 : 0 },
      };
    }
  }
}

export type AxisChange = { axis: TemperamentAxis; from: number; to: number };

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
export function applyDrift(
  persona: Persona, causes: DriftCause[], rules: Ruleset = STANDARD,
): DriftResult {
  const needs: Needs = { ...persona.needs };
  const pressure: Temperament = { ...persona.pressure };
  // Which axes were actually pushed this turn. Decay must only touch the rest,
  // or a steady pressure of one per turn cancels itself and nobody ever changes.
  const pushed = new Set<TemperamentAxis>();

  for (const cause of causes) {
    const effect = effectOf(cause);
    for (const need of NEEDS) needs[need] += effect.needs[need] ?? 0;
    for (const axis of TEMPERAMENT) {
      const push = effect.pressure[axis] ?? 0;
      if (push === 0) continue;
      pressure[axis] += push;
      pushed.add(axis);
    }
  }

  for (const need of NEEDS) needs[need] = clamp(needs[need], 0, NEED_MAX);

  const temperament: Temperament = { ...persona.temperament };
  const changed: AxisChange[] = [];

  for (const axis of TEMPERAMENT) {
    if (Math.abs(pressure[axis]) >= rules.persona.driftThreshold) {
      const step = Math.sign(pressure[axis]);
      const from = temperament[axis];
      const to = clamp(from + step, TEMPER_MIN, TEMPER_MAX);
      if (to !== from) changed.push({ axis, from, to });
      temperament[axis] = to;
      // Spend the pressure whether or not the axis could move, so someone
      // already at the extreme does not fire a change every single turn.
      pressure[axis] -= step * rules.persona.driftThreshold;
    } else if (pressure[axis] !== 0 && !pushed.has(axis)) {
      // Bleed off only what nothing reinforced, so one bad exchange fades but a
      // pattern of them still builds.
      const decay = Math.sign(pressure[axis]) * Math.min(rules.persona.pressureDecay, Math.abs(pressure[axis]));
      pressure[axis] -= decay;
    }
  }

  return { persona: { ...persona, needs, temperament, pressure }, changed };
}

const AXIS_STORY: Record<TemperamentAxis, [lower: string, higher: string]> = {
  intuition: ['is dealing in what is in front of them', 'is reaching for what it might mean'],
  feeling: ['is arguing from the ledger', 'is arguing from what matters to them'],
  nerve: ['is losing their nerve', 'is steadier than they were'],
  discipline: ['is fraying at the edges', 'has tightened their grip on themselves'],
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
