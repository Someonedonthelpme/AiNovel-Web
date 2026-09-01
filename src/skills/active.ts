import type { Ability, Combatant, Condition } from '../combat/types.ts';
import { addCondition, removeCondition } from '../combat/conditions.ts';
import { applyDamage } from '../combat/resolve.ts';
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
  | { kind: 'edge'; ability: Ability; bonus: number }
  /** Straight damage that does not roll to hit. Short range, few uses. */
  | { kind: 'strike'; damage: number }
  /** Damage that feeds you. The signature of anything that costs something. */
  | { kind: 'drain'; damage: number; heal: number }
  /** Everything within `radius` of the target. */
  | { kind: 'burst'; damage: number; radius: number }
  /** Damage AND a condition. The expensive combination. */
  | { kind: 'hex'; damage: number; condition: Condition; rounds: number };

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
export const needsTarget = (skill: ActiveSkill): boolean =>
  ['hinder', 'strike', 'drain', 'burst', 'hex'].includes(skill.effect.kind);

/** How far the effect spreads from whoever it lands on. */
export const radiusOf = (skill: ActiveSkill): number =>
  skill.effect.kind === 'burst' ? skill.effect.radius : 0;

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
  /** Everyone the effect touched, already updated. */
  affected: Combatant[];
  /** A line for the fight log, in the same register as `notableEvents`. */
  note: string;
};

/**
 * Apply a skill's effect.
 *
 * Pure, and deterministic: no dice here. A skill that sometimes failed would
 * need the same tier commitment the Director's checks use, and for a resource
 * you only get a few of per rest, "it just works" is the better bargain in
 * exchange for the scarcity.
 *
 * Damage goes through the engine's own `applyDamage`, so dropping to nought,
 * dying and death saves behave exactly as they do for a sword — a skill that
 * killed somebody by a different route than an attack would be a second set of
 * rules to keep in step.
 */
export function resolveSkill(skill: ActiveSkill, actor: Combatant, targets: readonly Combatant[]): SkillOutcome {
  const effect = skill.effect;
  const first = targets[0] ?? null;

  switch (effect.kind) {
    case 'hinder':
      return first
        ? {
            actor,
            affected: [addCondition(first, effect.condition, effect.rounds)],
            note: `${actor.name} leaves ${first.name} ${effect.condition}`,
          }
        : { actor, affected: [], note: `${actor.name} finds nothing to reach` };

    case 'strike':
      return first
        ? {
            actor,
            affected: [applyDamage(first, effect.damage)],
            note: `${actor.name} strikes ${first.name} for ${effect.damage}`,
          }
        : { actor, affected: [], note: `${actor.name} strikes nothing` };

    case 'drain': {
      if (!first) return { actor, affected: [], note: `${actor.name} draws on nothing` };
      return {
        actor: { ...actor, hp: Math.min(actor.maxHp, actor.hp + effect.heal) },
        affected: [applyDamage(first, effect.damage)],
        note: `${actor.name} takes ${effect.damage} out of ${first.name}, and keeps some of it`,
      };
    }

    case 'burst':
      return {
        actor,
        affected: targets.map((t) => applyDamage(t, effect.damage)),
        note: `${actor.name} catches ${targets.length} of them for ${effect.damage}`,
      };

    case 'hex':
      return first
        ? {
            actor,
            affected: [addCondition(applyDamage(first, effect.damage), effect.condition, effect.rounds)],
            note: `${actor.name} leaves ${first.name} hurt and ${effect.condition}`,
          }
        : { actor, affected: [], note: `${actor.name} finds nothing to curse` };

    case 'mend':
      return {
        actor: { ...actor, hp: Math.min(actor.maxHp, actor.hp + effect.amount) },
        affected: [],
        note: `${actor.name} closes a wound`,
      };

    case 'rally':
      return {
        actor: removeCondition(actor, effect.condition),
        affected: [],
        note: `${actor.name} shakes off being ${effect.condition}`,
      };

    // An `edge` has no meaning inside a fight; it applies to checks outside one.
    case 'edge':
      return { actor, affected: [], note: `${actor.name} steadies` };
  }
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
