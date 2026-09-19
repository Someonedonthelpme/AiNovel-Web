import { describeMental, describePersonality } from '../character/persona.ts';
import { subjectById, subjectsOf } from '../world/subjects.ts';
import { PLAYER, trustToward } from '../social/edge.ts';
import { owedBy, permittedBy, rolesHeld, rolesOf } from '../social/roles.ts';
import { beliefsAbout, DIRECTOR_DEEDS, isDirectorDeed } from '../social/deed.ts';
import { inherited } from '../social/ambient.ts';
import type { DirectorDeed } from '../social/deed.ts';
import { dispositionOf } from '../character/persona.ts';
import { ABILITIES, PARLEY_EFFECTS } from '../combat/types.ts';
import type { Ability, Combatant, ParleyEffect } from '../combat/types.ts';
import type { Classification, Mode, PlayState, WorldDelta } from '../play/state.ts';
import { CLASSES } from '../play/state.ts';
import { presentHere } from '../play/sighting.ts';
import { timeLine } from '../world/calendar.ts';
import { activeRegion } from '../world/travel.ts';
import type { Provider } from './provider.ts';
import type { WriterBrief } from './redact.ts';
import { forbids, ruleClaim, BINDINGS, CONSTRAINTS } from '../rules/ruleset.ts';
import type { Binding, Constraint } from '../rules/ruleset.ts';
import { believes } from '../character/belief.ts';
import { eraOf, lawFrom, stratumAt } from '../world/strata.ts';
import { FOLK } from '../character/species.ts';

/**
 * The Director decides what happens; it never decides whether you succeed.
 *
 * The key move is the TIER COMMITMENT: when a check is called for, the Director
 * writes the consequences of hitting, partially succeeding and missing — all
 * three — before any dice are rolled. It cannot bias the outcome because it does
 * not know which branch will fire, and it costs one call per turn rather than
 * two.
 *
 * Everything is asked for in the flattest shape that still carries the meaning.
 * A field the model does not have to produce is a field it cannot get wrong.
 */

const str = { type: 'string' } as const;

const obj = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

/** Deliberately flat: sentinels instead of nullables, one trust target. */
const deltaSchema = obj(
  {
    moveTo: str,
    learnFacts: { type: 'array', items: str, maxItems: 3 },
    trustPerson: str,
    trustChange: { type: 'integer', minimum: -3, maximum: 3 },
    /**
     * A DEED, named rather than priced.
     *
     * The model says which of a closed list happened; the deed's own mark
     * decides what it costs, who feels it and how far it gets. Same division as
     * `useItem`: name the draught, and the item decides what drinking it does.
     */
    deed: { type: 'string', enum: ['none', ...DIRECTOR_DEEDS] },
    deedPerson: str,
    timeSpent: { type: 'integer', minimum: 0, maximum: 3 },
    revealExit: str,
    /** A way OUT that is not the stair. Name the PLACE it leaves from; where it goes is not yours to say. */
    revealWay: str,
    /** Whether a fight breaks out. What shows up is decided by depth, not here. */
    startCombat: { type: 'boolean' },
    /** Who attacked first, when a fight starts: the player, or something else. */
    startedBy: { type: 'string', enum: ['player', 'them'] },
    /** WHICH item is used. What using it does is the item's business. */
    useItem: str,
    equipItem: str,
    rest: { type: 'string', enum: ['none', 'short', 'long'] },
    /*
     * The world's LAW changing, and the only field here that rewrites a rule
     * rather than a fact. Almost always 'none': a law changes when the fiction
     * itself changes it — a gate is sealed, a decree is read out, the tower
     * shifts — never as a way of describing what already is.
     *
     * Closed like `deed`: name a law the engine already keeps, and say whom it
     * now binds. 'none' in `amendBinds` LIFTS it.
     */
    amendLaw: { type: 'string', enum: ['none', ...CONSTRAINTS] },
    amendBinds: { type: 'string', enum: ['none', ...BINDINGS] },
    /**
     * Or a KIND of being, by the id of a group listed in the brief.
     *
     * The one id in this schema that belongs to the world rather than the engine,
     * which is why it is free text and why `validateDelta` refuses a group no
     * world holds. Set with `amendLaw`; it overrides `amendBinds`.
     */
    amendGroup: { type: 'string' },
  },
  [
    'moveTo', 'learnFacts', 'trustPerson', 'trustChange', 'deed', 'deedPerson',
    'timeSpent', 'revealExit', 'startCombat', 'startedBy', 'useItem', 'equipItem', 'rest',
    'amendLaw', 'amendBinds', 'amendGroup', 'revealWay',
  ],
);

const outcomeSchema = obj({ narrate: str, delta: deltaSchema }, ['narrate', 'delta']);

export const DIRECTOR_SCHEMA = obj(
  {
    classification: { type: 'string', enum: [...CLASSES] },
    addressedPerson: str,
    check: obj(
      {
        required: { type: 'boolean' },
        ability: { type: 'string', enum: [...ABILITIES] },
        vsPerson: str,
        onHit: outcomeSchema,
        onPartial: outcomeSchema,
        onMiss: outcomeSchema,
      },
      ['required', 'ability', 'vsPerson', 'onHit', 'onPartial', 'onMiss'],
    ),
    delta: deltaSchema,
    brief: obj(
      {
        intent: str,
        mustInclude: { type: 'array', items: str, maxItems: 3 },
        mustNotMention: { type: 'array', items: str, maxItems: 3 },
        tone: str,
        length: { type: 'string', enum: ['short', 'medium'] },
      },
      ['intent', 'mustInclude', 'mustNotMention', 'tone', 'length'],
    ),
  },
  ['classification', 'addressedPerson', 'check', 'delta', 'brief'],
);

export type FlatDelta = {
  moveTo: string;
  learnFacts: string[];
  trustPerson: string;
  trustChange: number;
  deed: string;
  deedPerson: string;
  timeSpent: number;
  revealExit: string;
  /** A place a way LEADS OUT of, when the player finds one that is not the stair. */
  revealWay: string;
  startCombat: boolean;
  /** 'them' when the player was attacked; 'player' when they struck first. */
  startedBy: string;
  useItem: string;
  equipItem: string;
  rest: string;
  /** A law this turn changed, from the closed vocabulary. 'none' for the usual turn. */
  amendLaw: string;
  /** Whom it now binds — or 'none' to lift it entirely. */
  amendBinds: string;
  amendGroup: string;
};

export type Outcome = { narrate: string; delta: FlatDelta };

export type DirectorOutput = {
  classification: Classification;
  addressedPerson: string;
  check: {
    required: boolean;
    ability: string;
    vsPerson: string;
    onHit: Outcome;
    onPartial: Outcome;
    onMiss: Outcome;
  };
  delta: FlatDelta;
  brief: WriterBrief;
};

/**
 * Each law in words, one phrase per constraint.
 *
 * Exhaustive by type: a new law will not compile without a sentence, which is
 * the point — this used to be a ternary that described every constraint but one
 * as "residents cannot leave a floor", and the Director would have believed it.
 */
const LAW_IN_WORDS: Record<Constraint, string> = {
  descendBelowGround: 'the ground is the bottom',
  crossFloors: 'residents cannot leave a floor',
  gainLevels: 'nobody here grows stronger by surviving',
  takeLoot: 'nothing here may be carried away',
  keepMemories: 'nothing is remembered across a crossing',
};

/**
 * Words a model reaches for when it means "nothing here".
 *
 * The schema asks for an empty string, but models answer an optional field with
 * "none" or "null" often enough that treating those literally produces a stream
 * of refusals for a place called "none".
 */
const EMPTY_SENTINELS = new Set(['', 'none', 'null', 'nil', 'n/a', 'na', '-', 'nobody', 'no one', 'ไม่มี']);

const meaningful = (value: string | undefined): string | null => {
  const trimmed = (value ?? '').trim();
  return trimmed && !EMPTY_SENTINELS.has(trimmed.toLowerCase()) ? trimmed : null;
};

/** Flat shape from the model back into the delta the engine validates. */
export function toWorldDelta(flat: FlatDelta): WorldDelta {
  const delta: WorldDelta = {};
  const moveTo = meaningful(flat.moveTo);
  const revealExit = meaningful(flat.revealExit);
  const trustPerson = meaningful(flat.trustPerson);

  if (moveTo) delta.moveTo = moveTo;
  if (revealExit) delta.revealExit = revealExit;
  const revealWay = meaningful(flat.revealWay);
  if (revealWay) delta.revealWay = revealWay;
  if (flat.learnFacts?.length) {
    const facts = flat.learnFacts.filter((f) => meaningful(f));
    if (facts.length) delta.learnFacts = facts;
  }
  if (trustPerson && flat.trustChange) delta.trust = { [trustPerson]: flat.trustChange };

  // The engine keeps `drewOn`, `killed` and `spared` to itself: those are
  // outcomes it resolves, and a model able to claim one could report a killing
  // that never happened.
  const deedPerson = meaningful(flat.deedPerson);
  if (isDirectorDeed(flat.deed ?? '') && deedPerson) {
    delta.deed = { kind: flat.deed as DirectorDeed, toward: deedPerson };
  }
  if (typeof flat.timeSpent === 'number') delta.timeSpent = flat.timeSpent;
  if (flat.startCombat) {
    delta.startCombat = true;
    if (flat.startedBy === 'them') delta.startedBy = 'them';
  }

  const useItem = meaningful(flat.useItem) ? flat.useItem : null;
  const equipItem = meaningful(flat.equipItem) ? flat.equipItem : null;
  if (useItem) delta.useItem = useItem;
  if (equipItem) delta.equipItem = equipItem;
  if (flat.rest === 'short' || flat.rest === 'long') delta.rest = flat.rest;

  // Shaped here, CHECKED in `validateDelta` like everything else: this is the
  // conversion, not the trust boundary.
  const amendLaw = meaningful(flat.amendLaw) ? flat.amendLaw : null;
  if (amendLaw) {
    // A group outranks a station: "the hollow may not hold land" is a law about
    // what somebody IS, and saying it binds residents as well would be two rules.
    const group = meaningful(flat.amendGroup) ? flat.amendGroup.trim() : '';
    delta.amendLaw = {
      constraint: amendLaw as Constraint,
      binds: group
        ? { group }
        : meaningful(flat.amendBinds) ? (flat.amendBinds as Binding) : null,
    };
  }

  return delta;
}

/** Merge the unconditional delta with the one the dice selected. */
export function mergeDeltas(base: WorldDelta, outcome: WorldDelta): WorldDelta {
  const trust = { ...(base.trust ?? {}) };
  for (const [id, change] of Object.entries(outcome.trust ?? {})) {
    trust[id] = (trust[id] ?? 0) + change;
  }
  return {
    // The branch the dice picked wins: what happened is one thing, not both.
    // Spread rather than listed, so a verb added to `WorldDelta` cannot be
    // dropped here — `amendLaw` and `revealWay` were, on every checked turn.
    ...base,
    ...outcome,
    // Except where both halves genuinely add up.
    learnFacts: [...(base.learnFacts ?? []), ...(outcome.learnFacts ?? [])],
    trust: Object.keys(trust).length ? trust : undefined,
    flags: { ...(base.flags ?? {}), ...(outcome.flags ?? {}) },
    timeSpent: Math.max(base.timeSpent ?? 0, outcome.timeSpent ?? 0),
    startCombat: base.startCombat || outcome.startCombat,
  };
}

/**
 * What the Director is allowed to see, rendered as text.
 *
 * The affordance list matters most: it is the anti-drift device. The Director
 * chooses from what this place actually offers rather than inventing somewhere
 * new, which is why a world with edges cannot wander.
 */
/**
 * What they climb for, and what they are running from — in the world's own
 * words rather than as ids, so it reads as motive rather than as data.
 */
function driveLine(state: PlayState): string {
  const drive = state.sheet.drive;
  if (!drive) return '';
  const subjects = subjectsOf(state.world);
  const named = (id: string) => subjectById(subjects, id)?.name ?? null;
  const want = named(drive.want);
  const fear = named(drive.fear);
  if (!want && !fear) return '';
  return `They are climbing for ${want ?? 'something they will not name'}, and away from ${fear ?? 'something else'}.`;
}

/**
 * ECHOES (DESIGN 6c era E4): what the climber did on the era floors BELOW this
 * one, in the same band, and how many years back that was. Never the floors
 * above: the past does not remember its future.
 */
function echoesTold(world: PlayState['world'], floor: number): string[] {
  const band = lawFrom(world, floor, 'time');
  if (band?.laws?.time !== 'era') return [];
  return (world.echoes ?? [])
    .filter((e) => e.floor < floor && lawFrom(world, e.floor, 'time')?.id === band.id)
    // ponytail: the five most recent, to keep the prompt small; raise if it has room.
    .slice(-5)
    .map((e) => `  - the climber ${e.kind}${e.whom ? ` ${e.whom}` : ''}${e.where ? ` at ${e.where}` : ''}, `
      + `${eraOf(world, floor) - eraOf(world, e.floor)} years ago`);
}

export function directorContext(state: PlayState, canonFacts: string[]): string {
  const region = activeRegion(state.world);
  const place = region?.places.find((p) => p.id === state.world.currentPlace);
  const exits = place?.connections ?? [];

  const pack = state.pc.inventory.stacks.map((stack) => {
    const worn = Object.values(state.pc.inventory.equipped).includes(stack.item.id) ? ', worn' : '';
    return `  - ${stack.item.id} "${stack.item.name}" x${stack.count} (${stack.item.kind}${worn})`;
  });

  // Who is OUT here: not whoever is away on the road, and at night only the few (7.1e).
  const present = presentHere(state.world)
    .map((id) => state.world.people[id])
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  const named = (id: string) => (id === PLAYER ? state.sheet.name : state.world.people[id]?.name ?? id);

  const people = present.map((p) => {
    const notes = [...describePersonality(dispositionOf(p)), ...describeMental(p.needs)];
    // WHAT they are, but only when it is not the ordinary kind — writing "folk"
    // beside every villager is a word the model reads past on every turn, while
    // omitting "the made" is how a construct ends up complaining of hunger.
    const kind = state.world.species?.find((k) => k.id === p.species && k.id !== FOLK.id);
    return `  - ${p.id} "${p.name}"${kind ? ` [${kind.name}]` : ''}: ${p.oneLine} (trust ${trustToward(state.world.edges, p.id)}, ${p.status}${notes.length ? `, ${notes.join(', ')}` : ''})`;
  });

  /*
   * WHAT THEY THINK THE PLAYER HAS DONE, and how sure they are of it.
   *
   * Belief rather than fact, and the difference is the point: somebody who saw
   * it will act on it, somebody who half-heard a story will not — and somebody
   * can hold a thing that never happened. Without this the beliefs deeds write
   * are a field nothing consults, which is the bug this codebase keeps having.
   */
  const heard = present.flatMap((p) =>
    // "X believes: <the whole claim>" — stripping the doer out of the claim and
    // prefixing the believer read as though the BELIEVER had done it.
    //
    // Their own belief plus whatever is simply IN THE AIR here, because
    // somebody who saw nothing still knows what everyone around them knows.
    beliefsAbout(inherited(p.beliefs, state.world.ambient, place?.id ?? ''), PLAYER, named)
      .map((line) => `  - ${p.name} believes: ${line}`));

  /*
   * WHO THESE PEOPLE ARE TO EACH OTHER, AND TO YOU.
   *
   * The reader that makes a role more than a label. A relationship changes what
   * is POSSIBLE — being somebody's captain is being able to give them an order
   * at all — so the Director is told what each bond allows and obliges, in this
   * world's own words, and can offer or refuse accordingly.
   */
  const bonds = relationships(state, present.map((p) => p.id));

  /*
   * WHAT THE LAW FORBIDS THEM.
   *
   * A law the Director cannot see is a law it will cheerfully narrate somebody
   * breaking. The people in the room are residents; whether the PLAYER is bound
   * by the same law is a separate question, which the law answers separately.
   */
  /*
   * THE LAW, AND WHAT IS KNOWN OF IT — two lines, never one.
   *
   * The Director ENFORCES the law, so it has to see the true one. But a
   * character may only act on what they have found out, and collapsing the two
   * is how somebody ends up knowing a rule nobody ever told them.
   */
  const lawsOnThem = present.length && forbids(state.world, 'resident', 'crossFloors')
    ? 'The law (you enforce this): they cannot leave this floor'
    : '';

  const here = region ? stratumAt(state.world, region.floor) : null;
  const echoes = region ? echoesTold(state.world, region.floor) : [];

  const workedOut = CONSTRAINTS
    .filter((c) => believes(state.sheet.beliefs ?? [], ruleClaim(c)))
    .map((c) => LAW_IN_WORDS[c]);
  const playerKnows = workedOut.length
    ? `What the player has worked out about the law: ${workedOut.join('; ')}`
    : '';

  /*
   * The KINDS a law may be written about, by id.
   *
   * `amendGroup` is the one field whose vocabulary is this world's rather than
   * the engine's, so the model has to be shown the ids or it can only guess —
   * and a guess is refused by `validateDelta`, which reads as the Director being
   * ignored. Groups only: a law binds a group, like body, habitat and kinship.
   */
  const groups = (state.world.species ?? [])
    .filter((k) => k.level === 'group')
    .map((k) => `${k.id} (${k.name})`);

  return [
    // The STRUCTURE this floor belongs to, when the world names one: a dungeon
    // inside a tower should read as the dungeon, not as "floor 9".
    `Region: ${region?.name ?? '?'} (floor ${region?.floor ?? 0}, danger ${region?.danger ?? 0}`
      + `${here ? `, in ${here.name}` : ''})`,
    `You are at: ${place?.id ?? '?'} "${place?.name ?? '?'}" — ${place?.description ?? ''}`,
    `Time: ${timeLine(state.world, region?.floor)}`,
    echoes.length ? `What this land remembers from its past (old stories, not news):\n${echoes.join('\n')}` : '',
    `Things possible here: ${(place?.affordances ?? []).join('; ') || '(none listed)'}`,
    `Connected places (the ONLY legal moveTo values): ${exits.join(', ') || '(none)'}`,
    people.length ? `People here:\n${people.join('\n')}` : 'People here: nobody',
    bonds.length ? `What they are to each other:\n${bonds.join('\n')}` : '',
    lawsOnThem,
    playerKnows,
    groups.length ? `Kinds a law can name (amendGroup, ids exactly as written): ${groups.join(', ')}` : '',
    heard.length ? `What they think you have done (belief, not fact):\n${heard.join('\n')}` : '',
    canonFacts.length ? `Already true (do not contradict):\n${canonFacts.map((f) => `  - ${f}`).join('\n')}` : '',
    /*
     * WHO THE PLAYER IS.
     *
     * The Director knew the name, the background, some trait strings and a hit
     * point total — strictly LESS than it knew about any villager standing in
     * the room, who came with a disposition and a condition. It was adjudicating
     * for somebody it had never been introduced to.
     */
    `Character: ${state.sheet.name}, ${state.sheet.background.name}. Traits: ${state.sheet.traits.join(', ') || '—'}`,
    `They come across as: ${describePersonality(dispositionOf(state.sheet)).join(', ') || 'unremarkable'}`,
    `Right now they are: ${describeMental(state.sheet.needs).join(', ') || 'steady enough'}`,
    driveLine(state),
    `Skills: ${state.sheet.background.grantsSkills.map((s) => s.name).join(', ') || '—'}`,
    `Health: ${state.pc.hp}/${state.pc.maxHp}`,
    // The Director has to see the pack to name an item id at all. The WRITER
    // still must not — that boundary is unchanged. This is the side of the wall
    // that is allowed to know what the player is carrying.
    pack.length ? `Carrying (the ONLY legal useItem/equipItem ids):\n${pack.join('\n')}` : 'Carrying: nothing',
  ].filter(Boolean).join('\n');
}

const SYSTEM = [
  'You are the Director of a tower-climbing RPG. You decide what HAPPENS.',
  'You never decide whether the player succeeds — dice do that, outside you.',
  '',
  'When the action is uncertain, set check.required to true and write the',
  'consequences of ALL THREE outcomes: onHit, onPartial and onMiss. You are',
  'committing to every branch before the dice are rolled, so write a real',
  'failure, not a softer version of success. A miss must still move the scene.',
  '',
  'When nothing is at stake, set check.required to false and leave the three',
  'outcomes empty.',
  '',
  'Set startCombat only when something actually attacks: a fight is a real risk',
  'of death, not a way to add tension. What shows up is decided by the floor.',
  'Set startedBy to "them" when the player is attacked, "player" when they strike',
  'first — only striking first counts against them.',
  '',
  'useItem and equipItem take an item id from the pack listed below, and nothing',
  'else. Say only WHICH item is used — never how much it heals or what it does;',
  'the item decides that. Set rest to "short" when the player makes camp or',
  'catches their breath, and "long" only when they sleep the night through.',
  '',
  'amendLaw is "none" on almost every turn. Use it only when the fiction itself',
  'CHANGES the law of this world: a gate sealed for good, a decree read out,',
  'the tower shifting — never to describe a rule that already holds.',
  'Name a law from the list and say whom it now binds; "none" lifts it.',
  '',
  'revealWay is for a way OUT of this region that is not the stair — a road, a',
  'breach, a gate somebody opens. Name the place it leaves FROM and nothing else;',
  'where it goes is decided outside you.',
  '',
  'moveTo must be one of the connected places, or empty. Never invent a place,',
  'a person, or an exit that is not listed. trustPerson must be an id from the',
  'people list. learnFacts are new truths the player just established.',
  '',
  'Classification: ADVANCES if this pushes toward what the player wants,',
  'NEUTRAL if it is colour, DIVERGES if it wanders (allow it — it just costs',
  'time), IMPOSSIBLE if the character could not do it (reframe it in-fiction,',
  'never refuse out-of-fiction).',
].join('\n');

/**
 * Every bond among the people present, and between them and the player.
 *
 * One line per direction, because the directions differ: a master may command
 * a servant and the servant may not command back, and a Director told only
 * "they are master and servant" would have to guess which way that runs.
 */
function relationships(state: PlayState, present: readonly string[]): string[] {
  const roles = rolesOf(state.world);
  const edges = state.world.edges;
  const named = (id: string) => (id === PLAYER ? 'you' : state.world.people[id]?.name ?? id);

  const out: string[] = [];
  for (const from of [...present, PLAYER]) {
    for (const to of [...present, PLAYER]) {
      if (from === to) continue;
      const held = rolesHeld(edges, roles, from, to);
      if (held.length === 0) continue;

      const owes = owedBy(edges, roles, from, to);
      const may = permittedBy(edges, roles, from, to);
      const notes = [
        owes.length ? `owes ${owes.join(', ')}` : '',
        may.length ? `may ${may.join(', ')}` : '',
      ].filter(Boolean);

      out.push(`  - ${named(from)} is ${held.join(' and ')} to ${named(to)}${notes.length ? ` (${notes.join('; ')})` : ''}`);
    }
  }
  return out;
}

export async function runDirector(
  provider: Provider,
  state: PlayState,
  input: string,
  mode: Mode,
  canonFacts: string[],
): Promise<DirectorOutput> {
  return provider.structured<DirectorOutput>({
    schemaName: 'director_turn',
    schema: DIRECTOR_SCHEMA,
    temperature: 0.7,
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: [
          directorContext(state, canonFacts),
          '',
          `Mode: ${mode}`,
          `Player: ${input}`,
        ].join('\n'),
      },
    ],
  });
}

/* -------------------------------------------------------------------------- */
/* Parley — a Director turn inside a fight (6b stage 8)                         */
/* -------------------------------------------------------------------------- */

/**
 * The Director's tier commitment, shrunk to the one thing a word in a fight can
 * do. Deliberately NOT the full turn schema: mid-fight, a `moveTo` would pass
 * `validateDelta` and walk the player out of an encounter the server still holds
 * open. Three answers, all committed before the engine rolls.
 */
const parleyBranch = obj({ effect: { type: 'string', enum: [...PARLEY_EFFECTS] } }, ['effect']);

export const PARLEY_SCHEMA = obj(
  {
    ability: { type: 'string', enum: [...ABILITIES] },
    onHit: parleyBranch,
    onPartial: parleyBranch,
    onMiss: parleyBranch,
  },
  ['ability', 'onHit', 'onPartial', 'onMiss'],
);

const PARLEY_SYSTEM = [
  'You are the Director. Mid-fight, the player speaks to one foe.',
  'Choose the ability their words lean on, then commit to what the foe does on each tier of the roll:',
  '"yields" (gives up, at the mercy of the player), "withdraws" (leaves the fight), or "refuses" (fights on).',
  'You do not know which tier will fire. Weigh who the foe is, how the fight is going, and what was said.',
].join('\n');

export type ParleyOutput = { ability: Ability; onHit: ParleyEffect; onPartial: ParleyEffect; onMiss: ParleyEffect };

/**
 * An answer outside the vocabulary is a refusal: the fight goes on. Degraded
 * rather than thrown, like an unknown deed is dropped — a throw here would strand
 * an encounter the server is holding open.
 */
const effectOf = (raw: unknown): ParleyEffect =>
  (PARLEY_EFFECTS as readonly unknown[]).includes(raw) ? (raw as ParleyEffect) : 'refuses';

export async function runParley(provider: Provider, state: PlayState, foe: Combatant, say: string): Promise<ParleyOutput> {
  type Branch = { effect?: unknown } | undefined;
  const raw = await provider.structured<{ ability?: unknown; onHit?: Branch; onPartial?: Branch; onMiss?: Branch }>({
    schemaName: 'parley',
    schema: PARLEY_SCHEMA,
    temperature: 0.7,
    messages: [
      { role: 'system', content: PARLEY_SYSTEM },
      {
        role: 'user',
        content: [
          directorContext(state, []),
          '',
          `In the fight: ${foe.name}, ${foe.hp} of ${foe.maxHp} hit points left.`,
          `Player: ${say.trim() || '(says nothing in words — the gesture has to carry it)'}`,
        ].join('\n'),
      },
    ],
  });
  return {
    // An unknown ability leans on charisma, the ability words ordinarily lean on.
    ability: (ABILITIES as readonly unknown[]).includes(raw.ability) ? (raw.ability as Ability) : 'cha',
    onHit: effectOf(raw.onHit?.effect),
    onPartial: effectOf(raw.onPartial?.effect),
    onMiss: effectOf(raw.onMiss?.effect),
  };
}
