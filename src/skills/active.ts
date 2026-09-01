import type { Ability, Combatant, Condition } from '../combat/types.ts';
import { addCondition, removeCondition } from '../combat/conditions.ts';
import type { TraitCondition } from '../play/traits.ts';

/**
 * Active skills — the things a character DOES.
 *
 * The passive tree answers "what am I"; this answers "what do I do". They are
 * different systems on purpose, and Path of Exile splits them the same way:
 * the tree is bought with points and never leaves, actives arrive from
 * elsewhere and are used a limited number of times.
 *
 * Until now `Skill` existed on every background, was shown in the sidebar, was
 * listed to the Director as text — and did nothing whatsoever. A character had
 * "Shield Wall" written on their sheet and no way to raise a shield.
 *
 * The usual rule holds: the model names the skill and writes what it feels
 * like; the code decides what it does. `ActiveEffect` is a closed union
 * resolved by the engine, never free text.
 */

export const ACTIVE_KINDS = ['combat', 'social', 'utility'] as const;
export type ActiveKind = (typeof ACTIVE_KINDS)[number];

/**
 * What using a skill does.
 *
 * Deliberately built only from primitives the combat engine already has —
 * conditions, hit points, advantage — so nothing here needs the resolver
 * rewritten to support it.
 */
export type ActiveEffect =
  /** Put a condition on somebody else. The engine already knows what each costs them. */
  | { kind: 'hinder'; condition: Condition; rounds: number }
  /** Close a wound. */
  | { kind: 'mend'; amount: number }
  /** Shake something off yourself. */
  | { kind: 'rally'; condition: Condition }
  /** Out of combat: a standing bonus on checks of one ability. */
  | { kind: 'edge'; ability: Ability; bonus: number };

export type ActiveSkill = {
  id: string;
  /** Generated in the play language, so a Thai character reads Thai skill names. */
  name: string;
  description: string;
  kind: ActiveKind;
  ability: Ability;
  effect: ActiveEffect;
  /** Squares. 1 is reach; 0 means it only ever touches you. */
  range: number;
  /**
   * How often it can be used before a rest.
   *
   * The reason actives are a resource rather than a button: an unlimited
   * ability is just a better basic attack, and the fight becomes a rotation.
   * Rest refreshes them, which puts them on the same supply economy as healing.
   */
  usesPerRest: number;
  /** Gates a skill learned from a book behind being ready for it. */
  requires?: TraitCondition[];
};

/** Which effects can be used mid-fight at all. */
export const isCombatUsable = (skill: ActiveSkill): boolean => skill.effect.kind !== 'edge';

/** Whether a skill needs somebody on the other end. */
export const needsTarget = (skill: ActiveSkill): boolean => skill.effect.kind === 'hinder';

/* -------------------------------------------------------------------------- */
/* Uses                                                                        */
/* -------------------------------------------------------------------------- */

/** Uses spent since the last rest, keyed by skill id. */
export type SkillUses = Record<string, number>;

export const usesLeft = (skill: ActiveSkill, spent: SkillUses): number =>
  Math.max(0, skill.usesPerRest - (spent[skill.id] ?? 0));

export const spendUse = (spent: SkillUses, id: string): SkillUses => ({
  ...spent,
  [id]: (spent[id] ?? 0) + 1,
});

/** A rest gives them all back. Short and long alike — that is what rest is for. */
export const refreshUses = (): SkillUses => ({});

/* -------------------------------------------------------------------------- */
/* Resolution                                                                  */
/* -------------------------------------------------------------------------- */

export type SkillOutcome = {
  actor: Combatant;
  target: Combatant | null;
  /** A line for the fight log, in the same register as `notableEvents`. */
  note: string;
};

/**
 * Apply a skill's effect.
 *
 * Pure, and deterministic: no dice here. A skill that sometimes failed would
 * need the same tier commitment the Director's checks use, and for a resource
 * you only get a few of per rest, "it just works" is the better bargain.
 */
export function resolveSkill(skill: ActiveSkill, actor: Combatant, target: Combatant | null): SkillOutcome {
  const effect = skill.effect;

  if (effect.kind === 'hinder' && target) {
    return {
      actor,
      target: addCondition(target, effect.condition, effect.rounds),
      note: `${actor.name} leaves ${target.name} ${effect.condition}`,
    };
  }

  if (effect.kind === 'mend') {
    const healed = Math.min(actor.maxHp, actor.hp + effect.amount);
    return {
      actor: { ...actor, hp: healed },
      target,
      note: `${actor.name} closes a wound`,
    };
  }

  if (effect.kind === 'rally') {
    return {
      actor: removeCondition(actor, effect.condition),
      target,
      note: `${actor.name} shakes off being ${effect.condition}`,
    };
  }

  // An `edge` has no meaning inside a fight; it applies to checks outside one.
  return { actor, target, note: `${actor.name} steadies` };
}

/**
 * The bonus a character's skills give to a check of one ability.
 *
 * This is where `utility` and `social` skills finally do something: the 2d6
 * social and exploration resolver adds it, so "Read the Ground" is worth having
 * when the Director calls for wisdom.
 */
export function edgeFor(skills: readonly ActiveSkill[], ability: Ability): number {
  let bonus = 0;
  for (const skill of skills) {
    if (skill.effect.kind === 'edge' && skill.effect.ability === ability) bonus += skill.effect.bonus;
  }
  return bonus;
}
