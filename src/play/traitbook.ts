import { mulberry32 } from '../engine/roll.ts';
import { ARCHETYPES } from './archetypes.ts';
import type { ArchetypeId } from './archetypes.ts';
import type { EntryRule } from './graft.ts';
import type { Trait, TraitCondition } from './traits.ts';
import { COUNTERS } from './traits.ts';

/**
 * The traits a character can grow into.
 *
 * Authored rather than generated, unlike the passive tree. A trait is a
 * statement about who someone has become — "you have killed thirty things and
 * you are still steady" — and that reads as hollow when a generator assembles
 * it from parts. There are few enough of them to write by hand, and writing
 * them by hand is what lets each one mean something.
 *
 * Every condition here must reference a counter something actually increments.
 * A trait gating on a tally nobody keeps can never be earned, and nothing in
 * the game would ever say so — which is why the counter names live in one
 * registry rather than as loose strings.
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

/** How many of the catalogue a single world offers. */
export const MIN_TRAITS = 8;
export const MAX_TRAITS = 10;

const ENTRIES: EntryRule[] = ['sequence', 'parallel', 'combination'];

/**
 * The traits a particular world offers, and what they ask.
 *
 * Everything else about a character is theirs — the tree, the disciplines the
 * class allows, the branches their choices grew. Traits were the last thing
 * identical in every run: the same twelve achievements, the same thresholds,
 * forever.
 *
 * A world now offers a SUBSET, with its own thresholds and its own branches. A
 * tower that wants thirty kills of you is a different tower from one that wants
 * forty-five, and the branch either one grows is different again.
 *
 * Deterministic in the seed, because traits are evaluated inside the fold: a
 * replayed log has to earn the same traits at the same moments, and a catalogue
 * that shifted between loads would rewrite a character's history.
 */
export function traitsFor(seed: number): Trait[] {
  const rng = mulberry32((seed ^ 0x7a17) >>> 0);

  // Thresholds move together, so a world reads as demanding or forgiving rather
  // than as a scatter of unrelated numbers.
  const demand = 0.75 + rng() * 0.75;
  const scale = (n: number) => Math.max(1, Math.round(n * demand));

  const want = MIN_TRAITS + Math.floor(rng() * (MAX_TRAITS - MIN_TRAITS + 1));
  const pool = [...TRAITS];
  const chosen: Trait[] = [];

  while (chosen.length < want && pool.length > 0) {
    chosen.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }

  return chosen.map((trait) => {
    const requires: TraitCondition[] = trait.requires.map((c) =>
      c.kind === 'counter' ? { ...c, atLeast: scale(c.atLeast) } : c,
    );

    // A trait that grew a branch still does, but not always the same one — the
    // discipline, the way in and the size are all this world's business.
    const opens = trait.opens
      ? {
          archetype: ARCHETYPES[Math.floor(rng() * ARCHETYPES.length)].id as ArchetypeId,
          entry: ENTRIES[Math.floor(rng() * ENTRIES.length)],
          size: 2 + Math.floor(rng() * 4),
          needs: 2 + Math.floor(rng() * 2),
        }
      : undefined;

    return { ...trait, requires, opens };
  });
}
