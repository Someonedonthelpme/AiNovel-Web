import { subclassById } from '../character/classes.ts';
import { emergentTraitsFor } from './emergent.ts';
import { generateTraits } from './traitgen.ts';
import type { TraitOrigin } from './traitgen.ts';
import type { Trait } from './traits.ts';
import { COUNTERS } from './traits.ts';
import type { PlayState } from './state.ts';

/**
 * The twelve authored traits.
 *
 * No longer what a world offers — `traitsFor` generates that now. These are
 * kept as the REFERENCE SET: the hand-written statements the generated ones
 * are measured against, and what the tests compare a generated trait's shape
 * to. Deleting them would leave nothing saying what a good one looks like.
 *
 * Every condition here references a counter something actually increments. A
 * trait gating on a tally nobody keeps can never be earned, and nothing in the
 * game would ever say so — which is why the counter names live in one registry
 * rather than as loose strings.
 */
export const TRAITS: readonly Trait[] = [
  {
    id: 'blooded',
    name: 'Blooded',
    description: 'The first ten were the hard ones.',
    requires: [{ kind: 'counter', counter: COUNTERS.kills, atLeast: 10 }],
    grants: { note: 'You have stopped flinching first.' },
  },
  {
    id: 'butcher',
    name: 'Butcher',
    description: 'Thirty dead, and a strength that shows it.',
    requires: [
      { kind: 'counter', counter: COUNTERS.kills, atLeast: 30 },
      { kind: 'ability', ability: 'str', atLeast: 16 },
    ],
    grants: { ability: { str: 1 } },
    // Thirty dead and the strength to show it opens a road, not a door.
    opens: { archetype: 'sword', entry: 'sequence', size: 4 },
  },
  {
    id: 'unbroken',
    name: 'Unbroken',
    description: 'Beaten more than once, and back up every time.',
    requires: [
      { kind: 'counter', counter: COUNTERS.fightsWon, atLeast: 12 },
      { kind: 'ability', ability: 'con', atLeast: 15 },
    ],
    grants: { ability: { con: 1 } },
    opens: { archetype: 'survival', entry: 'sequence', size: 3 },
  },
  {
    id: 'climber',
    name: 'Climber',
    description: 'The tower has stopped being strange.',
    requires: [{ kind: 'counter', counter: COUNTERS.floorsClimbed, atLeast: 5 }],
    grants: { note: 'You read a new floor faster than you used to.' },
  },
  {
    id: 'deep_walker',
    name: 'Deep Walker',
    description: 'You have been further up than most people believe there is.',
    requires: [
      { kind: 'counter', counter: COUNTERS.deepestFloor, atLeast: 10 },
      { kind: 'ability', ability: 'wis', atLeast: 14 },
    ],
    grants: { ability: { wis: 1 } },
    // Depth is its own teacher, and it does not need permission.
    opens: { archetype: 'wisdom', entry: 'parallel', size: 3 },
  },
  {
    id: 'hard_camp',
    name: 'Hard Camp',
    description: 'You can sleep on stone and wake up useful.',
    requires: [
      { kind: 'counter', counter: COUNTERS.shortRests, atLeast: 15 },
      { kind: 'personality', axis: 'discipline', atLeast: 1 },
    ],
    grants: { note: 'A short rest costs you less than it costs other people.' },
  },
  {
    id: 'apothecary',
    name: 'Apothecary',
    description: 'You know what is in the phial before you drink it.',
    requires: [
      { kind: 'counter', counter: COUNTERS.itemsUsed, atLeast: 20 },
      { kind: 'ability', ability: 'int', atLeast: 14 },
    ],
    grants: { ability: { int: 1 } },
    opens: { archetype: 'venom', entry: 'sequence', size: 3 },
  },
  {
    id: 'cartographer',
    name: 'Cartographer',
    description: 'You have walked into more rooms than you can name.',
    requires: [{ kind: 'counter', counter: COUNTERS.placesFound, atLeast: 20 }],
    grants: { note: 'You notice the way out before you need it.' },
  },
  {
    id: 'known_face',
    name: 'A Known Face',
    description: 'People have started recognising you.',
    requires: [
      { kind: 'counter', counter: COUNTERS.peopleMet, atLeast: 12 },
      { kind: 'personality', axis: 'warmth', atLeast: 1 },
    ],
    grants: { ability: { cha: 1 } },
    opens: { archetype: 'song', entry: 'parallel', size: 3 },
  },
  {
    id: 'cold_hand',
    name: 'Cold Hand',
    description: 'You stopped explaining yourself somewhere around the fifth floor.',
    requires: [
      { kind: 'counter', counter: COUNTERS.kills, atLeast: 25 },
      { kind: 'personality', axis: 'warmth', atMost: -1 },
    ],
    grants: { note: 'Frightened people tell you things.' },
    // What you became needs two parts of you to have agreed on it.
    opens: { archetype: 'shadow', entry: 'combination', size: 4, needs: 2 },
  },
  {
    id: 'survivor',
    name: 'Survivor',
    description: 'You have gone down and got back up.',
    requires: [
      { kind: 'counter', counter: COUNTERS.fightsLost, atLeast: 1 },
      { kind: 'counter', counter: COUNTERS.fightsWon, atLeast: 8 },
    ],
    grants: { ability: { con: 1 } },
  },
  {
    id: 'veteran',
    name: 'Veteran',
    description: 'Long enough in this that the tower is a job.',
    requires: [
      { kind: 'level', atLeast: 8 },
      { kind: 'counter', counter: COUNTERS.fightsWon, atLeast: 20 },
    ],
    grants: { ability: { str: 1, dex: 1 } },
    opens: { archetype: 'guard', entry: 'combination', size: 5, needs: 3 },
  },
];

/* -------------------------------------------------------------------------- */
/* What THIS world asks of you                                                 */
/* -------------------------------------------------------------------------- */

/** How many of them a single world offers, before anything tops it up. */
export const MIN_TRAITS = 8;
export const MAX_TRAITS = 10;

/**
 * Everything about a character that leans the trait list one way.
 *
 * Read off the sheet rather than passed around loose, because EVERY CALLER MUST
 * AGREE. The fold awards traits, the tree grows their branches and the panel
 * lists their progress; if those three built different catalogues, a trait
 * earned in the fold would have no branch on the tree and no line in the panel,
 * and nothing would report the disagreement.
 */
export function traitOriginOf(state: PlayState): TraitOrigin {
  return {
    classId: state.sheet.classId,
    subclassId: state.sheet.subclassId,
    background: state.sheet.background?.name,
    language: state.world.language,
  };
}

/**
 * The traits a particular world offers this particular character.
 *
 * Everything else about a character is theirs — the tree, the disciplines the
 * class allows, the branches their choices grew. Traits were the last thing
 * identical in every run: the same twelve achievements, the same thresholds,
 * forever. Scaling those thresholds by seed made it a template in a disguise.
 *
 * They are built now, inside themes, by `traitgen`. A world draws widely and
 * then the character TOPS IT UP — the class, the subclass, the world and the
 * background each favour a theme and add traits exclusive to that run.
 *
 * Topping up rather than filtering is the safety property. `sheet.traits`
 * stores ids, so a catalogue that could REMOVE an entry would orphan a trait
 * already earned: its bonus would vanish and the branch it grew would fall off
 * the tree mid-run. A list that only ever grows cannot.
 *
 * Deterministic in the seed and the origin, because traits are evaluated inside
 * the fold: a replayed log has to earn the same traits at the same moments, and
 * a catalogue that shifted between loads would rewrite a character's history.
 */
export function traitsFor(seed: number, origin?: TraitOrigin): Trait[] {
  // Drawn before the count, so the size of a world's list is its own business
  // and not a side effect of which character walked in.
  const count = MIN_TRAITS + (((seed ^ 0x7a17) >>> 3) % (MAX_TRAITS - MIN_TRAITS + 1));

  const declared = generateTraits({
    seed,
    count,
    origin,
    // A subclass leans wherever its island points, so the discipline it opens
    // comes along rather than being looked up a second time in traitgen.
    subclassOpens: subclassById(origin?.classId, origin?.subclassId)?.opens,
  });

  /*
   * And the recognitions, appended.
   *
   * In the same list because they travel the same road — `awardTraits` mints
   * them, `traitBonusesOf` totals them, the tree grows their branches. They
   * differ only in what they are made of: a declared trait gates on a
   * threshold you can be shown, an emergent one on a SHAPE that can only be
   * noticed after the fact.
   *
   * Every world can mint every shape. A world offers a subset of the declared
   * ones because a tower may ask different things of you; it cannot decline to
   * notice what you actually did.
   */
  return [...declared, ...emergentTraitsFor(seed, origin?.language ?? 'en')];
}
