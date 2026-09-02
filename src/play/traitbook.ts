import type { Trait } from './traits.ts';
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
