import { RATION_ID } from '../items/catalogue.ts';
import type { PlayState } from './state.ts';
import type { Reachable, Signet } from './signet.ts';
import { admissible } from './signet.ts';
import { COUNTERS, WRITTEN_COUNTERS } from './traits.ts';
import { mulberry32 } from '../engine/roll.ts';
import { ARCHETYPES } from './archetypes.ts';
import type { EntryRule } from './graft.ts';
import type { Gate } from './signet.ts';
import { GATEABLE_FLAGS, generateSignets } from './signetgen.ts';
import { TRAITS, traitOriginOf, traitsFor } from './traitbook.ts';
import type { Trait } from './traits.ts';

/**
 * The Signets a world may contain, and the proof that it can contain them.
 *
 * Nothing here reaches the player directly. `signetsFor` runs every candidate
 * past the reachability walk first, so a gate that this particular tower could
 * never satisfy is dropped before it can become a mystery nobody can solve.
 */

/**
 * Families the tower actually drops.
 *
 * Derived from `items/catalogue.ts` by hand, and that is the fragile part: add a
 * drop there without adding it here and a Signet gating on it is wrongly
 * discarded; remove one and a Signet is wrongly kept. The test pins the two
 * together.
 */
export const DROPPABLE_FAMILIES = new Set(['mat_', 'draught_', 'weapon_', 'armour_', RATION_ID]);

/**
 * Flags the world is capable of setting.
 *
 * The Director may set arbitrary flags, but a Signet may only gate on one that
 * something is actually known to produce — otherwise the gate is a wish.
 */
export const SETTABLE_FLAGS = new Set<string>([
  ...GATEABLE_FLAGS,
  // Hint flags are raised by the world when it drops a rumour. They are not
  // gate terms, but a generated Signet's hint uses its own id.
  'hint_signet_deep_current',
  'hint_signet_ledger_hand',
]);

/**
 * How high this run can go.
 *
 * The tower is endless in principle, but a proof needs a horizon: without one,
 * "an item from floor 900" validates and the player searches forever. This is
 * the depth the design is willing to promise.
 */
export const TOWER_HORIZON = 30;
export const MAX_ABILITY = 20;
export const MAX_LEVEL = 20;

export function reachableIn(_state: PlayState): Reachable {
  return {
    maxFloor: TOWER_HORIZON,
    droppableFamilies: DROPPABLE_FAMILIES,
    settableFlags: SETTABLE_FLAGS,
    maxAbility: MAX_ABILITY,
    maxLevel: MAX_LEVEL,
    // Counters with a WRITER, not merely a name. A gate on a counter nothing
    // increments is unsatisfiable, and the registry cannot tell the difference.
    liveCounters: new Set(WRITTEN_COUNTERS),
  };
}

/* -------------------------------------------------------------------------- */
/* Candidates                                                                  */
/* -------------------------------------------------------------------------- */

export const CANDIDATE_SIGNETS: readonly Signet[] = [
  {
    id: 'signet_deep_current',
    name: 'Signet of the Deep Current',
    description: 'Something taken from far enough up that the air was wrong.',
    augments: { kind: 'trait', id: 'deep_walker' },
    gate: {
      kind: 'all',
      of: [
        { kind: 'itemFromDepth', family: 'mat_', minFloor: 8 },
        { kind: 'condition', condition: { kind: 'counter', counter: COUNTERS.deepestFloor, atLeast: 8 } },
      ],
    },
    grant: { ability: { wis: 1 }, maxHp: 4 },
    discovery: 'hinted',
    hint: 'A trader mentions that the shards from the upper floors hum differently.',
    opens: { archetype: 'magic', entry: 'combination', size: 5, needs: 2 },
  },
  {
    id: 'signet_ledger_hand',
    name: 'Signet of the Ledger Hand',
    description: 'Whatever was written in that book, you read it.',
    augments: { kind: 'trait', id: 'apothecary' },
    gate: {
      kind: 'all',
      of: [
        { kind: 'flag', flag: 'read_the_ledger' },
        { kind: 'condition', condition: { kind: 'ability', ability: 'int', atLeast: 14 } },
      ],
    },
    grant: { ability: { int: 1 } },
    discovery: 'hinted',
    hint: 'There is a ledger somewhere in town that nobody will talk about.',
    opens: { archetype: 'venom', entry: 'sequence', size: 4 },
  },
  {
    id: 'signet_long_patience',
    name: 'Signet of Long Patience',
    description: 'Earned by people who stopped rushing.',
    augments: { kind: 'trait', id: 'hard_camp' },
    // Two routes to the same power, which is what makes a Signet feel found
    // rather than assigned.
    gate: {
      kind: 'any',
      of: [
        { kind: 'condition', condition: { kind: 'counter', counter: COUNTERS.shortRests, atLeast: 25 } },
        {
          kind: 'all',
          of: [
            { kind: 'condition', condition: { kind: 'counter', counter: COUNTERS.longRests, atLeast: 8 } },
            { kind: 'condition', condition: { kind: 'personality', axis: 'discipline', atLeast: 2 } },
          ],
        },
      ],
    },
    grant: { ability: { con: 1 }, maxHp: 3 },
    discovery: 'hidden',
    opens: { archetype: 'survival', entry: 'parallel', size: 4 },
  },
  {
    id: 'signet_quiet_kill',
    name: 'Signet of the Quiet Kill',
    description: 'You have done this often enough that it has stopped being loud.',
    augments: { kind: 'trait', id: 'cold_hand' },
    gate: {
      kind: 'all',
      of: [
        { kind: 'condition', condition: { kind: 'counter', counter: COUNTERS.kills, atLeast: 40 } },
        { kind: 'condition', condition: { kind: 'personality', axis: 'warmth', atMost: -1 } },
        { kind: 'itemFromDepth', family: 'weapon_', minFloor: 5 },
      ],
    },
    grant: { attack: 1, damage: 1 },
    discovery: 'hidden',
    opens: { archetype: 'blackMagic', entry: 'combination', size: 5, needs: 3 },
  },
];

/**
 * The Signets this session may actually contain.
 *
 * Anything unprovable is discarded here, with its reasons, rather than shipped
 * and hoped for.
 */
export function signetsFor(state: PlayState): { kept: Signet[]; discarded: { signet: Signet; why: string[] }[] } {
  const world = reachableIn(state);
  // This world's own Signets, then the proof. Varying the numbers is exactly
  // the sort of change that could quietly make a gate unsatisfiable, so the
  // walk matters more here than it did when they were authored.
  const checked = admissible(candidateSignetsFor(state.world.seed, traitsFor(state.world.seed, traitOriginOf(state))), world);
  return {
    kept: checked.kept,
    discarded: checked.discarded.map((d) => ({ signet: d.signet, why: d.problems.map((p) => p.why) })),
  };
}

/* -------------------------------------------------------------------------- */
/* What THIS world hides                                                       */
/* -------------------------------------------------------------------------- */

const SIGNET_ENTRIES: EntryRule[] = ['sequence', 'parallel', 'combination'];

/**
 * The Signets a particular world may contain, varied by seed.
 *
 * The same reasoning as traits: four identical Signets in every run is the one
 * part of progression that never surprises anybody twice. Depths, tallies and
 * the branches they grow are all this world's own.
 *
 * The reachability proof still runs afterwards and still has the last word — a
 * varied gate is no more allowed to be impossible than an authored one, and
 * varying the numbers is exactly the sort of change that could quietly make one
 * unsatisfiable.
 */
/**
 * The Signets a particular world may contain.
 *
 * Generated from themes now rather than scaled from four authored gates — see
 * `signetgen.ts`. The authored four are kept below as the shapes the generator
 * was written against, and as something to compare a generated gate with.
 */
export function candidateSignetsFor(seed: number, traits: readonly Trait[] = []): Signet[] {
  return generateSignets({
    seed,
    horizon: TOWER_HORIZON,
    maxAbility: MAX_ABILITY,
    traits: traits.length > 0 ? traits : TRAITS,
    language: 'en',
  });
}

/** The earlier approach, kept for comparison and for the tests that pin it. */
export function variedAuthoredSignets(seed: number): Signet[] {
  const rng = mulberry32((seed ^ 0x5169) >>> 0);
  const demand = 0.8 + rng() * 0.6;
  const scale = (n: number) => Math.max(1, Math.round(n * demand));

  const varyGate = (gate: Gate): Gate => {
    switch (gate.kind) {
      case 'all':
      case 'any':
        return { ...gate, of: gate.of.map(varyGate) };
      case 'itemFromDepth':
        return { ...gate, minFloor: Math.min(TOWER_HORIZON, scale(gate.minFloor)) };
      case 'condition':
        return gate.condition.kind === 'counter'
          ? { ...gate, condition: { ...gate.condition, atLeast: scale(gate.condition.atLeast) } }
          : gate;
      default:
        return gate;
    }
  };

  return CANDIDATE_SIGNETS.map((signet) => ({
    ...signet,
    gate: varyGate(signet.gate),
    opens: signet.opens
      ? {
          archetype: ARCHETYPES[Math.floor(rng() * ARCHETYPES.length)].id,
          entry: SIGNET_ENTRIES[Math.floor(rng() * SIGNET_ENTRIES.length)],
          size: 3 + Math.floor(rng() * 3),
          needs: 2 + Math.floor(rng() * 2),
        }
      : undefined,
  }));
}
