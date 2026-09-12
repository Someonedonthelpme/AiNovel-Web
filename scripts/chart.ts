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
import { speciesFor } from '../src/character/species.ts';
import { BUILDS, chart, measure } from '../src/play/harness.ts';

const seed = Number(process.argv[2] ?? 7);
const danger = Number(process.argv[3] ?? 3);
const DANGERS = [1, 2, 3, 4, 6];

console.log(`world ${seed}, danger ${danger}\n`);

console.log('=== the build matrix (win %, 100 fights each) ===');
console.log('build'.padEnd(9) + DANGERS.map((d) => `d${d}`.padStart(6)).join(''));
for (const build of BUILDS) {
  const row = DANGERS.map((d) => `${Math.round(measure({ build, danger: d, trials: 100 }).rate * 100)}%`.padStart(6));
  console.log(build.padEnd(9) + row.join(''));
}

const kinds = speciesFor(seed).map((k) => ({ name: k.id, template: k.template }));
const matrix = chart(kinds, danger);

console.log(`\n=== who beats whom (row beats column, %), as ${BUILDS[0]} ===`);
console.log(''.padEnd(12) + kinds.map((k) => k.name.slice(0, 6).padStart(7)).join(''));
matrix.forEach((row, i) => {
  console.log(
    kinds[i].name.slice(0, 11).padEnd(12)
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
