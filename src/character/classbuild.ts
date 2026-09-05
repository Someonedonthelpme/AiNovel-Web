import { mulberry32 } from '../engine/roll.ts';
import { STAT_GRAMMAR } from '../skills/statgrammar.ts';
import { PATH_WORDS } from '../play/pathwords.ts';
import type { SkillSpec } from '../skills/active.ts';
import { composeSkill, nameFor } from '../skills/compose.ts';
import type { ClassShape, SubclassShape } from './classgen.ts';
import type { CharacterClass, Subclass } from './classes.ts';
import type { Attack } from '../combat/types.ts';

/**
 * Turning a mechanical shape into a class somebody can pick.
 *
 * The seam between the two halves. `classgen` decided what this class IS —
 * its die, its disciplines, its doors — and the model decided what it is
 * CALLED in the world the player just described. This puts them together and
 * composes the skills, which neither of them does.
 *
 * The grants are composed rather than authored for the same reason every other
 * generated skill is: the authored sixteen meant two Warlocks in different
 * worlds got the same Ash on the Tongue forever. Composition draws from the
 * island discipline's own grammar against a budget, so a subclass into `flame`
 * teaches something recognisably of the fire and never the same thing twice.
 */

/** What the model supplies, having been told the shape and the world. */
export type ClassNaming = {
  shapeId: string;
  name: string;
  description: string;
  /** What it sets out holding. The shape decided the dice; this is the word. */
  weaponName: string;
  subclasses: { shapeId: string; name: string; description: string }[];
};

/*
 * Generated text is single-language, and the `Bilingual` slots both get it.
 *
 * Not laziness — a run HAS a language. `world.language` is fixed at creation,
 * `generateCharacter` already writes the whole sheet in one language, and
 * nothing in a session ever renders the other. The authored eight are bilingual
 * because they are global and shipped; a roster drawn for one tower is not.
 */
const both = (text: string) => ({ en: text, th: text });

/** Fallback words, for when the model is unavailable or returns nothing usable. */
const ROLE_FALLBACK: Record<string, { name: string; description: string; weapon: string }> = {
  frontline: { name: 'The Standing', description: 'You are what other people get behind.', weapon: 'a heavy blade' },
  skirmisher: { name: 'The Quick', description: 'You are gone before it lands.', weapon: 'a long knife' },
  scholar: { name: 'The Read', description: 'You would rather work it out than fight it.', weapon: 'a weighted staff' },
  talker: { name: 'The Spoken', description: 'You rarely have to draw anything.', weapon: 'a slim blade' },
  survivor: { name: 'The Lasting', description: 'You come back. That is the whole of it.', weapon: 'a hunting bow' },
  channeler: { name: 'The Borrowed', description: 'You draw on something that is not yours.', weapon: 'a bound focus' },
  mender: { name: 'The Keeping', description: 'You keep other people standing.', weapon: 'a walking staff' },
};

/**
 * Compose the skill a subclass grants.
 *
 * Keyed on the subclass id rather than the world seed, so the same subclass
 * always teaches the same thing — a character who took it at level three and
 * reloads at level nine must not find it has become something else.
 */
export function subclassGrant(sub: SubclassShape, language: 'th' | 'en'): SkillSpec {
  const grammar = STAT_GRAMMAR[sub.opens];
  const rng = mulberry32(hash(sub.id));

  const composed = composeSkill(rng, {
    id: `subclass_${sub.id}`,
    name: '',
    description: '',
    ability: sub.opens,
    grammar,
    budget: sub.grant.budget,
    language,
  });

  return {
    name: both(composed.name),
    description: both(composed.description || PATH_WORDS[sub.opens].keystone),
    effects: composed.effects,
    range: composed.range,
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Assemble a class from its shape and whatever words we have for it. */
export function buildClass(
  shape: ClassShape,
  naming: ClassNaming | null,
  language: 'th' | 'en',
): CharacterClass {
  const fallback = ROLE_FALLBACK[shape.role] ?? ROLE_FALLBACK.frontline;
  const name = naming?.name?.trim() || fallback.name;
  const description = naming?.description?.trim() || fallback.description;
  const weaponName = naming?.weaponName?.trim() || fallback.weapon;

  const startingAttack: Attack = {
    id: `atk_${shape.id}`,
    name: weaponName,
    ability: shape.primary,
    proficient: true,
    range: shape.weapon.range,
    damage: {
      count: 1,
      sides: shape.weapon.sides,
      bonusAbility: shape.primary,
      type: shape.weapon.type,
    },
  };

  const subclasses: Subclass[] = shape.subclasses.map((sub, i) => {
    const said = naming?.subclasses?.find((s) => s.shapeId === sub.id);
    return {
      id: sub.id,
      name: both(said?.name?.trim() || `${name} · ${sub.route === 'cross' ? 'the way out' : 'the deep road'} ${i + 1}`),
      description: both(
        said?.description?.trim()
        || (sub.route === 'cross'
          ? `You went somewhere your training said you would not.`
          : `You went further into what you already were.`),
      ),
      route: sub.route,
      opens: sub.opens,
      grants: subclassGrant(sub, language),
    };
  });

  return {
    id: shape.id,
    name: both(name),
    description: both(description),
    hitDie: shape.hitDie,
    primary: shape.primary,
    secondary: shape.secondary,
    favours: shape.favours,
    against: shape.against,
    startingAttack,
    startingArmour: shape.startingArmour,
    subclasses,
  };
}
