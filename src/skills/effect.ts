import type { Ability, Condition } from '../combat/types.ts';

/**
 * What an action DOES, built from parts.
 *
 * The eight payloads this replaces — strike, burst, hinder, hex, drain, mend,
 * rally, edge — were a closed union that kept needing new arms, and two of them
 * were secretly compound: `drain` is "hurt them" AND "heal me", `hex` is "hurt
 * them" AND "stick a condition on them". A union that has to fuse pairs is a
 * union asking to be decomposed.
 *
 * So an effect is components:
 *
 *   sign      does the recipient GAIN or LOSE by it
 *   channel   what is touched: hp, a pool, a score, a condition, or a verb
 *   who       own · friend · foe · everyone
 *   shape     self · single · burst · cone · line
 *   duration  instant · a number of rounds · sustained
 *   formula   how much, flat and optionally scaling off a stat
 *
 * AND AN ACTION HAS A LIST OF THEM, each tagged `purpose` or `cost`. That is
 * what makes `drain` two purposes rather than a special case, and it is what
 * lets a cost be something other than a pool — blood magic pays in hp, a
 * reckless move pays in a condition on yourself, and neither needs new
 * machinery.
 *
 * SIGN IS FROM THE RECIPIENT'S SIDE, always. `minus` on a condition means it
 * lands on them; `plus` means it is cleared. That one convention is what lets
 * `hinder` and `rally` be the same shape pointed differently, instead of two
 * entries in a table.
 *
 * The vocabulary stays CLOSED. A model may name a skill and say what it feels
 * like; it never invents a channel, and nothing here is free text.
 */

export const EFFECT_ROLES = ['purpose', 'cost'] as const;
export type EffectRole = (typeof EFFECT_ROLES)[number];

/** Whether the recipient gains by it or loses by it. */
export const SIGNS = ['plus', 'minus'] as const;
export type Sign = (typeof SIGNS)[number];

export const WHO = ['own', 'friend', 'foe', 'everyone'] as const;
export type Who = (typeof WHO)[number];

export const CHANNELS = ['hp', 'stamina', 'mana', 'stat', 'condition', 'special'] as const;
export type Channel = (typeof CHANNELS)[number];

/**
 * The verbs for things that are not a number moving.
 *
 * A closed registry, deliberately, and seeded with what the engine can already
 * resolve. A free-text "special" would be a field with no reader — this
 * codebase's signature bug — so A VERB EXISTS HERE ONLY ONCE SOMETHING CAN
 * CARRY IT OUT.
 *
 * `displace` was named in the design and is NOT here yet, for exactly that
 * reason: shoving somebody needs the board — where the walls are, who is
 * standing where — and the resolver is handed a combatant, not a grid. Listing
 * it before then would have shipped a verb that silently did nothing, which is
 * the bug this comment exists to prevent.
 */
export const SPECIAL_VERBS = ['interrupt', 'cleanse', 'taunt'] as const;
export type SpecialVerb = (typeof SPECIAL_VERBS)[number];

/** What is being touched, and whatever that channel needs to name. */
export type Payload =
  | { channel: 'hp' }
  | { channel: 'stamina' }
  | { channel: 'mana' }
  | { channel: 'stat'; stat: Ability }
  | { channel: 'condition'; condition: Condition }
  | { channel: 'special'; verb: SpecialVerb };

export type Shape =
  | { kind: 'self' }
  | { kind: 'single' }
  | { kind: 'burst'; radius: number }
  | { kind: 'cone'; length: number }
  | { kind: 'line'; length: number };

export type Duration =
  | { kind: 'instant' }
  | { kind: 'rounds'; rounds: number }
  /** Held while it is paid for. Standing bonuses are this. */
  | { kind: 'sustained' };

/**
 * How much.
 *
 * `flat` alone covers everything the old payloads did. `scale` is the join to
 * the persona work: a magnitude can come off an ability OR a temperament axis,
 * so a reckless skill can genuinely hit harder for somebody bold.
 */
export type Formula = {
  flat: number;
  scale?: { of: string; per: number };
};

export type Effect = Payload & {
  role: EffectRole;
  sign: Sign;
  who: Who;
  shape: Shape;
  duration: Duration;
  formula: Formula;
};

/* -------------------------------------------------------------------------- */
/* Reading one                                                                 */
/* -------------------------------------------------------------------------- */

export const flat = (amount: number): Formula => ({ flat: amount });
export const instant: Duration = { kind: 'instant' };
export const self: Shape = { kind: 'self' };
export const single: Shape = { kind: 'single' };

export const purposes = (effects: readonly Effect[]): Effect[] => effects.filter((e) => e.role === 'purpose');
export const costs = (effects: readonly Effect[]): Effect[] => effects.filter((e) => e.role === 'cost');

/** How much this effect is worth against a particular holder. */
export function magnitudeOf(effect: Effect, scores: Record<string, number> = {}): number {
  const { flat: base, scale } = effect.formula;
  if (!scale) return base;
  return base + (scores[scale.of] ?? 0) * scale.per;
}

/** Whether anything in the list needs somebody on the other end. */
export const reachesOut = (effects: readonly Effect[]): boolean =>
  purposes(effects).some((e) => e.who === 'foe' || e.who === 'friend' || e.who === 'everyone');

/** The widest radius any purpose spreads to. */
export const radiusOf = (effects: readonly Effect[]): number =>
  purposes(effects).reduce((widest, e) => Math.max(widest, e.shape.kind === 'burst' ? e.shape.radius : 0), 0);

/**
 * Whether this does anything inside a fight.
 *
 * The old `ActiveKind` said so by category — combat, social, utility — and the
 * user's rule is that a skill is used AS YOU PLEASE, like D&D. So the answer
 * comes from the effect itself: a standing bonus you hold is not a thing you
 * spend a turn on, and everything else is.
 */
export const usableInCombat = (effects: readonly Effect[]): boolean =>
  purposes(effects).some((e) => e.duration.kind !== 'sustained');

/**
 * A standing bonus on checks of one ability, if this action grants one.
 *
 * What `edge` used to be, expressed rather than enumerated: a sustained plus on
 * a stat, aimed at yourself.
 */
export function standingBonus(effects: readonly Effect[], ability: Ability): number {
  return purposes(effects).reduce((total, e) => {
    const applies = e.channel === 'stat'
      && e.stat === ability
      && e.sign === 'plus'
      && e.who === 'own'
      && e.duration.kind === 'sustained';
    return applies ? total + magnitudeOf(e) : total;
  }, 0);
}
