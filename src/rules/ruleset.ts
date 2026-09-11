import type { Claim } from '../character/belief.ts';
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

/**
 * One place a thing can be worn.
 *
 * `takes` is what an ITEM declares, and `id` is the place it goes — which is
 * how a world gets two rings without any code learning to count them. Both
 * ring slots take `ring`; an item never says which hand.
 */
export type SlotSpec = { id: string; takes: string; name: string };

export type GearRules = {
  /**
   * How much condition a fight takes out of everything you are wearing.
   *
   * ZERO IS THE IDENTITY VALUE: gear never degrades, and the same code runs
   * over it. A world with no smiths in it is a dial, not a missing system.
   */
  wearPerFight: number;
  /**
   * WHERE THIS WORLD LETS YOU WEAR THINGS.
   *
   * A fixed enum of three could not say that a world has no boots in it, or
   * that this one lets you wear two rings. Unlike the numeric dials it is a
   * content choice rather than a difficulty one, so the presets share a set and
   * the point is that a WORLD may declare its own.
   *
   * Only `equip` reads it. Everything that asks what is WORN reads the equipped
   * map, which already says — so a world's slot set never has to be threaded
   * through the dozen places that merely look.
   */
  slots: SlotSpec[];
  /**
   * Whether a thing may be turned to make it fit.
   *
   * A rule rather than an assumption. With it off a pack is packed as things
   * come, and a long spear does not go in a short bag however you hold it —
   * which is a different game, not a broken one.
   */
  rotateInBags: boolean;
  /** How far a thing can be refined. Nought is a world with no smiths. */
  maxRefine: number;
  /**
   * Failure, as TWO NUMBERS rather than a mode — so there is one code path and
   * no switch on a rule.
   *
   * `refineRisk` at nought never fails, which is Genshin. `refineLoss` at
   * nought is a stall: the fee is gone and the object untouched. One is the
   * middle case. A loss larger than `maxRefine` destroys the thing outright,
   * which is what RO does.
   */
  refineRisk: number;
  refineLoss: number;
  /**
   * How much a mending takes off what a piece can be mended TO.
   *
   * ZERO IS THE IDENTITY VALUE — a world where a smith can always make a thing
   * as good as new, and the same code runs over it. Above nought, gear has a
   * lifespan and the blade you find on floor twelve eventually matters.
   */
  repairLoss: number;
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

/**
 * The axes a law can govern. Four, and no more without a design decision.
 */
export const RULE_AXES = ['movement', 'knowledge', 'progression', 'economy'] as const;
export type RuleAxis = (typeof RULE_AXES)[number];

/**
 * Everything a law can forbid.
 *
 * CLOSED, and that is the point: a model that can write "NPCs cannot lie"
 * produces a rule nothing enforces. The model names and dresses a law; the
 * engine decides what one can say. Grows only when a constraint gains a
 * checker — an entry nobody reads is a dead field, which is what §12 of
 * ARCHITECTURE.md exists to catch.
 */
export const CONSTRAINTS = [
  // movement
  'descendBelowGround', 'crossFloors',
  // progression
  'gainLevels',
  // economy
  'takeLoot',
  // knowledge
  'keepMemories',
] as const;
export type Constraint = (typeof CONSTRAINTS)[number];

/**
 * Whom a law binds. **Whether the player is bound is part of the law**, so no
 * check anywhere may assume the player is the exception.
 */
/**
 * The axis each constraint belongs to.
 *
 * Kept as a map rather than a comment beside the list, because an amendment has
 * to BUILD a law at runtime and something has to know which axis it lands on.
 * Exhaustive by type: a new constraint will not compile without one.
 */
export const AXIS_OF: Record<Constraint, RuleAxis> = {
  descendBelowGround: 'movement',
  crossFloors: 'movement',
  gainLevels: 'progression',
  takeLoot: 'economy',
  keepMemories: 'knowledge',
};

export const BINDINGS = ['all', 'residents', 'player'] as const;
export type Binding = (typeof BINDINGS)[number];

export const SUBJECT_KINDS = ['player', 'resident'] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

/**
 * Who is asking. Every law check takes one.
 *
 * A bare kind is somebody ordinary. The object form is somebody carrying
 * EXEMPTIONS — what a Signet is, per the design. The exemptions travel WITH the
 * subject rather than being looked up inside `forbids`, for two reasons: the
 * rules layer stays free of the play layer that knows what a Signet is, and a
 * check that had to fetch the holder is a check that will one day be called
 * without one, which is the hardcoded "the player is exempt" this step removed.
 */
export type Subject = SubjectKind | { kind: SubjectKind; exempt: readonly Constraint[] };

const kindOf = (subject: Subject): SubjectKind =>
  typeof subject === 'string' ? subject : subject.kind;

const exemptFrom = (subject: Subject, constraint: Constraint): boolean =>
  typeof subject !== 'string' && subject.exempt.includes(constraint);

export type Law = {
  axis: RuleAxis;
  constraint: Constraint;
  binds: Binding;
};

export type Ruleset = {
  body: BodyRules;
  combat: CombatRules;
  persona: PersonaRules;
  knowledge: KnowledgeRules;
  gear: GearRules;
  rest: RestRules;
  world: WorldRules;
  /** The laws in force. A world with none forbids nothing. */
  laws: Law[];
};

/**
 * The places a person can wear something, as most worlds have them.
 *
 * Two rings, because a second ring is the case a fixed enum cannot express
 * without the code learning to count — and it does not have to, since both
 * slots simply `take` a ring.
 */
export const BODY_SLOTS: SlotSpec[] = [
  { id: 'main', takes: 'main', name: 'in hand' },
  { id: 'offhand', takes: 'offhand', name: 'off hand' },
  { id: 'head', takes: 'head', name: 'head' },
  { id: 'body', takes: 'body', name: 'body' },
  { id: 'back', takes: 'back', name: 'back' },
  { id: 'leg', takes: 'leg', name: 'legs' },
  { id: 'foot', takes: 'foot', name: 'feet' },
  { id: 'neck', takes: 'neck', name: 'neck' },
  { id: 'wrist', takes: 'wrist', name: 'wrist' },
  { id: 'ring_l', takes: 'ring', name: 'left ring' },
  { id: 'ring_r', takes: 'ring', name: 'right ring' },
];

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
  gear: {
    wearPerFight: 2, slots: [...BODY_SLOTS], rotateInBags: true,
    maxRefine: 10, refineRisk: 0.25, refineLoss: 1, repairLoss: 8,
  },
  rest: { shortTurns: 1, longTurns: 8 },
  world: { dangerBase: 0, dangerPerFloor: 1 },
  laws: [
    // What `descend` used to assert on its own: the ground is the bottom.
    { axis: 'movement', constraint: 'descendBelowGround', binds: 'all' },
    // Nothing moves an NPC between floors today, so this makes an accident of
    // the engine into a statement of the world.
    { axis: 'movement', constraint: 'crossFloors', binds: 'residents' },
  ],
};

/** Deep-copy so a preset can be edited field by field without touching another. */
const copy = (rules: Ruleset): Ruleset => ({
  body: { ...rules.body },
  combat: { ...rules.combat },
  persona: { ...rules.persona },
  knowledge: { ...rules.knowledge },
  gear: { ...rules.gear, slots: rules.gear.slots.map((slot) => ({ ...slot })) },
  rest: { ...rules.rest },
  world: { ...rules.world },
  laws: rules.laws.map((law) => ({ ...law })),
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
  gear: { ...STANDARD.gear, wearPerFight: 0, refineRisk: 0, repairLoss: 0 },
  world: { ...STANDARD.world, dangerPerFloor: 0 },
};

/** A harder world: things hurt more, people change faster, the climb bites. */
export const HARSH: Ruleset = {
  ...copy(STANDARD),
  body: { ...STANDARD.body, carryBase: 12, overloadStep: 5 },
  combat: { ...STANDARD.combat, soakCeiling: 1 },
  persona: { ...STANDARD.persona, driftThreshold: 4, suitSwing: 0.4 },
  knowledge: { spreadDepth: 4, reputationWeight: 1.5, ambientHops: 2, ambientFade: 0.05 },
  gear: { ...STANDARD.gear, wearPerFight: 5, refineRisk: 0.4, refineLoss: 99, repairLoss: 15 },
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
 * Step 6 answered the question this used to defer. Per-subject resolution went
 * to `forbids` instead of here: laws are a separate list on the same Ruleset,
 * and a dial has no subject — carryBase is the same number whoever asks.
 * Renaming this to `ruleFor(world, subject, axis)` would have touched 27 call
 * sites and made every tuning read invent a subject, for no change in
 * behaviour. Revisit only if a Signet has to change a NUMBER rather than a
 * permission.
 */
export const rulesOf = (from?: { rules?: Ruleset } | null): Ruleset => from?.rules ?? STANDARD;

/**
 * The same ruleset with one law rebound, imposed, or struck out.
 *
 * `binds: null` lifts the law entirely. Anything else replaces the existing law
 * on that constraint rather than adding a second one — two laws about the same
 * thing is a contradiction the engine would resolve by list order, which is no
 * answer at all.
 *
 * Returns a NEW ruleset: presets are shared objects, and a world that edited
 * one in place would retune every other run in the process.
 */
export const amend = (rules: Ruleset, constraint: Constraint, binds: Binding | null): Ruleset => ({
  ...rules,
  laws: [
    ...rules.laws.filter((law) => law.constraint !== constraint),
    ...(binds ? [{ axis: AXIS_OF[constraint], constraint, binds }] : []),
  ],
});

/**
 * A belief ABOUT a law. Keyed on the closed vocabulary, so a belief about a rule
 * the engine does not check cannot be spelled.
 */
export const ruleClaim = (constraint: Constraint): Claim => ({ kind: 'rule', rule: constraint });

const bindsSubject = (binds: Binding, subject: Subject): boolean =>
  binds === 'all' || (binds === 'player' ? kindOf(subject) === 'player' : kindOf(subject) === 'resident');

/**
 * The law stopping this subject from doing this, or `null` if nothing does.
 *
 * Returns the law rather than a boolean so a caller can say WHICH rule it was
 * — a refusal nobody can attribute is what makes a world feel arbitrary.
 *
 * Exemptions arrive on the SUBJECT (see `Subject`), which is what makes a
 * Signet a rule exemption rather than a stat line — `playerSubject` in
 * `play/signetbook.ts` builds one from the sheet.
 *
 * `ponytail: a subject is still a KIND plus its exemptions, not a person id.
 * That is enough while the player is the only one who can hold a Signet
 * (`Person` has no sheet in play). Widen it when an NPC can hold one — the
 * exemption itself will not have to change, only who can be handed one.`
 */
export const forbids = (
  from: { rules?: Ruleset } | null | undefined,
  subject: Subject,
  constraint: Constraint,
): Law | null =>
  exemptFrom(subject, constraint)
    ? null
    : rulesOf(from).laws.find(
        (law) => law.constraint === constraint && bindsSubject(law.binds, subject),
      ) ?? null;
