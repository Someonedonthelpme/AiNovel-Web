/**
 * The ruleset: one game config, and the master dial of the whole engine.
 *
 * The directive this exists for: **every system relies on rules, so a world can
 * go from deepest realism to simple game.** One engine, dialled.
 *
 * IDENTITY VALUES, ONE CODE PATH — the principle that keeps that affordable.
 * Never branch on a rule. Always run the deepest implementation, and let
 * "simple" be that same code with its dials at neutral:
 *
 *   no encumbrance      carryPerStr huge, or overloadStep huge
 *   nobody soaks        soakCeiling 0
 *   nobody changes      driftThreshold ∞
 *   danger is flat      dangerPerFloor 0
 *
 * Fifteen systems times N modes is a combinatorial test surface, and the simple
 * path rots because nobody plays it. With identity values there is ONE path,
 * always exercised, and adding a rule later is free because the deep path
 * already exists.
 *
 * THE PLUMBING IS DELIBERATELY SMALL. Rules only need to reach the places that
 * WRITE (decay, wear, promotion) and the places that GATE. Everything that
 * merely READS derived state is untouched — which is why every consumer below
 * takes the ruleset as an OPTIONAL parameter defaulting to `STANDARD`. A call
 * site that has a world passes its rules; every other call site, and every
 * existing test, keeps working unchanged.
 *
 * That default is also the verification: converting a constant into a lookup
 * whose default is that same constant must leave the entire suite green. If it
 * does not, the conversion changed behaviour and is not a refactor.
 */

export type BodyRules = {
  /** Carrying capacity: `carryBase + STR × carryPerStr`. */
  carryBase: number;
  carryPerStr: number;
  /** How much overload costs a square of movement. Huge means "no encumbrance". */
  overloadStep: number;
  /** Movement is `baseSpeed + AGI mod`, floored at `minSpeed`. */
  baseSpeed: number;
  minSpeed: number;
};

export type CombatRules = {
  /** The most VIT may absorb from any blow. Zero means nobody soaks. */
  soakCeiling: number;
  /** And never more than this share of the blow itself. */
  soakShare: number;
  /** A landed hit always costs at least this. */
  minHit: number;
  /** However tough you are, a condition lands for at least this many rounds. */
  conditionFloor: number;
  /** Ticks a round grants, and the least any action can cost. */
  turnLength: number;
  minActionTicks: number;
};

export type PersonaRules = {
  /** Pressure needed before temperament shifts a step. Huge means nobody changes. */
  driftThreshold: number;
  /** How fast unreinforced pressure bleeds away. */
  pressureDecay: number;
  /**
   * How far suitability moves a number, as a fraction.
   *
   * The signed budget in `skills/suit.ts`: a perfectly suited action costs this
   * much less, hits this much harder and comes off this much faster, and a
   * perfectly unsuited one pays the same on every channel. ZERO IS THE IDENTITY
   * VALUE — the same code runs, and who somebody is presses on nothing.
   */
  suitSwing: number;
};

export type GearRules = {
  /**
   * How much condition a fight takes out of everything you are wearing.
   *
   * ZERO IS THE IDENTITY VALUE: gear never degrades, and the same code runs
   * over it. A world with no smiths in it is a dial, not a missing system.
   */
  wearPerFight: number;
};

export type RestRules = {
  shortTurns: number;
  longTurns: number;
};

export type WorldRules = {
  /** Danger is `dangerBase + floor × dangerPerFloor` — no longer just the floor. */
  dangerBase: number;
  dangerPerFloor: number;
};

export type KnowledgeRules = {
  /**
   * DEGREES OF SEPARATION a deed travels, not a headcount.
   *
   * "Seven person theory": what you did spreads along the chain of acquaintance
   * and stops after so many hops, so who hears about it follows the story
   * rather than the map — and nobody has to be evicted to make room.
   *
   * ZERO IS THE IDENTITY VALUE: a deed reaches the people who saw it and goes
   * no further, which is a world where nothing gets around.
   */
  spreadDepth: number;
  /** How hard a deed moves the standing of the place it happened in. */
  reputationWeight: number;
  /**
   * How far news creeps across the MAP in one turn, in places.
   *
   * The other half of propagation, and a different axis from `spreadDepth`:
   * that one is degrees of acquaintance, this one is streets. ZERO IS THE
   * IDENTITY VALUE — nothing ever leaves the room it happened in.
   */
  ambientHops: number;
  /**
   * How much of what is merely going around is lost each turn.
   *
   * GOSSIP IS NOT MEMORY: what somebody SAW stays with them for good, while
   * what is in the air thins until it is not worth repeating. Zero is the
   * identity value — a world that never forgets a thing.
   */
  ambientFade: number;
};

export type Ruleset = {
  body: BodyRules;
  combat: CombatRules;
  persona: PersonaRules;
  knowledge: KnowledgeRules;
  gear: GearRules;
  rest: RestRules;
  world: WorldRules;
};

/**
 * Today's numbers, exactly.
 *
 * The default preset is not "a sensible starting point" — it is the values the
 * engine already had, so that converting constants into lookups is provably a
 * refactor. Changing any of these is a balance decision, not a cleanup.
 */
export const STANDARD: Ruleset = {
  body: { carryBase: 20, carryPerStr: 2, overloadStep: 8, baseSpeed: 6, minSpeed: 3 },
  combat: { soakCeiling: 2, soakShare: 1 / 3, minHit: 1, conditionFloor: 1, turnLength: 6, minActionTicks: 2 },
  persona: { driftThreshold: 6, pressureDecay: 1, suitSwing: 0.25 },
  knowledge: { spreadDepth: 2, reputationWeight: 1, ambientHops: 1, ambientFade: 0.1 },
  gear: { wearPerFight: 2 },
  rest: { shortTurns: 1, longTurns: 8 },
  world: { dangerBase: 0, dangerPerFloor: 1 },
};

/** Deep-copy so a preset can be edited field by field without touching another. */
const copy = (rules: Ruleset): Ruleset => ({
  body: { ...rules.body },
  combat: { ...rules.combat },
  persona: { ...rules.persona },
  knowledge: { ...rules.knowledge },
  gear: { ...rules.gear },
  rest: { ...rules.rest },
  world: { ...rules.world },
});

/**
 * Every dial at neutral — the "simple game" end of the range.
 *
 * Not an absence of rules: the same code runs, with nothing pressing on it.
 * Nobody soaks, nobody is slowed by what they carry, nobody's character drifts,
 * and every floor is as dangerous as the first. This is what proves the
 * identity-value claim rather than merely asserting it.
 */
export const PLAIN: Ruleset = {
  ...copy(STANDARD),
  body: { ...STANDARD.body, carryPerStr: 1e6, overloadStep: 1e6 },
  combat: { ...STANDARD.combat, soakCeiling: 0 },
  persona: { ...STANDARD.persona, driftThreshold: Number.POSITIVE_INFINITY, suitSwing: 0 },
  knowledge: { spreadDepth: 0, reputationWeight: 0, ambientHops: 0, ambientFade: 0 },
  gear: { wearPerFight: 0 },
  world: { ...STANDARD.world, dangerPerFloor: 0 },
};

/** A harder world: things hurt more, people change faster, the climb bites. */
export const HARSH: Ruleset = {
  ...copy(STANDARD),
  body: { ...STANDARD.body, carryBase: 12, overloadStep: 5 },
  combat: { ...STANDARD.combat, soakCeiling: 1 },
  persona: { ...STANDARD.persona, driftThreshold: 4, suitSwing: 0.4 },
  knowledge: { spreadDepth: 4, reputationWeight: 1.5, ambientHops: 2, ambientFade: 0.05 },
  gear: { wearPerFight: 5 },
  rest: { shortTurns: 2, longTurns: 12 },
  world: { ...STANDARD.world, dangerPerFloor: 1.5 },
};

export const PRESETS = { standard: STANDARD, plain: PLAIN, harsh: HARSH } as const;
export type PresetName = keyof typeof PRESETS;

export const presetNamed = (name: string): Ruleset =>
  copy(PRESETS[name as PresetName] ?? STANDARD);

/**
 * Override a preset field by field.
 *
 * A preset says what a world IS in one word; an override is for the person who
 * wants exactly one thing different. Both are needed — a wall of sliders is
 * unusable at creation, and a fixed list of presets cannot express "like
 * standard, but starvation is brutal".
 */
export function withOverrides(base: Ruleset, over: DeepPartial<Ruleset>): Ruleset {
  const out = copy(base);
  for (const group of Object.keys(out) as (keyof Ruleset)[]) {
    Object.assign(out[group], over[group] ?? {});
  }
  return out;
}

type DeepPartial<T> = { [K in keyof T]?: Partial<T[K]> };

/**
 * The rules in force.
 *
 * Takes anything that might carry them, so a call site with a `World`, a
 * `PlayState`, or nothing at all can ask the same question. A world without a
 * declared ruleset plays by `STANDARD`, which is what every world did before
 * this existed.
 *
 * `ponytail: no per-subject resolution yet. A rule names who it BINDS and a
 * Signet can exempt one person, so this becomes ruleFor(world, subject, axis)
 * when exemptions land in step 6. Base resolution is all step 1 needs.`
 */
export const rulesOf = (from?: { rules?: Ruleset } | null): Ruleset => from?.rules ?? STANDARD;
