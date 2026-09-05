import type { Rng } from '../engine/roll.ts';
import { STANDARD } from '../rules/ruleset.ts';
import type { Ruleset } from '../rules/ruleset.ts';
import { d20, rollDamage } from './dice.ts';
import { breakCast } from './cast.ts';
import { attackModifiers, addCondition, hasCondition, removeCondition } from './conditions.ts';
import { distance } from './grid.ts';
import type { Ability, AttackResult, Combatant, DeathSaveResult, SaveResult } from './types.ts';
import { abilityMod } from './types.ts';

/**
 * Attack, save and death-save resolution.
 *
 * Every function here is pure: it takes combatants and an RNG and returns the
 * updated combatants plus a structured event. Nothing consults a model, and the
 * events are what the Writer later narrates.
 */

export function attackBonus(attacker: Combatant, attackId: string): number {
  const attack = attacker.attacks.find((a) => a.id === attackId);
  if (!attack) return 0;
  return abilityMod(attacker.abilities[attack.ability]) + (attack.proficient ? attacker.proficiency : 0);
}

/** Apply damage, handling the party/foe split at 0 HP. */
/**
 * What the body soaks. VIT's "physical DEF", which nothing implemented.
 *
 * The split that makes VIT and AGI a real choice rather than two words for the
 * same thing: AGI decides whether a blow LANDS (it is AC), VIT decides how much
 * it costs you when it does. Dodging and enduring are different builds.
 *
 * FLAT REDUCTION IS THE TRAP, and it was measured rather than guessed. Taking
 * a straight 2 off every blow made floors 1-5 a formality (94% → 100% win, 73%
 * → 83% hp left) while making floor 20 meaningfully worse (51% → 41%), because
 * subtracting 2 from a 4-damage hit halves it and from a 20-damage hit is
 * noise — and deep foes have the VIT to soak the player right back. It widened
 * the curve at BOTH ends.
 *
 * So the soak is capped by a FRACTION of the blow as well as by the stat: at
 * most `SOAK_SHARE` of what was coming. Being tough takes the edge off a heavy
 * hit; it does not make you immune to small ones.
 *
 * A ceiling of 2 rather than 4, also measured. At 4 the deep floors got worse
 * (20: 51% → 42%) because a boss has the VIT to soak the player straight back.
 * At 2 the whole curve shifts up 3-5 points and KEEPS ITS SHAPE, which is the
 * honest cost of giving VIT a defensive job it never had:
 *
 *   floor      1     5     8    10    14    20    30
 *   before    94%   96%   86%   78%   83%   51%   53%
 *   after     99%   99%   89%   84%   86%   56%   57%
 *
 * VIT's headline is hit points. This is a nudge on top, not a second HP bar.
 */
export const MAX_REDUCTION = STANDARD.combat.soakCeiling;
export const MIN_HIT = STANDARD.combat.minHit;
/** The most of any single blow that VIT may absorb. */
export const SOAK_SHARE = STANDARD.combat.soakShare;

export const damageReduction = (who: Combatant, rules: Ruleset = STANDARD): number =>
  Math.max(0, Math.min(rules.combat.soakCeiling, abilityMod(who.abilities.vit)));

/** What this particular blow actually loses to the body it lands on. */
export const soakOf = (target: Combatant, amount: number, rules: Ruleset = STANDARD): number =>
  Math.min(damageReduction(target, rules), Math.floor(amount * rules.combat.soakShare));

export function applyDamage(target: Combatant, amount: number, rules: Ruleset = STANDARD): Combatant {
  const soaked = amount > 0
    ? Math.max(rules.combat.minHit, amount - soakOf(target, amount, rules))
    : amount;
  const hp = Math.max(0, target.hp - soaked);
  if (hp > 0) return { ...target, hp };

  if (target.side === 'foe') {
    return { ...target, hp: 0, dead: true, dying: false };
  }
  // Party members drop unconscious and start rolling death saves.
  return addCondition(
    { ...target, hp: 0, dying: true, deathSaves: { successes: 0, failures: 0 } },
    'unconscious',
  );
}

export type AttackOutcome = { attacker: Combatant; target: Combatant; event: AttackResult };

/**
 * The lowest natural roll that crits, which LUCK lowers.
 *
 * Twenty by default, and never below eighteen however lucky you get — a crit
 * range wider than that stops being a lucky break and becomes the normal case,
 * which flattens the damage curve `scripts/balance.ts` is tuned against.
 *
 * Widening the range rather than rolling a separate chance is deliberate: it
 * rides the attack roll that already happened, so nothing extra is drawn from
 * the rng and a replayed log resolves identically. Determinism is not
 * negotiable here — every fight is a fold over an event log.
 */
export const CRIT_FLOOR_MIN = 18;

export function critFloor(attacker: Combatant): number {
  const luck = abilityMod(attacker.abilities.luk);
  return Math.max(CRIT_FLOOR_MIN, 20 - Math.max(0, Math.floor(luck / 2)));
}

export function resolveAttack(
  rng: Rng,
  attacker: Combatant,
  target: Combatant,
  attackId: string,
): AttackOutcome {
  const attack = attacker.attacks.find((a) => a.id === attackId);
  if (!attack) throw new Error(`${attacker.id} has no attack "${attackId}"`);

  const dist = distance(attacker.pos, target.pos);
  const mods = attackModifiers(attacker, target, dist);
  const roll = d20(rng, attackBonus(attacker, attackId), mods.advantage);

  // A natural 1 always misses and a natural 20 always hits, whatever the AC.
  const hit = roll.natural === 20 || (roll.natural !== 1 && roll.total >= target.ac);
  const critical = hit && (roll.natural >= critFloor(attacker) || mods.autoCrit);

  if (!hit) {
    return {
      attacker,
      target,
      event: {
        kind: 'attack', attacker: attacker.id, target: target.id, attackName: attack.name,
        roll, hit: false, critical: false, damage: 0, damageType: attack.damage.type,
        damageDice: [], targetHpBefore: target.hp, targetHpAfter: target.hp,
        droppedTarget: false, killedTarget: false,
      },
    };
  }

  const dmg = rollDamage(rng, attack.damage, attacker.abilities, critical);

  /*
   * A blow that lands on somebody mid-cast makes them hold it or lose it.
   * Resolved HERE rather than in `applyDamage`, which is pure and has no dice —
   * and the check needs one.
   */
  const jolted = breakCast(rng, target, dmg.total);
  const hpBefore = target.hp;
  // Damage lands on whatever the jolt left behind, so a broken cast's refund
  // is not thrown away by the hit that caused it.
  const hurt = applyDamage(jolted.who, dmg.total);

  return {
    attacker,
    target: hurt,
    event: {
      kind: 'attack', attacker: attacker.id, target: target.id, attackName: attack.name,
      roll, hit: true, critical, damage: dmg.total, damageType: dmg.type, damageDice: dmg.dice,
      targetHpBefore: hpBefore, targetHpAfter: hurt.hp,
      droppedTarget: hpBefore > 0 && hurt.hp === 0,
      killedTarget: hurt.dead && !target.dead,
      brokeCast: jolted.broken || undefined,
    },
  };
}

export function resolveSave(rng: Rng, actor: Combatant, ability: Ability, dc: number): { actor: Combatant; event: SaveResult } {
  // Stunned and unconscious creatures fail STR and DEX saves automatically.
  const autoFail =
    (ability === 'str' || ability === 'dex') &&
    (hasCondition(actor, 'stunned') || hasCondition(actor, 'unconscious') || actor.dying);

  const roll = d20(rng, abilityMod(actor.abilities[ability]), hasCondition(actor, 'poisoned') ? 'disadvantage' : 'none');
  const success = autoFail ? false : roll.total >= dc;
  return { actor, event: { kind: 'save', actor: actor.id, ability, dc, roll, success } };
}

/**
 * 5e death saves: 10+ succeeds, a natural 20 brings you back up at 1 HP, a
 * natural 1 counts as two failures. Three of either settles it.
 */
export function rollDeathSave(rng: Rng, actor: Combatant): { actor: Combatant; event: DeathSaveResult } {
  const roll = d20(rng, 0);
  let { successes, failures } = actor.deathSaves;
  let outcome: DeathSaveResult['outcome'];

  if (roll.natural === 20) {
    outcome = 'criticalSuccess';
  } else if (roll.natural === 1) {
    outcome = 'criticalFailure';
    failures += 2;
  } else if (roll.natural >= 10) {
    outcome = 'success';
    successes += 1;
  } else {
    outcome = 'failure';
    failures += 1;
  }

  if (outcome === 'criticalSuccess') {
    const revived = removeCondition(
      { ...actor, hp: 1, dying: false, deathSaves: { successes: 0, failures: 0 } },
      'unconscious',
    );
    return {
      actor: revived,
      event: { kind: 'deathSave', actor: actor.id, roll, outcome, saves: revived.deathSaves, stabilized: true, died: false },
    };
  }

  const died = failures >= 3;
  const stabilized = successes >= 3;
  // A natural 1 adds two failures, so the tally can overshoot; clamp it so the
  // sheet never reads "4 of 3".
  const next: Combatant = {
    ...actor,
    deathSaves: { successes: Math.min(3, successes), failures: Math.min(3, failures) },
    dead: died,
    dying: died ? false : actor.dying,
  };

  return {
    actor: next,
    event: { kind: 'deathSave', actor: actor.id, roll, outcome, saves: next.deathSaves, stabilized, died },
  };
}
