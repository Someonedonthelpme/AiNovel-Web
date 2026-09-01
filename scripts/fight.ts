/**
 * Play one fight through and print every part of it.
 *
 * `balance.ts` answers "is floor 8 winnable" across thousands of trials.
 * This answers "what actually happens in a fight" — the weapon that supplies
 * the attack, the encounter depth chose, the round loop, and what the win was
 * worth. It is the thing to reach for when a number looks wrong and you want
 * to watch it happen once rather than in aggregate.
 *
 * No model calls: combat is pure code, so this runs instantly and offline.
 *
 *   node --experimental-strip-types scripts/fight.ts [floor] [level]
 *
 * Two comparisons worth running, since they are the tuning decisions most
 * likely to drift:
 *
 *   scripts/fight.ts 6 1    a level 1 climber on floor 6 — should be lethal
 *   scripts/fight.ts 6 6    a fair fight
 *   scripts/fight.ts 2 6    the same character farming the shallows, which
 *                           should pay almost nothing
 */
import { mulberry32 } from '../src/engine/roll.ts';
import { addItem, equip, equippedAttack } from '../src/items/types.ts';
import { weapon } from '../src/items/catalogue.ts';
import {
  awaitingPlayer, beginEncounter, combatOptions, concludeCombat, takeCombatAction,
} from '../src/play/combat.ts';
import { playState } from '../src/play/fixtures.ts';
import { xpToNext } from '../src/play/progress.ts';
import type { PlayState } from '../src/play/state.ts';
import { derive } from '../src/session/sheet.ts';
import { groundFloor } from '../src/world/fixtures.ts';
import type { Region } from '../src/world/types.ts';

const floor = Number(process.argv[2] ?? 6);
const level = Number(process.argv[3] ?? 1);

if (!Number.isFinite(floor) || floor < 1 || !Number.isFinite(level) || level < 1) {
  console.error('usage: scripts/fight.ts [floor] [level]   (both positive integers)');
  process.exit(1);
}

/** A dangerous floor to stand on. Nothing hunts at ground level. */
function onFloor(depth: number): PlayState {
  const region: Region = {
    ...groundFloor(),
    id: `floor-${depth}`,
    floor: depth,
    danger: depth,
    name: 'The Grey Grove',
    creatures: ['หมาป่าเงา'],
  };
  const base = playState();
  return {
    ...base,
    world: {
      ...base.world,
      currentRegion: `floor-${depth}`,
      regions: { [`floor-${depth}`]: region },
      currentPlace: 'town',
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The character                                                               */
/* -------------------------------------------------------------------------- */

let state = onFloor(floor);
state = { ...state, sheet: { ...state.sheet, level } };

// Something found at this depth, wielded — the whole point being that the
// equipped item IS the attack the engine swings.
const found = weapon(mulberry32(9), floor);
state = {
  ...state,
  pc: { ...state.pc, inventory: equip(addItem(state.pc.inventory, found), found.id).inventory },
};

const derived = derive(state.sheet, state.pc.inventory);
state = { ...state, pc: { ...state.pc, hp: derived.maxHp, maxHp: derived.maxHp } };

const attack = equippedAttack(state.pc.inventory);

console.log('=== the character ===');
console.log(`  ${state.sheet.name}  level ${state.sheet.level}  hp ${state.pc.hp}/${derived.maxHp}  ac ${derived.ac}`);
console.log(
  attack
    ? `  wielding ${found.name} → ${attack.name}, ${attack.damage.count}d${attack.damage.sides}+${attack.damage.bonusAbility}, reach ${attack.range}`
    : '  wielding nothing',
);

/* -------------------------------------------------------------------------- */
/* The encounter                                                               */
/* -------------------------------------------------------------------------- */

let fight = beginEncounter(state);
const combat = fight.combat;
if (!combat) {
  console.error('no encounter was generated');
  process.exit(1);
}

const foes = Object.values(combat.combatants).filter((c) => c.side === 'foe');
console.log('\n=== the encounter ===');
console.log(`  floor ${floor}, danger ${floor} → ${foes.length} × ${foes[0].name} (${foes[0].hp}hp, ac ${foes[0].ac})`);
console.log(`  arena ${combat.grid.width}×${combat.grid.height}, ${combat.grid.walls.size} obstacles`);

/* -------------------------------------------------------------------------- */
/* The round loop                                                              */
/* -------------------------------------------------------------------------- */

console.log('\n=== rounds ===');

const before = { xp: state.sheet.xp ?? 0, level: state.sheet.level, coin: state.pc.coin };
let reported = 0;

// A blunt policy: swing when something is in reach, otherwise close. Enough to
// exercise the loop; the tuning question is what a fight COSTS, not whether a
// clever player could do better.
for (let guard = 0; guard < 300 && fight.combat && !fight.combat.over; guard++) {
  if (!awaitingPlayer(fight)) break;

  const options = combatOptions(fight);
  const chosen =
    options.find((o) => o.action.kind === 'attack')
    ?? options.find((o) => o.action.kind === 'move')
    ?? options[0];
  if (!chosen) break;

  const round = fight.combat.round;
  fight = takeCombatAction(fight, chosen.action).state;

  if (round !== reported) {
    reported = round;
    const me = fight.combat!.combatants['pc'];
    const standing = Object.values(fight.combat!.combatants).filter((c) => c.side === 'foe' && !c.dead);
    console.log(`  round ${round}: ${chosen.label}`);
    console.log(`      you ${me.hp}/${me.maxHp}   foes ${standing.map((f) => `${f.hp}/${f.maxHp}`).join(' ') || '—'}`);
  }
}

/* -------------------------------------------------------------------------- */
/* What it was worth                                                           */
/* -------------------------------------------------------------------------- */

const outcome = concludeCombat(fight);
const after = outcome.state;

console.log('\n=== what the fight was worth ===');
console.log(`  victor: ${outcome.victor}`);
console.log(`  killed: ${outcome.killed.join(', ') || 'nothing'}`);
console.log(`  xp: +${outcome.xp}  (${before.xp} → ${after.sheet.xp ?? 0} of ${xpToNext(after.sheet.level)})`);
console.log(`  coin: +${outcome.coin}`);
console.log(`  loot: ${outcome.loot.map((l) => `${l.item.name}${l.count > 1 ? ` ×${l.count}` : ''}`).join(', ') || 'nothing'}`);
console.log(
  `  level: ${before.level} → ${after.sheet.level}`
  + (outcome.levelled ? `  (+${outcome.levelled.skillPointsGained} skill, +${outcome.levelled.pointsGained} ability)` : ''),
);
console.log(`  counters: ${JSON.stringify(after.sheet.counters)}`);
console.log(`  hp carried out: ${after.pc.hp}/${after.pc.maxHp}`);
console.log(`  run ended: ${after.ended?.reason ?? 'no'}`);
