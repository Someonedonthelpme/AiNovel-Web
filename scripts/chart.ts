/**
 * The matchup chart, and the build matrix under it.
 *
 * A REPORT, not a test: species are allowed to be uneven — disadvantage the
 * player chose is part of the game — so there is nothing here for an assertion
 * to fail on. What it catches is a change nobody meant: a lean that quietly
 * costs fifteen points, a rank that beats everything.
 *
 *   node --experimental-strip-types scripts/chart.ts [worldSeed] [danger]
 */
import { leavesOf, speciesFor } from '../src/character/species.ts';
import { BUILDS, chart, matrixRow } from '../src/play/harness.ts';

const seed = Number(process.argv[2] ?? 7);
const danger = Number(process.argv[3] ?? 3);
/**
 * Out to 20, because the climber now levels and gears with the depth it fights —
 * past 6 the old level-one climber read 0–6% everywhere, which measured nothing.
 */
const DANGERS = [1, 2, 3, 4, 6, 10, 14, 20];

console.log(`world ${seed}, danger ${danger}\n`);

/*
 * Against the CHARACTER foes this world's kinds put in front of a climber at each
 * depth. It measured statblock foes against a level-one body until 2026-09-13, so
 * no change to a crowd foe could ever show here; the statblock curve is still
 * pinned, in `harness.test.ts`.
 */
console.log('=== the build matrix (win %, 100 fights each, character foes, a climber at that depth) ===');
console.log('build'.padEnd(9) + DANGERS.map((d) => `d${d}`.padStart(6)).join(''));
for (const build of BUILDS) {
  const row = matrixRow(build, DANGERS, { seed, trials: 100 }).map((rate) => `${Math.round(rate * 100)}%`.padStart(6));
  console.log(build.padEnd(9) + row.join(''));
}

/*
 * SUBSPECIES only, and a sample of them: a type and a group are categories, not
 * bodies, and a world deals tens of leaves — every pair of 40 of them is 1,600
 * match-ups nobody reads. `HOW_MANY` spreads across the tree rather than taking
 * the first few, which would all share one type.
 */
const HOW_MANY = Number(process.argv[4] ?? 8);
const leaves = leavesOf(speciesFor(seed));
const step = Math.max(1, Math.floor(leaves.length / HOW_MANY));
const kinds = leaves.filter((_, i) => i % step === 0).slice(0, HOW_MANY)
  .map((k) => ({ name: k.id, template: k.template ?? {} }));
console.log(`${leaves.length} subspecies in this world; charting ${kinds.length} of them
`);
const matrix = chart(kinds, danger);

console.log(`\n=== who beats whom (row beats column, %), as ${BUILDS[0]} ===`);
console.log(''.padEnd(26) + kinds.map((k) => k.name.slice(-6).padStart(7)).join(''));
matrix.forEach((row, i) => {
  console.log(
    kinds[i].name.padEnd(26)
    + row.map((v) => `${Math.round(v * 100)}`.padStart(7)).join('')
    + '   ' + JSON.stringify(kinds[i].template),
  );
});

// A ladder means one is simply better; a cycle means it depends who you meet.
let cycles = 0;
for (let i = 0; i < kinds.length; i++) {
  for (let j = i + 1; j < kinds.length; j++) {
    for (let k = j + 1; k < kinds.length; k++) {
      const beats = (x: number, y: number) => matrix[x][y] > 0.55;
      if ((beats(i, j) && beats(j, k) && beats(k, i)) || (beats(j, i) && beats(k, j) && beats(i, k))) cycles++;
    }
  }
}
console.log(`\ncycles (each edge > 55%): ${cycles} — 0 means a ladder, not a chart`);
