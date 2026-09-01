/**
 * Measure the difficulty curve by simulation.
 *
 * A solo climber against a generated encounter, thousands of times per floor.
 * Difficulty is a number, not an opinion.
 *
 *   node --experimental-strip-types scripts/balance.ts
 */
import { mulberry32 } from '../src/engine/roll.ts';
import { buildEncounter, kindForFloor, composition, simulateFight } from '../src/combat/encounter.ts';
import { expectedPcLevel, referencePc } from '../src/combat/statblock.ts';
import type { Grid } from '../src/combat/types.ts';

const grid: Grid = { width: 12, height: 12, walls: new Set() };
const TRIALS = 400;

console.log('floor  lvl  kind      foes                 win%   avg hp left   rounds');
for (const floor of [1, 2, 3, 5, 8, 10, 14, 20, 30]) {
  const level = expectedPcLevel(floor);
  let wins = 0;
  let hpSum = 0;
  let roundSum = 0;

  for (let i = 0; i < TRIALS; i++) {
    const rng = mulberry32(floor * 100000 + i);
    const pc = { ...referencePc(level), pos: { x: 1, y: 6 } };
    const foes = buildEncounter({ danger: floor, grid, origin: { x: 9, y: 6 } });
    const r = simulateFight(rng, [pc], foes, grid);
    if (r.victor === 'party') wins++;
    hpSum += r.partyHpLeft;
    roundSum += r.rounds;
  }

  const roles = composition(floor, kindForFloor(floor)).join('+');
  console.log(
    `${String(floor).padStart(5)}  ${String(level).padStart(3)}  ${kindForFloor(floor).padEnd(9)} ${roles.padEnd(20)} ` +
    `${((wins / TRIALS) * 100).toFixed(0).padStart(4)}%  ${((hpSum / TRIALS) * 100).toFixed(0).padStart(9)}%  ${(roundSum / TRIALS).toFixed(1).padStart(7)}`,
  );
}
