import { RATION_ID } from '../items/catalogue.ts';
import type { PlayState } from './state.ts';
import type { Reachable, Signet } from './signet.ts';
import { admissible } from './signet.ts';
import { COUNTERS } from './traits.ts';

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
export const SETTABLE_FLAGS = new Set([
  'read_the_ledger',
  'heard_the_bell',
  'spared_someone',
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
    liveCounters: new Set(Object.values(COUNTERS)),
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
  const checked = admissible(CANDIDATE_SIGNETS, world);
  return {
    kept: checked.kept,
    discarded: checked.discarded.map((d) => ({ signet: d.signet, why: d.problems.map((p) => p.why) })),
  };
}
