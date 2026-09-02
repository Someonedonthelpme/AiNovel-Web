import type { Rng } from '../engine/roll.ts';
import { d20, rollDamage } from './dice.ts';
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
export function applyDamage(target: Combatant, amount: number): Combatant {
  const hp = Math.max(0, target.hp - amount);
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
  const hpBefore = target.hp;
  const hurt = applyDamage(target, dmg.total);

  return {
    attacker,
    target: hurt,
    event: {
      kind: 'attack', attacker: attacker.id, target: target.id, attackName: attack.name,
      roll, hit: true, critical, damage: dmg.total, damageType: dmg.type, damageDice: dmg.dice,
      targetHpBefore: hpBefore, targetHpAfter: hurt.hp,
      droppedTarget: hpBefore > 0 && hurt.hp === 0,
      killedTarget: hurt.dead && !target.dead,
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
