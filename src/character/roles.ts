import type { ArchetypeId } from '../play/archetypes.ts';
import type { Ability } from '../combat/types.ts';

/**
 * Roles: the mechanical shapes a class can have.
 *
 * The structure half of "the model supplies flavour, the code supplies
 * structure", and the reason generated classes are not nonsense.
 *
 * A CLASS IS THE MOST CHARACTERISATION-HEAVY THING IN THE GAME — more than a
 * trait, which was already the hard case. Free-drawing `core`, `affinity`,
 * `forbidden`, two abilities and a hit die gives you a d12 charisma-primary
 * shadow-and-song class: legal, correctly balanced, and nobody. Worse, it is
 * the one thing the player CHOOSES cold at creation, so an incoherent one is
 * not a curiosity found in play but a card they have to bet a run on.
 *
 * So a role fixes the SHAPE and generation varies everything inside it. A
 * front-liner is str or con, d10 or d12, core drawn from the disciplines that
 * stand and take it, shut out of the figure-arts. Which disciplines exactly,
 * which abilities, what it is called and what it sets out holding are all this
 * world's business.
 *
 * The `brief` is what the model is told this kind of person IS. It never names
 * a class — that is the point. Given a fantasy premise a front-liner comes back
 * a knight; given a drowned coast, a harbour guard; given a dead world, whoever
 * that world's version of "stands in front and takes it" happens to be.
 */

export type Role = {
  id: string;
  /** What this kind of person is, in mechanical terms, for the model to name. */
  brief: string;
  /** Hit dice this shape may take. */
  dice: (6 | 8 | 10 | 12)[];
  /** Ability pairs it may run on, primary first. */
  abilities: [Ability, Ability][];
  /** Two are drawn from here. The first is home. */
  coreFrom: ArchetypeId[];
  /** Two more, drawn from here, that the tree leans toward. */
  affinityFrom: ArchetypeId[];
  /** What this shape has no business with. Two to four are drawn. */
  forbiddenFrom: ArchetypeId[];
  /** Rough armour it sets out in, or null for whatever it scrounges. */
  armour: (number | null)[];
};

/**
 * Seven shapes.
 *
 * Fewer than the classes a world offers, deliberately — two front-liners in one
 * world drawing different disciplines and different abilities are genuinely two
 * different classes, the same way two violence-themed traits are two traits.
 */
export const ROLES: readonly Role[] = [
  {
    id: 'frontline',
    brief: 'stands in front, holds ground, and is used to being hit',
    dice: [10, 12],
    abilities: [['str', 'con'], ['con', 'str'], ['str', 'dex']],
    coreFrom: ['sword', 'guard'],
    affinityFrom: ['survival', 'bow', 'shadow', 'guile'],
    forbiddenFrom: ['magic', 'blackMagic', 'flame', 'song', 'venom'],
    armour: [13, 14, 12],
  },
  {
    id: 'skirmisher',
    brief: 'fast and quiet, gets behind things, does not stay to be hit',
    dice: [8, 10],
    abilities: [['dex', 'con'], ['dex', 'int'], ['dex', 'cha']],
    coreFrom: ['shadow', 'guile', 'bow'],
    affinityFrom: ['venom', 'sword', 'survival', 'song'],
    forbiddenFrom: ['guard', 'flame', 'magic', 'blackMagic'],
    armour: [12, 13, null],
  },
  {
    id: 'scholar',
    brief: 'reads, works things out, and would rather solve it than fight it',
    dice: [6, 8],
    abilities: [['int', 'wis'], ['int', 'con'], ['wis', 'int']],
    coreFrom: ['magic', 'wisdom', 'venom'],
    affinityFrom: ['flame', 'guile', 'song', 'shadow'],
    forbiddenFrom: ['sword', 'guard', 'blackMagic', 'survival'],
    armour: [null, 11],
  },
  {
    id: 'talker',
    brief: 'gets what they want out of people, and rarely has to draw anything',
    dice: [8],
    abilities: [['cha', 'dex'], ['cha', 'wis'], ['cha', 'int']],
    coreFrom: ['song', 'guile'],
    affinityFrom: ['wisdom', 'shadow', 'bow', 'venom'],
    forbiddenFrom: ['guard', 'flame', 'blackMagic', 'sword'],
    armour: [12, null],
  },
  {
    id: 'survivor',
    brief: 'lasts. knows the ground, carries what is needed, and comes back',
    dice: [10, 12],
    abilities: [['con', 'wis'], ['wis', 'con'], ['dex', 'wis']],
    coreFrom: ['survival', 'bow', 'guard'],
    affinityFrom: ['wisdom', 'shadow', 'sword', 'venom'],
    forbiddenFrom: ['blackMagic', 'flame', 'magic', 'song'],
    armour: [12, 13, null],
  },
  {
    id: 'channeler',
    brief: 'draws on something that is not theirs, and pays for it',
    dice: [6, 8],
    abilities: [['cha', 'con'], ['int', 'cha'], ['cha', 'int']],
    coreFrom: ['blackMagic', 'flame', 'magic'],
    affinityFrom: ['venom', 'shadow', 'wisdom', 'song'],
    forbiddenFrom: ['guard', 'sword', 'bow', 'survival'],
    armour: [null, 11],
  },
  {
    id: 'mender',
    brief: 'keeps other people standing, and is listened to because of it',
    dice: [8, 10],
    abilities: [['wis', 'cha'], ['cha', 'wis'], ['wis', 'con']],
    coreFrom: ['wisdom', 'song', 'guard'],
    affinityFrom: ['magic', 'survival', 'venom', 'guile'],
    forbiddenFrom: ['blackMagic', 'shadow', 'flame', 'sword'],
    armour: [12, 13],
  },
];

export const roleById = (id: string): Role | null => ROLES.find((r) => r.id === id) ?? null;
