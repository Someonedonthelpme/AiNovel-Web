import type { Ability } from '../combat/types.ts';
import type { NodeGrant } from './skilltree.ts';

/**
 * What a path is made of, once disciplines are gone.
 *
 * `archetypes.ts` supplied seven things to the tree: an ability, a secondary,
 * an id, node-name banks for minors and notables, a keystone name, and the
 * trade that keystone makes. A `PathShape` covers the first three. This file
 * covers the rest.
 *
 * THE WORDS ARE KEYED ON THE STAT, NOT THE WORLD, and that is deliberate. The
 * model names the PATH — that is where a setting shows through, and "Swordwork"
 * against "Breaching" is the whole point of generating them. Node names are a
 * different problem: there are six or seven per branch, they are read at a
 * glance, and asking a model for sixty-odd of them per world is both slow and
 * the most likely thing to come back wrong. Stat-keyed words are setting-
 * agnostic enough to carry it — "The Sure Hand" and "The Long Look" belong in a
 * kingdom and a wreck alike — and they cannot fail.
 *
 * The keystone trades are authored per stat for the same reason they were
 * authored per discipline: a keystone must COST something, and what it is fair
 * to take is a judgement, not an arithmetic.
 */

type Words = { minors: string[]; notables: string[]; keystone: string };

export const PATH_WORDS: Record<Ability, Words> = {
  str: {
    minors: ['Set Feet', 'Short Grip', 'Shoulder', 'Follow Through', 'Bad Ground'],
    notables: ['The Heavy Hand', 'Nothing Held Back'],
    keystone: 'Everything At Once',
  },
  dex: {
    minors: ['Steady Hand', 'Line of Sight', 'Held Breath', 'The Long Count', 'Fine Work'],
    notables: ['The Sure Shot', 'Where It Was Aimed'],
    keystone: 'One Thing, Perfectly',
  },
  con: {
    minors: ['Second Wind', 'Bitten Down', 'Hard Nights', 'Still Standing', 'The Long Hold'],
    notables: ['Nothing Shakes It', 'Through The Worst'],
    keystone: 'Whatever It Takes',
  },
  agi: {
    minors: ['Light Feet', 'Off The Mark', 'Sidestep', 'Quick Hands', 'Not There'],
    notables: ['Faster Than It', 'Gone Before It Lands'],
    keystone: 'Never Where They Swing',
  },
  vit: {
    minors: ['Broad Back', 'Deep Lungs', 'Carried Weight', 'Slow To Fall', 'Old Scars'],
    notables: ['The Wall', 'What You Can Take'],
    keystone: 'Refuse To Drop',
  },
  int: {
    minors: ['Read It Twice', 'Working Notes', 'The Cold Method', 'Marginalia', 'First Principles'],
    notables: ['The Worked Answer', 'What The Page Said'],
    keystone: 'Solved, And It Cost You',
  },
  wis: {
    minors: ['The Long Look', 'Half A Step Early', 'What Was Not Said', 'Quiet Attention', 'The Turned Stone'],
    notables: ['Seen It Coming', 'The Room Reads Itself'],
    keystone: 'Know Before It Happens',
  },
  cha: {
    minors: ['The Right Name', 'Warm Opening', 'Held Eye', 'A Better Story', 'The Owed Favour'],
    notables: ['The Carrying Voice', 'They Do It Anyway'],
    keystone: 'Nobody Refuses You',
  },
  luk: {
    minors: ['The Odd Break', 'Found Coin', 'The Loose Board', 'Rain Stops', 'Somebody Blinked'],
    notables: ['It Falls Your Way', 'The Fortunate Turn'],
    keystone: 'Impossible, And It Worked',
  },
};

/**
 * The trade a keystone makes.
 *
 * Each gives with one hand and takes with the other, themed to what the stat
 * IS — force costs you your guard, speed costs you your bulk, worked power
 * costs you the body you neglected while working it out. A keystone that only
 * gave would be a notable with a longer walk.
 */
export function keystoneTradeFor(stat: Ability): { grant: NodeGrant; cost: NodeGrant } {
  switch (stat) {
    case 'str':
      return { grant: { damage: 3, attack: 1 }, cost: { ac: 2 } };
    case 'dex':
      return { grant: { attack: 2, damage: 1 }, cost: { maxHp: 6 } };
    case 'con':
      return { grant: { ability: { con: 2 }, maxMana: 6 }, cost: { damage: 1 } };
    case 'agi':
      return { grant: { ability: { agi: 2 }, ac: 1 }, cost: { maxHp: 8 } };
    case 'vit':
      return { grant: { maxHp: 12, maxStamina: 6 }, cost: { attack: 1 } };
    case 'int':
      return { grant: { ability: { int: 2 }, maxMana: 4 }, cost: { maxHp: 8 } };
    case 'wis':
      return { grant: { ability: { wis: 2 }, ac: 1 }, cost: { damage: 1 } };
    case 'cha':
      return { grant: { ability: { cha: 2 }, maxMana: 4 }, cost: { maxHp: 4 } };
    case 'luk':
      return { grant: { ability: { luk: 2 }, damage: 2 }, cost: { ac: 1, maxHp: 4 } };
  }
}

/**
 * What a node at this depth is worth.
 *
 * Power rises with distance from the centre, which is what makes a long route
 * a real investment rather than a longer way to the same place. Carried over
 * from the discipline version unchanged in shape — only the source of the two
 * abilities moved from an archetype to a path.
 */
export function grantForRing(
  primary: Ability,
  secondary: Ability,
  kind: 'minor' | 'notable' | 'keystone',
  ring: number,
  roll: number,
): NodeGrant {
  if (kind === 'keystone') return {};

  if (kind === 'notable') {
    return ring >= 5
      ? { ability: { [primary]: 1, [secondary]: 1 }, maxHp: 4 }
      : { ability: { [primary]: 1 }, ...(roll < 0.5 ? { attack: 1 } : { ac: 1 }) };
  }

  // Minors alternate between the path's own stat and raw staying power, so a
  // branch is not purely one number going up.
  if (roll < 0.55) return { ability: { [primary]: 1 } };
  if (roll < 0.8) return { maxHp: 3 };
  return { ability: { [secondary]: 1 } };
}
