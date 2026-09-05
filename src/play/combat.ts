import { autoTurn } from '../combat/ai.ts';
import { attack, attackOptions, currentActor, endTurn, movementOptions, moveTo, startCombat } from '../combat/combat.ts';
import { buildEncounter, kindForFloor } from '../combat/encounter.ts';
import { cellKey, distance, hasLineOfSight } from '../combat/grid.ts';
import type { CombatEvent, CombatState, Combatant, Grid, Vec } from '../combat/types.ts';
import { bumpCounter } from '../character/persona.ts';
import { addItem } from '../items/types.ts';
import { rollCoin, rollLoot } from '../items/catalogue.ts';
import type { Drop } from '../items/catalogue.ts';
import { grantXp, hpAfterGrowth, xpForFight } from './progress.ts';
import type { LevelUp } from './progress.ts';
import { COUNTERS } from './traits.ts';
import { mulberry32 } from '../engine/roll.ts';
import type { Rng } from '../engine/roll.ts';
import { activeSkills, toCombatant } from '../session/sheet.ts';
import { isCombatUsable, needsTarget, radiusOf, resolveSkill } from '../skills/active.ts';
import { canAfford, costOf, priceOfUse, spend } from '../skills/pools.ts';
import { canAct, castTicks, spendTicks } from '../combat/tempo.ts';
import { advanceCast, beginCast, finishCast } from '../combat/cast.ts';
import { activeRegion } from '../world/travel.ts';
import type { PlayState } from './state.ts';

/**
 * Combat, as it appears inside the play loop.
 *
 * The engine already resolves fights; this is the seam that lets one start, lets
 * the player act, and folds the result back into the world.
 *
 * Two rules shape it. The player's action is CHOSEN FROM A LEGAL LIST rather
 * than parsed from prose, so no model call is needed to swing a sword — which
 * keeps a fight fast and free. And every roll is derived from state, so a
 * replayed log produces the identical fight rather than a differently unlucky
 * one.
 */

export const ARENA_SIZE = 12;

/**
 * The ground you fight on.
 *
 * Deterministic from the seed: the same encounter must lay out the same way on
 * replay, and a few obstacles make position matter without turning it into a
 * maze.
 */
export function arenaFor(seed: number, danger: number): Grid {
  const rng = mulberry32(seed * 31 + danger);
  const walls = new Set<string>();
  const obstacles = Math.min(6, 1 + Math.floor(danger / 6));

  for (let i = 0; i < obstacles; i++) {
    // Kept off the edges so neither side can be spawned into a corner it
    // cannot leave.
    const x = 3 + Math.floor(rng() * (ARENA_SIZE - 6));
    const y = 3 + Math.floor(rng() * (ARENA_SIZE - 6));
    walls.add(cellKey({ x, y }));
  }
  return { width: ARENA_SIZE, height: ARENA_SIZE, walls };
}

/** Every roll in a fight comes from here, so a replay reproduces it exactly. */
export function combatRng(state: PlayState): Rng {
  const length = state.combat?.log.length ?? 0;
  return mulberry32(state.world.seed + state.world.turn * 7919 + length);
}

/** The player character as they currently stand — wounds and all. */
export function playerCombatant(state: PlayState): Combatant {
  const base = toCombatant(state.sheet, 'pc');
  return {
    ...base,
    hp: Math.min(state.pc.hp, base.maxHp),
    /*
     * POOLS ARE CARRIED IN, and this was a real hole.
     *
     * `toCombatant` fills stamina and mana to their ceilings, which is right
     * for a foe built from a statblock and wrong for the player: nothing
     * carried the spent pools in, and `concludeCombat` carried nothing back
     * out. So every encounter opened with full pools however hard the last one
     * had been, and the scarcity the whole stamina/mana economy exists to
     * create never happened. Two fights back to back cost exactly as much as
     * one.
     */
    stamina: Math.min(state.pc.stamina, base.maxStamina),
    mana: Math.min(state.pc.mana, base.maxMana),
    conditions: state.pc.conditions,
    pos: { x: 1, y: Math.floor(ARENA_SIZE / 2) },
  };
}

/**
 * Start a fight on the current floor.
 *
 * The Director says *that* a fight breaks out; depth decides *what* shows up,
 * because the difficulty curve is the whole progression and cannot be
 * re-invented per encounter by a model.
 */
export function beginEncounter(state: PlayState): PlayState {
  if (state.combat && !state.combat.over) return state;

  const region = activeRegion(state.world);
  const danger = region?.danger ?? 0;
  const grid = arenaFor(state.world.seed + state.world.turn, danger);

  const foes = buildEncounter({
    danger,
    kind: kindForFloor(danger),
    names: region?.creatures,
    grid,
    origin: { x: ARENA_SIZE - 2, y: Math.floor(ARENA_SIZE / 2) },
  });

  const rng = combatRng(state);
  let combat = startCombat(rng, [playerCombatant(state), ...foes], grid);

  // If something faster went first, let it act. Otherwise the fight opens with
  // nobody able to move and the player waiting on a turn that is not theirs.
  let guard = 0;
  while (!combat.over && currentActor(combat)?.side !== 'party' && guard++ < 64) {
    combat = autoTurn(rng, { ...combat });
  }

  return { ...state, combat };
}

/* -------------------------------------------------------------------------- */
/* What the player may do                                                      */
/* -------------------------------------------------------------------------- */

export type CombatAction =
  | { kind: 'attack'; target: string; attack: string }
  | { kind: 'move'; to: Vec }
  /** An active skill. `target` only when the skill needs one. */
  | { kind: 'skill'; skill: string; target?: string }
  | { kind: 'end' };

export type CombatOption = { action: CombatAction; label: string };

/** Legal moves only — the same invariant the engine's option lists already hold. */
export function combatOptions(state: PlayState): CombatOption[] {
  const combat = state.combat;
  if (!combat || combat.over) return [];
  const actor = currentActor(combat);
  if (!actor || actor.side !== 'party') return [];

  const options: CombatOption[] = [];

  for (const weapon of actor.attacks) {
    for (const target of attackOptions(combat, weapon.id)) {
      if (target.side === actor.side) continue;
      options.push({
        action: { kind: 'attack', target: target.id, attack: weapon.id },
        label: `${weapon.name} → ${target.name} (${target.hp}/${target.maxHp})`,
      });
    }
  }

  /*
   * Actives, and what they cost. A skill you cannot pay for is not offered
   * rather than offered and refused — the option lists in this game have
   * always been legal moves only.
   *
   * The label carries the price, not a remaining count. With a shared pool the
   * interesting number is what this will take out of you, because that is what
   * you are weighing it against the other skills for.
   */
  const me = state.combat?.combatants['pc'];
  for (const skill of activeSkills(state.sheet)) {
    if (!isCombatUsable(skill)) continue;
    if (me && !canAfford(me, skill)) continue;
    const { pool, cost } = priceOfUse(skill);
    const left = `${cost} ${pool}`;

    if (!needsTarget(skill)) {
      options.push({ action: { kind: 'skill', skill: skill.id }, label: `${skill.name} (${left})` });
      continue;
    }
    // A skill reaches as far as the SKILL says, not as far as whatever happens
    // to be in your hand. Using the weapon's range meant a reach-1 skill was
    // silently unusable to anyone carrying a sling, and unusable to everyone at
    // the start of a fight, when nothing is adjacent yet.
    for (const target of skillTargets(combat, actor, skill.range)) {
      options.push({
        action: { kind: 'skill', skill: skill.id, target: target.id },
        label: `${skill.name} → ${target.name} (${left} left)`,
      });
    }
  }

  for (const cell of movementOptions(combat)) {
    options.push({ action: { kind: 'move', to: cell }, label: `move to ${cell.x},${cell.y}` });
  }

  options.push({ action: { kind: 'end' }, label: 'end turn' });
  return options;
}

/** Everything a skill of this reach could be used on. */
function skillTargets(combat: CombatState, actor: Combatant, range: number): Combatant[] {
  return Object.values(combat.combatants).filter(
    (t) =>
      !t.dead
      && t.id !== actor.id
      && t.side !== actor.side
      && distance(actor.pos, t.pos) <= Math.max(1, range)
      && hasLineOfSight(combat.grid, actor.pos, t.pos),
  );
}

/** Is it the player's move? */
export const awaitingPlayer = (state: PlayState): boolean => {
  const combat = state.combat;
  if (!combat || combat.over) return false;
  return currentActor(combat)?.side === 'party';
};

/* -------------------------------------------------------------------------- */
/* Taking a turn                                                               */
/* -------------------------------------------------------------------------- */

export type CombatStep = {
  state: PlayState;
  /** Everything that happened since the player last acted. */
  events: CombatEvent[];
  error: string | null;
};

/**
 * Apply the player's action, then let everyone else act until it is their move
 * again (or the fight ends). One call per player decision, however many foes
 * are on the board.
 */

/**
 * Bring off a wind-up that has finished waiting.
 *
 * Called at the top of the player's move rather than inside `combat.ts`,
 * because resolving one needs the SHEET — the skill lives on the character,
 * and the combat engine has no idea what a character knows. The alternative
 * was pushing skills down into the engine, which would put the whole
 * progression system inside the tactical layer.
 *
 * A cast whose target has died or vanished simply resolves on nothing: it was
 * paid for and it was held, and the tower does not owe you a second chance at
 * aiming it.
 */
function settleCast(state: PlayState, combat: CombatState): CombatState {
  const me = combat.combatants['pc'];
  const cast = me?.pendingCast;
  if (!cast || cast.done < cast.total) return combat;

  const skill = activeSkills(state.sheet).find((s) => s.id === cast.skillId);
  const cleared = finishCast(me);
  if (!skill) return { ...combat, combatants: { ...combat.combatants, pc: cleared } };

  const aim = cast.targetId ? (combat.combatants as Record<string, Combatant>)[cast.targetId] : null;
  const spread = radiusOf(skill);
  const targets = aim && !aim.dead
    ? spread > 0
      ? Object.values(combat.combatants).filter(
          (c) => !c.dead && c.side !== cleared.side && distance(aim.pos, c.pos) <= spread,
        )
      : [aim]
    : [];

  // The pool was charged when it was declared, so nothing is spent here.
  const outcome = resolveSkill(skill, cleared, targets);
  const combatants: Record<string, Combatant> = { ...combat.combatants, pc: outcome.actor };
  for (const hit of outcome.affected) combatants[hit.id] = hit;
  return { ...combat, combatants };
}

export function takeCombatAction(state: PlayState, action: CombatAction): CombatStep {
  const combat = state.combat;
  if (!combat || combat.over) return { state, events: [], error: 'no fight is happening' };
  if (!awaitingPlayer(state)) return { state, events: [], error: 'it is not your move' };

  const before = combat.log.length;
  let next: CombatState = settleCast(state, combat);
  let error: string | null = null;
  let spent = state.pc.skillUses;

  const rng = combatRng(state);
  if (action.kind === 'attack') {
    const result = attack(rng, next, action.target, action.attack);
    error = result.error;
    next = result.state;
    if (!error) next = endTurn(rng, next).state;
  } else if (action.kind === 'move') {
    const result = moveTo(next, action.to);
    error = result.error;
    next = result.state;
  } else if (action.kind === 'skill') {
    const skill = activeSkills(state.sheet).find((s) => s.id === action.skill);
    if (!skill) error = 'you do not know that';
    else if (!isCombatUsable(skill)) error = `${skill.name} is not something you use in a fight`;
    else if (!canAct(next.combatants['pc'])) error = 'no time left this round';
    else if (!canAfford(next.combatants['pc'], skill)) error = `you do not have the ${priceOfUse(skill).pool} for ${skill.name}`;
    else {
      const self = next.combatants['pc'];
      const aim = action.target ? next.combatants[action.target] : null;

      if (needsTarget(skill) && !aim) error = `${skill.name} needs a target`;
      else {
        // A burst catches everything standing near whoever it lands on, so the
        // target list is built from the board rather than from the action.
        const spread = radiusOf(skill);
        const targets = aim
          ? spread > 0
            ? Object.values(next.combatants).filter(
                (c) => !c.dead && c.side !== self.side && distance(aim.pos, c.pos) <= spread,
              )
            : [aim]
          : [];

        /*
         * Paid for twice over, out of two different budgets: the POOL the
         * skill's stat names, and the TICKS bringing it off takes.
         *
         * DEX shortens the ticks, which is that stat's third distinct job and
         * the only reading of "reduces casting time" that means anything in an
         * engine where a turn is a turn.
         */
        const { pool, cost } = priceOfUse(skill);
        const needs = castTicks(self, costOf(skill.effect));

        if (needs > self.ticks) {
          /*
           * TOO BIG TO BRING OFF THIS ROUND, so it becomes a wind-up: declared
           * now, paid for now, fed by the rounds that follow, and breakable
           * the whole time.
           *
           * Whether something telegraphs is therefore a BUILD decision and not
           * a property of the skill — the same effect is instant for a deft
           * caster and a two-round commitment for a slow one.
           */
          const charged = spend(self, skill);
          const started = advanceCast(beginCast(charged, skill.id, aim?.id ?? null, needs, cost, pool), charged.ticks);
          next = endTurn(rng, {
            ...next,
            combatants: { ...next.combatants, pc: spendTicks(started.who, charged.ticks) },
          }).state;
        } else {
        const outcome = resolveSkill(skill, self, targets);
        const paid = spendTicks(spend(outcome.actor, skill), needs);
        const combatants: typeof next.combatants = { ...next.combatants, pc: paid };
        for (const hit of outcome.affected) combatants[hit.id] = hit;

        /*
         * And the turn ends only when the budget is GONE, not because a skill
         * was used. Attacking set a flag and left your movement alone while
         * using a skill called `endTurn` outright — nobody decided that, it is
         * just how the two paths came to be written, and it quietly cost you
         * your movement every time you used a skill.
         */
        next = { ...next, combatants };
        if (!canAct(paid)) next = endTurn(rng, next).state;
        }
      }
    }
  } else {
    next = endTurn(rng, next).state;
  }

  if (error) return { state, events: [], error };

  // Everyone else acts. Bounded so a board of stalled combatants cannot spin.
  let guard = 0;
  while (!next.over && currentActor(next)?.side !== 'party' && guard++ < 64) {
    next = autoTurn(rng, { ...next });
  }

  return {
    state: { ...state, combat: next, pc: { ...state.pc, skillUses: spent } },
    events: next.log.slice(before),
    error: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Folding the result back into the world                                      */
/* -------------------------------------------------------------------------- */

export type CombatOutcome = {
  state: PlayState;
  victor: 'party' | 'foe' | 'draw' | null;
  /** Named foes put down, for the tallies traits will read. */
  killed: string[];
  /** What the fight yielded, so the UI can say so. */
  loot: Drop[];
  coin: number;
  xp: number;
  levelled: LevelUp | null;
};

/**
 * End the fight and carry its consequences out into the world.
 *
 * Wounds persist, kills are counted, and the fight itself is discarded — a
 * finished encounter is not state, it is something that happened.
 */
export function concludeCombat(state: PlayState): CombatOutcome {
  const combat = state.combat;
  if (!combat) return { state, victor: null, killed: [], loot: [], coin: 0, xp: 0, levelled: null };

  const pc = combat.combatants['pc'];
  const killed = Object.values(combat.combatants)
    .filter((c) => c.side === 'foe' && c.dead)
    .map((c) => c.name);

  let counters = state.sheet.counters;
  for (const _ of killed) counters = bumpCounter(counters, COUNTERS.kills);
  if (combat.victor === 'party') counters = bumpCounter(counters, COUNTERS.fightsWon);
  if (combat.victor === 'foe') counters = bumpCounter(counters, COUNTERS.fightsLost);

  const floor = activeRegion(state.world)?.floor ?? 0;
  let sheet = { ...state.sheet, counters };
  let inventory = state.pc.inventory;
  let coin = state.pc.coin;
  let loot: Drop[] = [];
  let xp = 0;
  let levelled: LevelUp | null = null;

  // Only winning pays. Everything below is deterministic in the state, so a
  // replayed log produces the same pack and the same level rather than a
  // differently lucky one.
  if (combat.victor === 'party') {
    const rng = combatRng(state);
    xp = xpForFight(floor, sheet.level, killed.length);
    const granted = grantXp(sheet, xp);
    sheet = granted.sheet;
    levelled = granted.levelled;

    loot = rollLoot(rng, floor);
    for (const drop of loot) inventory = addItem(inventory, drop.item, drop.count);
    coin += rollCoin(rng, floor);
  }

  // A level gained raises the ceiling without healing the wound you took
  // getting there.
  const previousMax = state.pc.maxHp;
  const grown = hpAfterGrowth(sheet, inventory, pc ? Math.max(0, pc.hp) : state.pc.hp, previousMax);

  return {
    state: {
      ...state,
      combat: null,
      sheet,
      pc: {
        ...state.pc,
        hp: combat.victor === 'foe' ? 0 : grown.hp,
        maxHp: grown.maxHp,
        // And carried back out, or the fight would cost nothing to walk away
        // from. Rest is the only thing that refills them.
        stamina: pc?.stamina ?? state.pc.stamina,
        mana: pc?.mana ?? state.pc.mana,
        conditions: pc?.conditions ?? state.pc.conditions,
        inventory,
        coin,
      },
      // Losing is not an instant death: you go down, and the run is over.
      ended: combat.victor === 'foe' ? { reason: 'defeated' } : state.ended,
    },
    victor: combat.victor,
    killed,
    loot,
    coin: coin - state.pc.coin,
    xp,
    levelled,
  };
}

/* -------------------------------------------------------------------------- */
/* What is worth narrating                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The moments a reader cares about.
 *
 * Narrating every swing is both expensive and dull; a fight reads better as its
 * turning points. Misses and ordinary hits are left to the numbers.
 */
export function notableEvents(events: CombatEvent[]): string[] {
  const notable: string[] = [];

  for (const event of events) {
    if (event.kind === 'attack') {
      if (event.killedTarget) notable.push(`${event.attacker} kills ${event.target}`);
      else if (event.droppedTarget) notable.push(`${event.target} goes down`);
      else if (event.critical) notable.push(`${event.attacker} lands a devastating ${event.attackName} on ${event.target}`);
      else if (event.hit && event.targetHpAfter <= event.targetHpBefore / 4) {
        notable.push(`${event.target} is barely standing`);
      }
    } else if (event.kind === 'deathSave' && event.died) {
      notable.push(`${event.actor} stops moving`);
    } else if (event.kind === 'deathSave' && event.outcome === 'criticalSuccess') {
      notable.push(`${event.actor} drags themselves back up`);
    } else if (event.kind === 'combatEnd') {
      notable.push(event.victor === 'party' ? 'the fight is over and you are standing' : 'the fight is lost');
    }
  }

  return notable;
}
