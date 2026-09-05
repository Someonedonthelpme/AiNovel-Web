import type { Ability, Combatant, Condition } from '../combat/types.ts';
import { addCondition, removeCondition } from '../combat/conditions.ts';
import { finishCast } from '../combat/cast.ts';
import { applyDamage } from '../combat/resolve.ts';
import type { TraitCondition } from '../play/traits.ts';
import { magnitudeOf, purposes, radiusOf as spreadOf, reachesOut, standingBonus, usableInCombat } from './effect.ts';
import type { Effect, SpecialVerb } from './effect.ts';
import { scaleBy, suitOf } from './suit.ts';
import { STANDARD } from '../rules/ruleset.ts';
import type { Ruleset } from '../rules/ruleset.ts';
import type { Temperament } from '../character/persona.ts';

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
 * like; the code decides what it does. An effect is built from components the
 * engine resolves, never free text — see `effect.ts`.
 *
 * `ActiveKind` (combat / social / utility) is GONE. A skill is used as you
 * please, the way it is at a table: what it can do comes from its effects, not
 * from a category somebody filed it under.
 *
 * `usesPerRest` is gone with it. Pools and the tick budget are the resource
 * economy; per-skill allowances had stopped gating anything in play and
 * survived only as an input to the composer's own pricing.
 */

export type ActiveSkill = {
  id: string;
  /** Generated in the play language, so a Thai character reads Thai skill names. */
  name: string;
  description: string;
  ability: Ability;
  /**
   * What it does, and what it costs, as components.
   *
   * A LIST because `drain` and `hex` were always two effects fused into one
   * union arm, and because a cost is just another effect — which is what lets
   * blood magic pay in hp rather than needing its own mechanism.
   */
  effects: Effect[];
  /** Squares. 1 is reach; 0 means it only ever touches you. */
  range: number;
  /** Gates a skill learned from a book behind being ready for it. */
  requires?: TraitCondition[];
};

/*
 * These three used to switch on the payload kind, which is exactly the kind of
 * table that had to be edited every time a payload was added. They are reads
 * off the components now, so a new channel or shape needs no entry anywhere.
 */
export const isCombatUsable = (skill: ActiveSkill): boolean => usableInCombat(skill.effects);
export const needsTarget = (skill: ActiveSkill): boolean => reachesOut(skill.effects);
export const radiusOf = (skill: ActiveSkill): number => spreadOf(skill.effects);

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
export function resolveSkill(
  skill: ActiveSkill,
  actor: Combatant,
  targets: readonly Combatant[],
  as?: { temperament?: Temperament } | null,
  rules: Ruleset = STANDARD,
): SkillOutcome {
  let self = actor;
  const hit = new Map<string, Combatant>();
  const notes: string[] = [];

  // The other half of the signed budget: what suits you lands harder, and what
  // does not lands softer, off the same number that already moved the price.
  const suit = suitOf(skill.effects, as?.temperament);

  for (const effect of purposes(skill.effects)) {
    // Who this particular effect lands on. A list means one action can hurt
    // them and heal you, which the old union could only do as a special case.
    const recipients = effect.who === 'own' ? [self] : [...targets];
    if (recipients.length === 0) continue;

    const amount = Math.max(1, Math.round(scaleBy(magnitudeOf(effect), suit, rules.persona.suitSwing)));
    for (const raw of recipients) {
      const before = effect.who === 'own' ? self : hit.get(raw.id) ?? raw;
      const after = applyOne(effect, before, amount, actor);
      if (effect.who === 'own') self = after;
      else hit.set(raw.id, after);
    }
    notes.push(noteFor(effect, actor, recipients[0], amount));
  }

  return {
    actor: self,
    affected: [...hit.values()],
    note: notes.join('; ') || `${actor.name} does nothing much`,
  };
}

/** One effect against one recipient. Nothing here rolls; see the docblock. */
function applyOne(effect: Effect, who: Combatant, amount: number, actor: Combatant): Combatant {
  switch (effect.channel) {
    case 'hp':
      return effect.sign === 'minus'
        ? applyDamage(who, amount)
        : { ...who, hp: Math.min(who.maxHp, who.hp + amount) };

    case 'stamina':
      return effect.sign === 'minus'
        ? { ...who, stamina: Math.max(0, who.stamina - amount) }
        : { ...who, stamina: Math.min(who.maxStamina, who.stamina + amount) };

    case 'mana':
      return effect.sign === 'minus'
        ? { ...who, mana: Math.max(0, who.mana - amount) }
        : { ...who, mana: Math.min(who.maxMana, who.mana + amount) };

    case 'condition':
      // Sign is from the recipient's side: `minus` lands it, `plus` clears it.
      // That convention is what makes hinder and rally one shape.
      return effect.sign === 'minus'
        ? addCondition(who, effect.condition, effect.duration.kind === 'rounds' ? effect.duration.rounds : null)
        : removeCondition(who, effect.condition);

    case 'stat':
      // A sustained bonus is held, not applied — `standingBonus` reads it off
      // the skill. Temporary in-combat modifiers need a timer on `Combatant`,
      // which is the next piece of machinery this wants.
      return who;

    case 'special':
      return applyVerb(effect.verb, who, amount, actor);
  }
}

/**
 * The verbs, for the things that are not a number moving.
 *
 * Each one is here because the engine could already do it and nothing could
 * ask for it — `pendingCast`, the condition list and the AI's target choice
 * all existed with no way to reach them from a skill.
 */
function applyVerb(verb: SpecialVerb, who: Combatant, amount: number, actor: Combatant): Combatant {
  switch (verb) {
    case 'interrupt':
      /*
       * BREAKING A WIND-UP OUTRIGHT, with no roll to hold it.
       *
       * `breakCast` is the other route: a blow lands and CON decides whether
       * it survives. A skill built to interrupt does not ask — that is what
       * makes it worth a turn rather than being a worse attack. Nothing is
       * refunded, exactly as when a cast completes: it was spent as intended.
       */
      return who.pendingCast ? finishCast(who) : who;

    case 'cleanse':
      // Everything, rather than one named thing. Naming one is what the
      // condition channel already does, so the verb has to be the wider move.
      return who.conditions.reduce((c, x) => removeCondition(c, x.kind), who);

    case 'taunt':
      // Who did it is the whole content of a taunt, so it is stored rather
      // than derived — the AI reads it in `pickTarget`.
      return { ...who, taunt: { by: actor.id, roundsLeft: Math.max(1, amount) } };
  }
}

function noteFor(effect: Effect, actor: Combatant, target: Combatant, amount: number): string {
  const who = effect.who === 'own' ? actor.name : target.name;
  switch (effect.channel) {
    case 'hp':
      return effect.sign === 'minus'
        ? `${actor.name} hurts ${who} for ${amount}`
        : `${actor.name} closes a wound on ${who}`;
    case 'condition':
      return effect.sign === 'minus'
        ? `${actor.name} leaves ${who} ${effect.condition}`
        : `${who} shakes off being ${effect.condition}`;
    case 'stamina':
    case 'mana':
      return `${who} is ${effect.sign === 'minus' ? 'drained' : 'restored'}`;
    case 'special':
      return effect.verb === 'cleanse' ? `${who} is clear of it`
        : effect.verb === 'interrupt' ? `${actor.name} breaks what ${who} was building`
          : `${who} can look at nothing but ${actor.name}`;
    default:
      return `${actor.name} steadies`;
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
  return skills.reduce((bonus, skill) => bonus + standingBonus(skill.effects, ability), 0);
}

/* -------------------------------------------------------------------------- */
/* Authored skill specs                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A skill written by hand rather than composed.
 *
 * Rehomed here when `archetypes.ts` was deleted — these two types were the only
 * things left in that file that were not a fantasy discipline. A class's
 * subclass grant is the last authored skill in the game; everything else is
 * composed from a stat's grammar.
 */
export type Bilingual = { en: string; th: string };

export type SkillSpec = {
  name: Bilingual;
  description: Bilingual;
  effects: Effect[];
  range: number;
};
