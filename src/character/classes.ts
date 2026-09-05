import type { Ability, Attack } from '../combat/types.ts';
import type { Bilingual, SkillSpec } from '../skills/active.ts';
import type { SubclassRoute } from './classgen.ts';
import type { ActiveSkill } from '../skills/active.ts';
import type { EntryRule } from '../play/graft.ts';

/**
 * Classes.
 *
 * What a character IS, decided by the player rather than guessed from prose.
 *
 * Before this, the most consequential thing about a build — which disciplines
 * the skill tree would hold — was inferred by regex from a background name the
 * model had written. It was a guess, it had already been wrong once, and the
 * player never got to make it.
 *
 * A class carries the mechanics: hit die, the abilities it leans on, what it
 * starts holding, and above all WHICH DISCIPLINES ITS TREE CAN CONTAIN. The
 * model still writes the flavour — the name, the background prose, the voice,
 * the personality — which is the same division of labour as everywhere else in
 * this codebase.
 *
 * `forbidden` is the piece that makes the tree worth exploring. A class does not
 * merely favour some disciplines; it is LOCKED OUT of others, permanently, at
 * any price. A Fighter cannot buy black magic. The only way across that line is
 * an island — the detached clusters that open through play — which turns
 * finding one from "more nodes" into a door somewhere you could not otherwise
 * go. Subclasses are the deliberate version of the same thing: choosing one
 * opens an island into a discipline your class was shut out of.
 */

export type Subclass = {
  id: string;
  name: Bilingual;
  description: Bilingual;
  /**
   * Which kind of road this is.
   *
   * `cross` opens a discipline the class is shut out of — a door OUT. `deepen`
   * opens one it was built on — more of what it already is.
   *
   * The authored sixteen are all crossings, which is exactly the flaw: level
   * three was a choice of WHICH door rather than a choice at all. Generated
   * classes grow both, so the decision is specialise or broaden.
   */
  route: SubclassRoute;
  /**
   * The discipline its island belongs to.
   *
   * For a `cross`, ALWAYS one the class is shut out of.
   *
   * This was "usually" and it meant it: twelve of sixteen subclasses opened
   * somewhere the class could already reach, and one of them (the Rogue's)
   * opened a discipline already in its own affinity — a crossing into a room
   * it was standing in. The whole promise of a subclass is the crossing, so it
   * is now enforced rather than intended, and `classes.test.ts` proves it.
   *
   * For a `deepen`, always one already in `core` or `affinity`.
   */
  opens: Ability;
  /** The signature active it grants outright. */
  grants: SkillSpec;
};

/**
 * What a subclass grows, and when.
 *
 * Three stages rather than one parcel: a permanent choice at level three should
 * buy an arc, not a single payout that never speaks again.
 *
 * The first is a COMBINATION, which is the point of it. The crossing into a
 * discipline your class is shut out of only opens once several parts of your
 * own tree line up — so an Eldritch Knight has to have genuinely walked the
 * sword before the figures will take. It bridges the two halves of a build
 * instead of being bolted to the side of one.
 *
 * Later stages hang off the earlier ones, so the branch deepens where you have
 * already been rather than sprouting somewhere new each time.
 */
export const SUBCLASS_STAGES: readonly { level: number; entry: EntryRule; size: number; needs?: number }[] = [
  { level: 3, entry: 'combination', size: 3, needs: 2 },
  { level: 6, entry: 'sequence', size: 4 },
  { level: 10, entry: 'sequence', size: 5 },
];

/** The stages a character has actually reached. */
export const stagesReached = (level: number): number =>
  SUBCLASS_STAGES.filter((stage) => level >= stage.level).length;

export type CharacterClass = {
  id: string;
  name: Bilingual;
  description: Bilingual;
  hitDie: 6 | 8 | 10 | 12;
  primary: Ability;
  secondary: Ability;

  /**
   * Never GENERATED onto the tree. Two things can still bring one.
   *
   * A subclass island is the deliberate route: choosing one at level three is
   * a permanent decision to cross into somewhere your class refuses to go, and
   * every subclass now crosses — see `opens` below.
   *
   * A SKILL BOOK IS THE ACCIDENTAL ROUTE, and it is kept on purpose. A book is
   * a thing found in the tower, and a found thing teaching you what your
   * training would not is the better version of the same idea: a Warlock who
   * picks up `On Holding Ground` learns a little of the shield-work nobody
   * would have taught them. The class decides what you were TRAINED in, not
   * what the world is allowed to hand you.
   *
   * What stays true either way: the base tree never generates one of these on
   * its own, so crossing is always something that HAPPENED to a character
   * rather than something they rolled.
   */
  /**
   * Which STATS this class leans on, and which it leans away from.
   *
   * A lean is a PRICE, not a lock: a favoured path opens two points sooner and
   * one leant against needs two more. The old `forbidden` was a boolean and no
   * score ever got a Fighter into the figure-arts; shifting the gate instead
   * means "raise the stat far enough and you get there anyway", which is the
   * whole promise of a stat system.
   */
  favours?: Ability[];
  against?: Ability[];
  startingAttack: Attack;
  /** The armour base they set out in, or null for whatever they scrounge. */
  startingArmour: number | null;
  subclasses: Subclass[];
};

/* -------------------------------------------------------------------------- */
/* Shorthands                                                                  */
/* -------------------------------------------------------------------------- */

const weapon = (
  id: string,
  name: string,
  ability: Ability,
  sides: number,
  range: number,
  type: string,
): Attack => ({
  id,
  name,
  ability,
  proficient: true,
  range,
  damage: { count: 1, sides, bonusAbility: ability, type },
});

/* -------------------------------------------------------------------------- */
/* The classes                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * No authored classes remain.
 *
 * There were eight, with sixteen subclasses, and they were kept for a while as
 * the fallback an old save could still resolve against. Existing sessions are
 * being deleted with the disciplines, so the fallback has nothing left to
 * catch — and keeping a hand-written roster beside a generated one would mean
 * every rule had to hold for both.
 *
 * `classOf` still prefers the spec carried on the sheet, which is now the only
 * way a class is ever resolved. That is the orphan-proofing, and it matters
 * more than ever: a class exists only on the character who chose it.
 */
export const CLASSES: readonly CharacterClass[] = [];


/* -------------------------------------------------------------------------- */
/* Looking one up                                                              */
/* -------------------------------------------------------------------------- */

export const classById = (id: string | undefined): CharacterClass | null =>
  CLASSES.find((c) => c.id === id) ?? null;

export function subclassById(classId: string | undefined, subclassId: string | undefined): Subclass | null {
  const held = classById(classId);
  if (!held || !subclassId) return null;
  return held.subclasses.find((s) => s.id === subclassId) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Resolving from a character                                                  */
/* -------------------------------------------------------------------------- */

/** Anything carrying a class: a sheet, or the tree's options. */
export type ClassHolder = { classId?: string; classSpec?: CharacterClass; subclassId?: string };

/**
 * The class a character actually has.
 *
 * PREFER THE CARRIED SPEC, and only fall back to the authored eight. Classes
 * are generated per world, so an id no longer names anything globally — and
 * regenerating a roster to resolve one would mean any change to the generator
 * silently rewrote what an existing character IS.
 *
 * The fallback is what keeps every session made before generated classes
 * working: those stored `fighter` or `warlock` and nothing else, and those
 * words still mean what they always did.
 */
export const classOf = (who: ClassHolder | undefined): CharacterClass | null =>
  who?.classSpec ?? classById(who?.classId);

/** The subclass a character took, found inside whichever class they hold. */
export function subclassOf(who: ClassHolder | undefined): Subclass | null {
  const held = classOf(who);
  if (!held || !who?.subclassId) return null;
  return held.subclasses.find((s) => s.id === who.subclassId) ?? null;
}

/** Whether a subclass is still open to them, from a holder rather than two ids. */
export const canChooseSubclassOf = (level: number, who: ClassHolder | undefined): boolean =>
  level >= SUBCLASS_LEVEL && Boolean(classOf(who)) && !who?.subclassId;

/** The level a subclass becomes available. Familiar, and early enough to shape a build. */
export const SUBCLASS_LEVEL = 3;

export const canChooseSubclass = (level: number, classId?: string, subclassId?: string): boolean =>
  level >= SUBCLASS_LEVEL && Boolean(classById(classId)) && !subclassId;

/** Turn a subclass's spec into a real skill, with an id stable across sessions. */
export function subclassSkill(sub: Subclass, language: 'th' | 'en'): ActiveSkill {
  return {
    id: `subclass_${sub.id}`,
    name: sub.grants.name[language],
    description: sub.grants.description[language],
    // The stat its island runs on is the stat it checks against; the grant was
    // composed from that stat's grammar in the first place.
    ability: sub.opens,
    effects: sub.grants.effects,
    range: sub.grants.range,
  };
}
