import { autoTurn } from '../combat/ai.ts';
import { attack, attackOptions, currentActor, endTurn, movementOptions, moveTo, settle, startCombat } from '../combat/combat.ts';
import { buildEncounter, composition, freeCellsNear, kindForFloor } from '../combat/encounter.ts';
import { scaleFoe, withTemplate } from '../combat/statblock.ts';
import type { FoeRole } from '../combat/statblock.ts';
import { bossMember, crowdFighter, crowdMember } from '../character/crowd.ts';
import type { Member, Rank } from '../character/crowd.ts';
import type { Inventory } from '../items/types.ts';
import type { CharacterSheet } from '../session/sheet.ts';
import { cellKey, distance, hasLineOfSight } from '../combat/grid.ts';
import type { CombatEvent, CombatState, Combatant, Grid, Vec } from '../combat/types.ts';
import { bumpCounter, dispositionOf, metNeeds, neutralTemperament } from '../character/persona.ts';
import { repairVoice } from '../session/repair.ts';
import type { Persona } from '../character/persona.ts';
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
import { canAfford, priceOfUse, spend } from '../skills/pools.ts';
import { forbids, rulesOf } from '../rules/ruleset.ts';
import { wearEquipped } from '../items/types.ts';
import { canAct, castTicks, spendTicks } from '../combat/tempo.ts';
import { advanceCast, beginCast, finishCast } from '../combat/cast.ts';
import { activeRegion } from '../world/travel.ts';
import type { PlayState } from './state.ts';
import { playerSubject } from './signetbook.ts';
import { stratumAt } from '../world/strata.ts';
import { FOLK, groupOf, leavesUnder, needScale, readSpecies, speciesIdFor } from '../character/species.ts';
import { axisOf, hostileToward, nudge, PLAYER } from '../social/edge.ts';
import type { Person, Region } from '../world/types.ts';
import { arrivedHere, journeysOf } from './journey.ts';
import { preyOf } from '../character/prey.ts';
import { groupsAt, packAt } from '../character/habitat.ts';
import { populationAt, PROFESSIONS, sizeIn, thinPopulation } from '../character/population.ts';
import type { Profession } from '../character/population.ts';
import type { Grown } from '../character/species.ts';

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
  // WITH what they carry. Without the inventory here, no found weapon, coat,
  // refine or rarity ever reached a fight: the sheet said one AC and the fight
  // used another, and the blade in hand was never the one swung.
  const base = toCombatant(state.sheet, 'pc', state.pc.inventory);
  // What kind of thing they are, and what they hunt: a climber is somebody's prey
  // and somebody's predator like everything else alive.
  const kinds = state.world.species ?? [];
  const group = state.sheet.species ? groupOf(kinds, state.sheet.species) : undefined;

  return {
    ...base,
    ...(group ? { group, ...(preyOf(state.world.seed, kinds, group) ? { hunts: preyOf(state.world.seed, kinds, group)! } : {}) } : {}),
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
 * What kind of thing a creature is — one of the kinds this world holds.
 *
 * A floor's foes come from a group that LIVES at that depth (`habitat.ts`), and
 * all of them from the same one — a pack is one population, not an assortment.
 * Which lineage of it a given creature is stays keyed on the NAME, so a
 * shadow-wolf is the same lineage every time the model says it, and everything is
 * seeded, so a replay draws exactly the same creatures.
 *
 * A world with no species list at all is folk, as `speciesIdFor` already treats it.
 */
export function foeSpecies(world: PlayState['world'], name: string, floor = 0): Grown {
  const kinds = world.species ?? [];
  if (kinds.length === 0) return readSpecies(world.seed, FOLK);

  /*
   * A PACK IS ONE GROUP. The group is chosen from the ones that live at this
   * depth and from the floor alone, so every creature in the encounter — and
   * every encounter on that floor — comes from the same population. Which of its
   * lineages a given creature is stays keyed on the NAME, so a shadow-wolf is the
   * same lineage each time the model says it.
   */
  const groups = groupsAt(world.seed, kinds, floor);
  const pack = groups[Math.floor(mulberry32((world.seed ^ 0xf100 ^ (floor * 31)) >>> 0)() * groups.length)];
  const leaves = leavesUnder(kinds, pack?.id ?? '');
  const from = leaves.length > 0 ? leaves : kinds;

  let hash = (world.seed ^ 0x3c6e) >>> 0;
  for (const ch of name) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) >>> 0;
  return readSpecies(world.seed, from[Math.floor(mulberry32(hash)() * from.length)]);
}

/**
 * The foes, as CHARACTERS out of the floor's population.
 *
 * There are no mass foes any more: every one of these has a lineage, a trade, a
 * standing, a sheet and gear on its body — which is what makes loot come off the
 * thing you beat rather than off the floor's table. Their hit points are pinned to
 * the statblock role each rank replaces (`crowd.ts`), so the curve this was all
 * balanced against does not move.
 *
 * A world with no species tree — one stored before it existed — still gets
 * statblock foes, because inventing a population for it would be inventing the
 * bodies of creatures somebody is already fighting.
 */
function crowdFoes(
  state: PlayState,
  danger: number,
  floor: number,
  grid: Grid,
  origin: Vec,
  taken: Set<string>,
): Combatant[] | null {
  const kinds = state.world.species ?? [];
  const region = activeRegion(state.world);
  const cohorts = populationAt(state.world, state.world.currentRegion, state.world.currentPlace, floor);
  // `null` is a world that holds no kinds, and falls back to statblocks. An
  // EMPTY population is a different answer — this place has been cleared out —
  // and the two must not collapse, or thinning a place to nothing would quietly
  // summon back the statblock foes the population replaced.

  /*
   * SOMEBODY WITH A GRUDGE, arrived. Alone and in place of the crowd, as a
   * holder is, so the fight stays on one anchor — elite: notable, not a boss.
   * `beginEncounter` has already written the sheet they fight with. Before the
   * crowd check, because a traveller is not one of this place's crowd.
   */
  const comer = comingFor(state);
  if (comer?.sheet) {
    const who = memberOf(state.world, comer);
    const { inventory } = crowdFighter(state.world.seed, kinds, who, danger, comer.id);
    const [cell] = freeCellsNear(grid, origin, taken, 1);
    return [{ ...asFoe(comer.sheet, inventory, who, 'elite', 0, cell ?? origin, comer), name: comer.name, person: comer.id }];
  }

  if (!cohorts) return null;

  const names = region?.creatures ?? [];

  /*
   * A LANDMARK FLOOR'S HOLDER, while they live. The floor made a person to hold
   * it (`floorgen.ts`), so the fight is against THEM — alone, whatever the crowd
   * here looks like, because they were never one of it. Once they are dead the
   * floor is an ordinary one: its fights are the crowd's.
   */
  const holder = region?.boss ? state.world.people[region.boss] : undefined;
  if (holder?.alive && holder.sheet) {
    const who = { ...bossMember(state.world.seed, kinds, floor)!, subspecies: holder.sheet.species! };
    const { inventory } = crowdFighter(state.world.seed, kinds, who, danger, holder.id);
    const [cell] = freeCellsNear(grid, origin, taken, 1);
    return [{ ...asFoe(holder.sheet, inventory, who, 'boss', 0, cell ?? origin, holder), name: holder.name, person: holder.id }];
  }


  /*
   * NO MORE BODIES THAN LIVE HERE. This is the cap that makes the population
   * bite: the composition says what the depth is worth, and the crowd says how
   * much of it is actually available. A cleared place fields nobody at all.
   */
  const roles = composition(danger, holder ? 'skirmish' : kindForFloor(floor)).slice(0, sizeIn(cohorts));
  const cells = freeCellsNear(grid, origin, taken, roles.length);

  return roles.map((role, i) => {
    const rank = RANK_OF[role];
    const drawn = crowdMember(state.world.seed, cohorts, floor, i)!;
    const who = { ...drawn, rank };
    const { sheet, inventory } = crowdFighter(state.world.seed, kinds, who, danger, `${state.world.currentPlace}:${i}`);
    return {
      ...asFoe(sheet, inventory, who, role, i, cells[i] ?? origin),
      /*
       * THE WORD AND THE BODY AGREE. `Region.creatures` are words the model
       * invented, and naming a foe `names[i % names.length]` meant a floor of
       * undead could be handed a wolf's name — the word said one thing and the
       * sheet another. So the name follows the body: whichever creature word
       * maps to THIS lineage (`foeSpecies` keys a lineage on the name) is what
       * it is called, and a lineage no word covers wears its own, since the
       * engine invents no words.
       */
      name: nameFor(state.world, names, who.subspecies, floor) ?? `${who.rank} ${who.subspecies}`,
    };
  });

  function asFoe(
    sheet: CharacterSheet, inventory: Inventory, who: Member, role: FoeRole, i: number, pos: Vec,
    /** Whose nerve it fights with: the person, when it is somebody. */
    mind: Pick<Persona, 'temperament' | 'needs'> = sheet,
  ): Combatant {
    const group = groupOf(kinds, who.subspecies);
    const hunts = group ? preyOf(state.world.seed, kinds, group) : undefined;

    /*
     * ITS FIGHT NUMBERS ARE THE ANCHORED ONES, and this is not a shortcut.
     *
     * Built from the sheet, every number came from the character: hit points from
     * level and `vit`, damage from a catalogue weapon and refine, AC from worn
     * armour and `agi`, proficiency from level. Measured, that made a danger-1
     * fight fall from 95% to 53% — the curve every floor was balanced against,
     * moved by a change that was supposed to leave it alone.
     *
     * So `scaleFoe` still decides what it is like to FIGHT: hit points, AC,
     * proficiency, the attack it swings, and its abilities PLUS its kind's
     * template. The character decides everything else — what kind of thing it
     * is, what it hunts, what it knows, and what is on its body to take.
     * Re-deriving the curve from sheets is DESIGN 6b stage 3o, deferred until a
     * climber can recruit companions.
     */
    const stats = scaleFoe(danger, role);
    const built = toCombatant(sheet, `foe${i + 1}`, inventory);
    const breaksAt = breakPoint(stats.hp, dispositionOf(mind).nerve, needScale(kinds.find((k) => k.id === who.subspecies), 'safety'));

    return {
      ...built,
      side: 'foe' as const,
      hp: stats.hp,
      maxHp: stats.hp,
      ac: stats.ac,
      proficiency: stats.proficiency,
      // Abilities too: `attackBonus` and the damage bonus both read them, so a
      // brute's +3 str was worth 20 points of the player's win rate on its own.
      // Its KIND is the one delta that goes back on: a template sums to zero, so
      // the curve holds, and what you meet is still a kind of thing.
      abilities: withTemplate(stats.abilities, sheet.speciesTemplate),
      attacks: [stats.attack],
      speed: stats.speed,
      pos,
      kind: who.subspecies,
      trade: who.profession,
      ...(group ? { group } : {}),
      ...(hunts ? { hunts } : {}),
      ...(breaksAt > 0 ? { breaksAt } : {}),
    };
  }
}

/** The floor's own word for this lineage, if it has one. */
function nameFor(
  world: PlayState['world'],
  names: readonly string[],
  subspecies: string,
  floor: number,
): string | undefined {
  return names.find((name) => foeSpecies(world, name, floor).id === subspecies);
}

/**
 * Who fights you because of a grudge, if anybody (DESIGN 6b stages 5 and 7.1b).
 *
 * Stage 5 dropped any hostile person into your next fight. Since 7.1b a grudge
 * TRAVELS (`journey.ts`), and only somebody who has ARRIVED where you stand, on a
 * grudge that is still hostile, fights. The law is read on the road, not here.
 * One at a time: the most resentful bearer first, then by id. A landmark's
 * living holder goes first, and an arrived grudge waits for them.
 */
function comingFor(state: PlayState): Person | null {
  const { world } = state;
  if ((world.species ?? []).length === 0) return null;

  const region = activeRegion(world);
  const holder = region?.boss ? world.people[region.boss] : undefined;
  if (holder?.alive && holder.sheet) return null;

  const resentment = (id: string) => axisOf(world.edges, id, PLAYER, 'resentment');
  const [first] = arrivedHere(world)
    .filter((j) => world.people[j.who]?.alive && world.people[j.for]?.alive && hostileToward(world.edges, j.for))
    .sort((a, b) => resentment(b.for) - resentment(a.for) || a.who.localeCompare(b.who));
  return first ? world.people[first.who] : null;
}

/** Whether somebody who has travelled here opens a fight this turn (7.1b). */
export const arrivalOpens = (state: PlayState): boolean =>
  !fightOpen(state) && (activeRegion(state.world)?.danger ?? 0) > 0 && comingFor(state) !== null;

/**
 * A person, as somebody who fights: their kind, a trade drawn from the seed and
 * their id, at the top of a crowd's standing.
 *
 * `ponytail: the trade is seeded, not chosen — a smith can come at you as a
 * raider. Give people a trade when one reads wrong in play.`
 */
function memberOf(world: PlayState['world'], person: Person): Member {
  let hash = (world.seed ^ 0x5eed) >>> 0;
  for (const ch of person.id) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) >>> 0;
  return {
    subspecies: person.sheet?.species ?? person.species ?? speciesIdFor(world.seed, person.id, world.species ?? []),
    profession: PROFESSIONS[Math.floor(mulberry32(hash)() * PROFESSIONS.length)],
    rank: 'veteran',
  };
}

/**
 * `Person.sheet`'s other writer: whoever comes for you gets a sheet the first
 * time they fight, built at that fight's danger and kept, because a person
 * persists. Deterministic in stored state, so a replay writes the same one.
 */
function armComer(state: PlayState, danger: number): PlayState {
  const comer = comingFor(state);
  if (!comer || comer.sheet) return state;

  const { sheet } = crowdFighter(state.world.seed, state.world.species ?? [], memberOf(state.world, comer), danger, comer.id);
  const people = { ...state.world.people, [comer.id]: { ...comer, sheet: { ...sheet, name: comer.name } } };
  return { ...state, world: { ...state.world, people } };
}

/**
 * The hit points at or under which a foe breaks (DESIGN 6b stage 6).
 *
 * A quarter of its maximum at nerve 0, and nerve moves the line: at +3 there is
 * none — a fearless thing never breaks — and at −3 it is half. A kind with no
 * safety need has nothing to fear losing and never breaks at all. Zero means
 * never, because a foe only breaks while it is still standing.
 */
export const breakPoint = (maxHp: number, nerve: number, safety: number): number =>
  safety === 0 ? 0 : Math.max(0, Math.floor((maxHp * (3 - nerve)) / 12));

/** A statblock role, as a standing in a crowd. */
const RANK_OF: Record<FoeRole, Rank> = { minion: 'whelp', regular: 'ordinary', elite: 'veteran', boss: 'veteran' };

/**
 * Start a fight on the current floor.
 *
 * The Director says *that* a fight breaks out; depth decides *what* shows up,
 * because the difficulty curve is the whole progression and cannot be
 * re-invented per encounter by a model.
 */
export function beginEncounter(before: PlayState, startedBy?: 'player' | 'them'): PlayState {
  if (before.combat && !before.combat.over) return before;

  const region = activeRegion(before.world);
  const state = armComer(before, region?.danger ?? 0);
  const danger = region?.danger ?? 0;
  const grid = arenaFor(state.world.seed + state.world.turn, danger);
  const me = playerCombatant(state);
  const ambushed = startedBy === 'them';

  /*
   * Being jumped means they are already on you. Going first across the open arena
   * only spent the turn closing the gap, which handed the PLAYER the first swing —
   * an ambush measured as raising your odds.
   */
  const origin = ambushed ? { x: me.pos.x + 1, y: me.pos.y } : { x: ARENA_SIZE - 2, y: Math.floor(ARENA_SIZE / 2) };
  const taken = new Set([cellKey(me.pos)]);
  const asCharacters = crowdFoes(state, danger, region?.floor ?? 0, grid, origin, taken);
  // Nobody lives here any more, so nobody attacks: the one visible end of
  // thinning a place, and deterministic in stored state, so a replay agrees.
  if (asCharacters && asCharacters.length === 0) return before;

  const foes = asCharacters ?? buildEncounter({
    danger,
    // A landmark is a DEPTH, not a danger level: the two part ways in any world
    // whose curve is not the identity, and a stratum can set its own.
    kind: kindForFloor(region?.floor ?? 0),
    names: region?.creatures,
    grid,
    origin,
    taken,
    templateOf: (name) => foeSpecies(state.world, name, region?.floor ?? 0).template,
    // And what it IS, so a hunter brings its appetite into the fight.
    kindOf: (name) => {
      const kinds = state.world.species ?? [];
      const group = groupOf(kinds, foeSpecies(state.world, name, region?.floor ?? 0).id);
      return group ? { group, hunts: preyOf(state.world.seed, kinds, group) } : {};
    },
  });

  const rng = combatRng(state);
  // Striking first earns nothing extra yet — only being jumped moves the order.
  let combat = startCombat(rng, [me, ...foes], grid, ambushed ? 'foe' : undefined);

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
  | { kind: 'end' }
  /** A yielded foe's fate, once the fight is won. */
  | { kind: 'spare'; target: string }
  | { kind: 'kill'; target: string };

export type CombatOption = { action: CombatAction; label: string };

/** Foes who yielded to a party that won, and have not yet been told what happens to them. */
function awaitingFate(combat: CombatState): Combatant[] {
  if (!combat.over || combat.victor !== 'party') return [];
  return Object.values(combat.broken ?? {}).filter((b) => b.as === 'yielded' && !b.fate).map((b) => b.who);
}

/**
 * Whether a fight still needs the player: it is going on, or it is won and
 * somebody who yielded is waiting on their fate. What the server holds a fight
 * open on, so a yielded foe cannot be concluded past.
 */
export const fightOpen = (state: PlayState): boolean =>
  Boolean(state.combat) && (!state.combat!.over || awaitingFate(state.combat!).length > 0);

/** Legal moves only — the same invariant the engine's option lists already hold. */
export function combatOptions(state: PlayState): CombatOption[] {
  const combat = state.combat;
  if (!combat) return [];
  // Won, and somebody yielded: what happens to them is the only thing left to decide.
  if (combat.over) {
    return awaitingFate(combat).flatMap((who): CombatOption[] => [
      { action: { kind: 'kill', target: who.id }, label: `kill ${who.name}` },
      { action: { kind: 'spare', target: who.id }, label: `spare ${who.name}` },
    ]);
  }
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
    if (me && !canAfford(me, skill, state.sheet)) continue;
    const { pool, cost } = priceOfUse(skill, state.sheet, rulesOf(state.world));
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
  if (!combat) return false;
  if (combat.over) return awaitingFate(combat).length > 0;
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
  const outcome = resolveSkill(skill, cleared, targets, state.sheet, rulesOf(state.world));
  const combatants: Record<string, Combatant> = { ...combat.combatants, pc: outcome.actor };
  for (const hit of outcome.affected) combatants[hit.id] = hit;
  return { ...combat, combatants };
}

/** Decide what happens to a foe who yielded. Nothing is rolled: it is the player's call. */
function decideFate(state: PlayState, action: { kind: 'spare' | 'kill'; target: string }): CombatStep {
  const combat = state.combat;
  const held = combat?.broken?.[action.target];
  if (!combat || !held || !awaitingFate(combat).some((w) => w.id === action.target)) {
    return { state, events: [], error: `${action.target} is not waiting on you` };
  }
  const fate = action.kind === 'kill' ? 'killed' : 'spared';
  const broken = { ...combat.broken, [action.target]: { ...held, fate } as const };
  return { state: { ...state, combat: { ...combat, broken } }, events: [], error: null };
}

export function takeCombatAction(state: PlayState, action: CombatAction): CombatStep {
  if (action.kind === 'spare' || action.kind === 'kill') return decideFate(state, action);
  const combat = state.combat;
  if (!combat || combat.over) return { state, events: [], error: 'no fight is happening' };
  if (!awaitingPlayer(state)) return { state, events: [], error: 'it is not your move' };

  const before = combat.log.length;
  let next: CombatState = settleCast(state, combat);
  let error: string | null = null;

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
    else if (!canAfford(next.combatants['pc'], skill, state.sheet)) error = `you do not have the ${priceOfUse(skill, state.sheet).pool} for ${skill.name}`;
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
        const { pool, cost } = priceOfUse(skill, state.sheet, rulesOf(state.world));
        const needs = castTicks(self, cost, rulesOf(state.world));

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
          const charged = spend(self, skill, state.sheet);
          const started = advanceCast(beginCast(charged, skill.id, aim?.id ?? null, needs, cost, pool), charged.ticks);
          next = endTurn(rng, {
            ...next,
            combatants: { ...next.combatants, pc: spendTicks(started.who, charged.ticks) },
          }).state;
        } else {
        const outcome = resolveSkill(skill, self, targets, state.sheet, rulesOf(state.world));
        const paid = spendTicks(spend(outcome.actor, skill, state.sheet), needs);
        const combatants: typeof next.combatants = { ...next.combatants, pc: paid };
        for (const hit of outcome.affected) combatants[hit.id] = hit;

        /*
         * And the turn ends only when the budget is GONE, not because a skill
         * was used. Attacking set a flag and left your movement alone while
         * using a skill called `endTurn` outright — nobody decided that, it is
         * just how the two paths came to be written, and it quietly cost you
         * your movement every time you used a skill.
         */
        next = settle({ ...next, combatants });
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
    state: { ...state, combat: next },
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
  /** Foes who yielded and were let go — the people among them by id, for the deed. */
  spared: { name: string; person?: string }[];
  fled: string[];
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
  if (!combat) return { state, victor: null, killed: [], spared: [], fled: [], loot: [], coin: 0, xp: 0, levelled: null };

  const pc = combat.combatants['pc'];
  /*
   * DEFEAT IS NOT DEATH (6b stage 6). Who broke is off the board: a yielded foe
   * the player chose to kill is killed like any other, one they spared lives, and
   * one that fled or was never decided on simply got away.
   */
  const broke = Object.values(combat.broken ?? {});
  const executed = broke.filter((b) => b.fate === 'killed').map((b) => b.who);
  const fallen = [...Object.values(combat.combatants).filter((c) => c.side === 'foe' && c.dead), ...executed];
  const killed = fallen.map((c) => c.name);

  /*
   * THE PLACE IS THINNER FOR IT.
   *
   * The reader that stops a crowd being a simulation nothing touches: what you
   * kill is gone from the population it came out of, so clearing the wolves off
   * a place means meeting fewer of them there and eventually none. Matched on
   * the cohort each body carries (`kind`, `trade`) rather than re-derived, and
   * counted whoever won — a foe that died died even if you lost.
   */
  const populations = thinPopulation(
    state.world,
    state.world.currentRegion,
    state.world.currentPlace,
    activeRegion(state.world)?.floor ?? 0,
    // A PERSON is not thinned out of a crowd they were never drawn from.
    fallen.flatMap((c) => (c.kind && c.trade && !c.person ? [{ subspecies: c.kind, profession: c.trade as never }] : [])),
  );

  /*
   * And a person you killed is DEAD. The first writer `Person.alive = false` has
   * ever had: until a fight could be against somebody, nothing a fight did could
   * reach one. Only killing: a foe who fled or was spared is still alive, and
   * capture waits for step 9.
   */
  let people = state.world.people;
  for (const body of fallen) {
    if (body.person && people[body.person]) people = { ...people, [body.person]: { ...people[body.person], alive: false } };
  }

  /*
   * SURVIVORS WITH A FUTURE (6b stage 7). A foe that fled BADLY BEATEN — at or
   * under half its break line — or that was spared becomes somebody. Any other
   * survivor goes back into the crowd, which was never thinned for it. Not every
   * survivor, because `world.people` is never compressed and breaking is common.
   *
   * Fleeing leaves a grudge of exactly stage 5's threshold, so they come back:
   * that is how a crowd foe grows into a notable. They live where they broke, so
   * they witness this turn's deeds firsthand and the Director sees them there.
   * Their id is the region, the turn and the body, so a replay makes the same
   * person.
   */
  const here = activeRegion(state.world);
  let edges = state.world.edges;
  const madeHere: string[] = [];
  const became: Record<string, string> = {};
  for (const b of broke) {
    const beaten = b.as === 'fled' && b.who.hp <= (b.who.breaksAt ?? 0) / 2;
    if (!beaten && b.fate !== 'spared') continue;

    let who = b.who.person;
    if (!who) {
      if (!here || !b.who.kind || !b.who.trade) continue;
      who = `survivor:${here.id}:${state.world.turn}:${b.who.id}`;
      people = { ...people, [who]: survivorOf(state, here, b.who, who) };
      madeHere.push(who);
    }
    became[b.who.id] = who;
    if (beaten) edges = nudge(edges, who, PLAYER, 'resentment', FLED_GRUDGE + BEATEN_GRUDGE);
  }
  const regions = here && madeHere.length
    ? {
        ...state.world.regions,
        [here.id]: {
          ...here,
          places: here.places.map((p) => (p.id === state.world.currentPlace ? { ...p, people: [...p.people, ...madeHere] } : p)),
        },
      }
    : state.world.regions;

  // Whoever fled, by the person they now are — they recover before setting out.
  const fled = broke
    .filter((b) => b.as === 'fled')
    .flatMap((b) => {
      const person = became[b.who.id] ?? b.who.person;
      return person ? [person] : [];
    });

  // A journey that ended in this fight is over, whatever the outcome.
  const fought = new Set(
    [...Object.values(combat.combatants), ...broke.map((b) => b.who)].flatMap((c) => (c.person ? [c.person] : [])),
  );
  const journeys = journeysOf(state.world).filter((j) => !fought.has(j.who));

  // Whoever was spared, by the person they now are — so the deed lands on them.
  const spared = broke
    .filter((b) => b.fate === 'spared')
    .map((b) => {
      const person = became[b.who.id] ?? b.who.person;
      return { name: b.who.name, ...(person ? { person } : {}) };
    });

  let counters = state.sheet.counters;
  for (const _ of killed) counters = bumpCounter(counters, COUNTERS.kills);
  if (combat.victor === 'party') counters = bumpCounter(counters, COUNTERS.fightsWon);
  if (combat.victor === 'foe') counters = bumpCounter(counters, COUNTERS.fightsLost);

  const floor = activeRegion(state.world)?.floor ?? 0;
  let sheet = { ...state.sheet, counters };
  // Every fight takes something out of what you are wearing. Per fight rather
  // than per swing: the interesting decision is whether to press on with a
  // failing blade, and that is measured in encounters, not in blows.
  let inventory = wearEquipped(state.pc.inventory, rulesOf(state.world).gear.wearPerFight);
  let coin = state.pc.coin;
  let loot: Drop[] = [];
  let xp = 0;
  let levelled: LevelUp | null = null;

  // Only winning pays. Everything below is deterministic in the state, so a
  // replayed log produces the same pack and the same level rather than a
  // differently lucky one.
  if (combat.victor === 'party') {
    const rng = combatRng(state);
    // Every foe BEATEN pays, not only the dead — or breaking would cut what a win
    // is worth and push the player to kill.
    xp = xpForFight(floor, sheet.level, killed.length + broke.filter((b) => b.fate !== 'killed').length);
    const granted = grantXp(sheet, xp, forbids(state.world, playerSubject(state), 'gainLevels') === null);
    sheet = granted.sheet;
    levelled = granted.levelled;

    // What may be TAKEN is the world's law. Both rolls are skipped together
    // rather than rolled and discarded: a world under this law never draws
    // them, so its own replays stay identical to each other, which is all
    // determinism asks.
    if (forbids(state.world, playerSubject(state), 'takeLoot') === null) {
      // The structure decides what is worth finding here, not the depth alone.
      loot = rollLoot(rng, floor, stratumAt(state.world, floor)?.loot);
      for (const drop of loot) inventory = addItem(inventory, drop.item, drop.count);
      coin += rollCoin(rng, floor);
    }
  }

  // A level gained raises the ceiling without healing the wound you took
  // getting there.
  const previousMax = state.pc.maxHp;
  const grown = hpAfterGrowth(sheet, inventory, pc ? Math.max(0, pc.hp) : state.pc.hp, previousMax);

  return {
    state: {
      ...state,
      combat: null,
      world: {
        ...state.world,
        people,
        ...(populations ? { populations } : {}),
        ...(edges !== state.world.edges ? { edges } : {}),
        ...(regions !== state.world.regions ? { regions } : {}),
        ...(journeys.length !== journeysOf(state.world).length ? { journeys } : {}),
      },
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
    spared,
    fled,
    loot,
    coin: coin - state.pc.coin,
    xp,
    levelled,
  };
}

/** A grudge a survivor carries for fleeing, and for the beating that made it flee. */
const FLED_GRUDGE = 2;
const BEATEN_GRUDGE = 1;

/**
 * A survivor, as a person: the kind and trade it fought with, at a veteran's
 * standing, because what comes back is a notable.
 *
 * `ponytail: it keeps its kind's word for a name — nothing calls a model when a
 * fight ends. Name survivors when a later turn has a model call to carry it.`
 */
function survivorOf(state: PlayState, region: Region, body: Combatant, id: string): Person {
  const who: Member = { subspecies: body.kind!, profession: body.trade as Profession, rank: 'veteran' };
  const { sheet } = crowdFighter(state.world.seed, state.world.species ?? [], who, region.danger, id);
  return {
    id,
    name: body.name,
    homeRegion: region.id,
    oneLine: body.name,
    tags: [],
    species: body.kind,
    alive: true,
    lastSeenTurn: state.world.turn,
    status: 'peer',
    voice: repairVoice({ selfPronoun: '', underStress: '', addressBands: {}, particleBands: {}, tics: [] }).value,
    temperament: neutralTemperament(),
    needs: metNeeds(),
    counters: {},
    pressure: neutralTemperament(),
    sheet: { ...sheet, name: body.name },
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
    } else if (event.kind === 'broke') {
      notable.push(event.as === 'yielded' ? `${event.actor} yields` : `${event.actor} flees`);
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
