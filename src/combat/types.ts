/**
 * Tactical combat data model — D&D-like, resolved entirely in code.
 *
 * The model NEVER decides a combat outcome. It narrates a structured round log
 * the engine produced. That keeps combat deterministic, unit-testable offline,
 * free of per-round token cost, and fast.
 */

/**
 * Nine stats, and each one has a job.
 *
 * Six was the D&D set. The three additions come from the other tradition —
 * AGI, VIT and LUK — and they exist because the progression system now turns
 * on stats rather than on disciplines: a skill is keyed to a STAT, and the
 * stat decides what that skill is able to do. Six axes was too few to carry
 * that, and left "how tough you are" and "how fast you are" fused together.
 *
 * CON AND VIT ARE DELIBERATELY SPLIT, and it is the one place this set departs
 * from both traditions. D&D has no VIT because CON does the body; Ragnarok has
 * no CON because VIT does. Taking both from either would leave two stats
 * fighting over one job, and a player unable to say which to raise. So:
 *
 *   CON  the mind holding on — concentration, poison, disease, death saves.
 *        Grants NO hit points. It is whether you keep going, not how much of
 *        you there is.
 *   VIT  the body — hit points, recovery, physical defence, resisting a stun.
 */
import type { PendingCast } from './cast.ts';

export const ABILITIES = ['str', 'dex', 'con', 'agi', 'vit', 'int', 'wis', 'cha', 'luk'] as const;
export type Ability = (typeof ABILITIES)[number];
export type Abilities = Record<Ability, number>;

/**
 * One ability set for the whole game: d20 + modifier resolves combat, and the
 * existing 2d6 three-tier system uses the same modifiers for social and
 * exploration checks. Two resolution systems, one character sheet.
 */
export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

export type Vec = { x: number; y: number };

export const SIZES = ['small', 'medium', 'large'] as const;
export type Size = (typeof SIZES)[number];

export const CONDITIONS = [
  'prone',
  'restrained',
  'grappled',
  'blinded',
  'poisoned',
  'stunned',
  'unconscious',
  /**
   * Rattled, taunted, talked out of it.
   *
   * Added for CHARISMA, which otherwise had no way to hinder anybody — its
   * whole idea is getting under someone's skin, and there was no condition in
   * the engine that meant that. It impairs the frightened creature's own
   * attacks without exposing it, so it is a way to take somebody OUT of a
   * fight rather than a way to help everyone kill them faster.
   */
  'frightened',
] as const;
export type Condition = (typeof CONDITIONS)[number];

/** `roundsLeft: null` means it persists until something removes it. */
export type ActiveCondition = { kind: Condition; roundsLeft: number | null };

export type DamageRoll = {
  count: number;
  sides: number;
  /** Ability whose modifier is added to damage, if any. */
  bonusAbility: Ability | null;
  type: string;
};

export type Attack = {
  id: string;
  name: string;
  ability: Ability;
  proficient: boolean;
  /** In squares. 1 is melee reach. */
  range: number;
  damage: DamageRoll;
};

export type Side = 'party' | 'foe';

export type DeathSaves = { successes: number; failures: number };

export type Combatant = {
  id: string;
  name: string;
  side: Side;
  abilities: Abilities;
  hp: number;
  maxHp: number;
  /**
   * The two pools every skill is paid for out of, which replaced per-skill
   * uses. Stamina is the body exerting itself and comes from VIT; mana is the
   * mind concentrating and comes from CON. Which one a skill draws on follows
   * its STAT — see `poolFor`.
   */
  stamina: number;
  maxStamina: number;
  mana: number;
  maxMana: number;
  ac: number;
  /**
   * Tick budget for acting. Replaced the one-action-per-round boolean, which
   * made AGI meaningless — "faster" cannot mean anything when everybody acts
   * exactly once. May go NEGATIVE: a heavy action overruns into the round
   * after it, which is what makes slow-and-heavy a build rather than a
   * penalty. See tempo.ts.
   */
  ticks: number;
  /**
   * A skill too big to bring off in one round, part-way through.
   *
   * Whether something telegraphs is a BUILD decision rather than a property of
   * the skill: the same effect is instant for a deft caster and a two-round
   * commitment for a slow one, because DEX shortens the tick cost. See cast.ts.
   */
  pendingCast?: PendingCast;
  /**
   * Somebody has made themselves the obvious problem.
   *
   * On the combatant rather than in `conditions` because a taunt has to know
   * BY WHOM — a condition is a kind and a countdown, and "held" is only half
   * of what this means. It ticks down with the conditions all the same, so
   * there is still one clock.
   */
  taunt?: { by: string; roundsLeft: number };
  /** Movement in squares per turn. */
  speed: number;
  proficiency: number;
  size: Size;
  pos: Vec;
  conditions: ActiveCondition[];
  attacks: Attack[];
  /**
   * What KIND of thing this is, and what kind it hunts — both group ids.
   *
   * On the combatant rather than looked up, for the reason exemptions travel on a
   * `Subject`: the combat engine resolves a swing and has no business knowing what
   * a species tree is. Absent on anything built without one, which is every
   * combatant in a world that holds no kinds.
   */
  group?: string;
  hunts?: string;
  /**
   * Party members drop to dying at 0 HP and roll death saves; foes just die.
   * `dead` is terminal in both cases.
   */
  dead: boolean;
  dying: boolean;
  deathSaves: DeathSaves;
};

/** Walls block both movement and line of sight. Keys are `${x},${y}`. */
export type Grid = {
  width: number;
  height: number;
  walls: ReadonlySet<string>;
};

export const ADVANTAGE = ['none', 'advantage', 'disadvantage'] as const;
export type AdvantageState = (typeof ADVANTAGE)[number];

export type D20Roll = {
  /** Every die rolled — two entries under advantage or disadvantage. */
  dice: number[];
  /** The die that counted. */
  natural: number;
  modifier: number;
  total: number;
  advantage: AdvantageState;
};

export type AttackResult = {
  kind: 'attack';
  attacker: string;
  target: string;
  attackName: string;
  roll: D20Roll;
  /** Natural 1 always misses, natural 20 always hits and crits. */
  hit: boolean;
  critical: boolean;
  damage: number;
  damageType: string;
  damageDice: number[];
  targetHpBefore: number;
  targetHpAfter: number;
  droppedTarget: boolean;
  killedTarget: boolean;
  /** The blow broke a wind-up cast the target was holding. */
  brokeCast?: boolean;
};

export type MoveResult = {
  kind: 'move';
  actor: string;
  from: Vec;
  to: Vec;
  cost: number;
};

export type SaveResult = {
  kind: 'save';
  actor: string;
  ability: Ability;
  dc: number;
  roll: D20Roll;
  success: boolean;
};

export type DeathSaveResult = {
  kind: 'deathSave';
  actor: string;
  roll: D20Roll;
  outcome: 'success' | 'failure' | 'criticalSuccess' | 'criticalFailure';
  saves: DeathSaves;
  stabilized: boolean;
  died: boolean;
};

export type ConditionResult = {
  kind: 'condition';
  actor: string;
  condition: Condition;
  applied: boolean;
};

export type CombatEvent =
  | AttackResult
  | MoveResult
  | SaveResult
  | DeathSaveResult
  | ConditionResult
  | { kind: 'roundStart'; round: number }
  | { kind: 'turnStart'; actor: string }
  | { kind: 'combatEnd'; victor: Side | 'draw' };

export type CombatState = {
  round: number;
  /** Index into `order`. */
  turn: number;
  /** Combatant ids in initiative order, fixed for the encounter. */
  order: string[];
  combatants: Record<string, Combatant>;
  grid: Grid;
  /** Movement squares remaining for the combatant whose turn it is. */
  movementLeft: number;
  over: boolean;
  victor: Side | 'draw' | null;
  log: CombatEvent[];
};
