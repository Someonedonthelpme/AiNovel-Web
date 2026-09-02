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
 * front-liner is str or con, d10 or d12, leaning on the body and away from the
 * figures. Which stats exactly, which abilities, what it is called and what it
 * sets out holding are all this world's business.
 *
 * The leans were mapped mechanically off the old discipline lists at first and
 * that produced a scholar who both favoured INT and leant away from it — the
 * kind of contradiction a generator resolves silently and wrongly. They are
 * authored, and `classgen.checkShape` proves no role ever does that again.
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
  /**
   * Stats this shape leans ON. Paths running on these open two points sooner,
   * and creation points are weighted here.
   */
  favoursFrom: Ability[];
  /**
   * Stats it leans AWAY from — paths on these need two points more.
   *
   * A price, not a lock. The old `forbidden` was a boolean and no score ever
   * got a Fighter into the figure-arts; a shifted gate means "raise it far
   * enough and you get there anyway", which is the whole promise of a stat
   * system and the reason a class can lean without closing a build off.
   */
  againstFrom: Ability[];
  /** Rough armour it sets out in, or null for whatever it scrounges. */
  armour: (number | null)[];
};

/**
 * Seven shapes.
 *
 * Fewer than the classes a world offers, deliberately — two front-liners in one
 * world drawing different stats and different abilities are genuinely two
 * different classes, the same way two violence-themed traits are two traits.
 */
export const ROLES: readonly Role[] = [
  {
    id: 'frontline',
    brief: 'stands in front, holds ground, and is used to being hit',
    dice: [10, 12],
    abilities: [['str', 'con'], ['con', 'str'], ['str', 'dex']],
    favoursFrom: ['str', 'vit'],
    againstFrom: ['int', 'cha'],
    armour: [13, 14, 12],
  },
  {
    id: 'skirmisher',
    brief: 'fast and quiet, gets behind things, does not stay to be hit',
    dice: [8, 10],
    abilities: [['dex', 'con'], ['dex', 'int'], ['dex', 'cha']],
    favoursFrom: ['agi', 'dex'],
    againstFrom: ['vit', 'cha'],
    armour: [12, 13, null],
  },
  {
    id: 'scholar',
    brief: 'reads, works things out, and would rather solve it than fight it',
    dice: [6, 8],
    abilities: [['int', 'wis'], ['int', 'con'], ['wis', 'int']],
    favoursFrom: ['int', 'wis'],
    againstFrom: ['str', 'vit'],
    armour: [null, 11],
  },
  {
    id: 'talker',
    brief: 'gets what they want out of people, and rarely has to draw anything',
    dice: [8],
    abilities: [['cha', 'dex'], ['cha', 'wis'], ['cha', 'int']],
    favoursFrom: ['cha', 'luk'],
    againstFrom: ['str', 'vit'],
    armour: [12, null],
  },
  {
    id: 'survivor',
    brief: 'lasts. knows the ground, carries what is needed, and comes back',
    dice: [10, 12],
    abilities: [['con', 'wis'], ['wis', 'con'], ['dex', 'wis']],
    favoursFrom: ['con', 'vit', 'wis'],
    againstFrom: ['int', 'cha'],
    armour: [12, 13, null],
  },
  {
    id: 'channeler',
    brief: 'draws on something that is not theirs, and pays for it',
    dice: [6, 8],
    abilities: [['cha', 'con'], ['int', 'cha'], ['cha', 'int']],
    favoursFrom: ['int', 'con'],
    againstFrom: ['str', 'vit'],
    armour: [null, 11],
  },
  {
    id: 'mender',
    brief: 'keeps other people standing, and is listened to because of it',
    dice: [8, 10],
    abilities: [['wis', 'cha'], ['cha', 'wis'], ['wis', 'con']],
    favoursFrom: ['wis', 'vit', 'cha'],
    againstFrom: ['agi', 'str'],
    armour: [12, 13],
  },
];

export const roleById = (id: string): Role | null => ROLES.find((r) => r.id === id) ?? null;
