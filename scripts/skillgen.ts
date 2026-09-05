/**
 * Measure the skill composer.
 *
 * `balance.ts` answers "is floor 8 winnable"; this answers "is the pricing
 * honest". Generation is only safe if the budget really is the balance, and
 * that is a claim about numbers, not an opinion — so generate thousands and
 * look at what comes out.
 *
 *   node --experimental-strip-types scripts/skillgen.ts [samples]
 *
 * What to watch:
 *
 *   value/budget    should sit near 1. Far below and budgets are being wasted;
 *                   far above and deep sources hand out free power.
 *   parts           how many effects a skill comes out with. `usesPerRest` was
 *                   what absorbed a rich budget; another EFFECT is what absorbs
 *                   it now, so this rising with depth is the system working.
 *   grammar         must be zero violations. A bow that heals is worse than an
 *                   unbalanced bow, because it reads as a bug.
 */
import { mulberry32 } from '../src/engine/roll.ts';
import { ABILITIES } from '../src/combat/types.ts';
import { composeSkill, obeys, priceSkill } from '../src/skills/compose.ts';
import { magnitudeOf, purposes } from '../src/skills/effect.ts';
import type { Effect } from '../src/skills/effect.ts';
import { STAT_GRAMMAR } from '../src/skills/statgrammar.ts';
import { budgetForFloor } from '../src/skills/book.ts';
import { priceOfUse } from '../src/skills/pools.ts';

const samples = Number(process.argv[2] ?? 400);

console.log('stat   floor  budget   value  ratio  parts   cost  channels seen');
console.log('─'.repeat(78));

let violations = 0;
let ratios: number[] = [];

for (const stat of ABILITIES) {
  const grammar = STAT_GRAMMAR[stat];

  for (const floor of [1, 6, 12, 20]) {
    const budget = budgetForFloor(floor);
    const channels = new Map<string, number>();
    let value = 0;
    let parts = 0;
    let cost = 0;

    for (let i = 0; i < samples; i++) {
      const rng = mulberry32(stat.length * 10007 + floor * 101 + i);
      const skill = composeSkill(rng, {
        id: `s${i}`,
        name: '',
        description: '',
        ability: stat,
        grammar,
        budget,
      });

      // The grammar is the hard constraint: an off-stat channel or an over-long
      // reach is a bug, not a balance question.
      if (obeys(skill, grammar) !== null) violations++;

      const what = purposes(skill.effects);
      for (const e of what) channels.set(e.channel, (channels.get(e.channel) ?? 0) + 1);
      parts += what.length;
      value += priceSkill(skill);
      cost += priceOfUse(skill).cost;
    }

    const meanValue = value / samples;
    const ratio = meanValue / budget;
    ratios.push(ratio);

    const seen = [...channels.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).join(' ');
    console.log(
      `${stat.padEnd(6)} ${String(floor).padStart(4)}  ${budget.toFixed(1).padStart(6)}  `
      + `${meanValue.toFixed(1).padStart(6)}  ${ratio.toFixed(2).padStart(5)}  `
      + `${(parts / samples).toFixed(2).padStart(5)}  ${(cost / samples).toFixed(1).padStart(5)}  ${seen}`,
    );
  }
}

ratios = ratios.sort((a, b) => a - b);
const median = ratios[Math.floor(ratios.length / 2)];

console.log('─'.repeat(78));
console.log(`grammar violations: ${violations}   (anything above zero is a bug)`);
console.log(`value/budget  min ${ratios[0].toFixed(2)}  median ${median.toFixed(2)}  max ${ratios[ratios.length - 1].toFixed(2)}`);

/** One effect in a phrase, so a line reads as a skill rather than as a row. */
function say(e: Effect): string {
  const amount = magnitudeOf(e);
  const held = e.duration.kind === 'rounds' ? `${e.duration.rounds}r` : e.duration.kind === 'sustained' ? 'held' : '';
  const area = e.shape.kind === 'burst' ? ` in ${e.shape.radius}` : '';
  const sign = e.sign === 'minus' ? '-' : '+';

  switch (e.channel) {
    case 'condition': return `${sign}${e.condition} ${held}`.trim();
    case 'stat': return `${sign}${amount} ${e.stat} ${held}`.trim();
    case 'special': return `${e.verb}`;
    default: return `${sign}${amount} ${e.channel}${area}`;
  }
}

// A sample of what it actually reads like, because numbers do not tell you
// whether a skill sounds like something a person would learn.
console.log('\na few, as the player would see them:');
for (const stat of ['str', 'int', 'cha'] as const) {
  for (let i = 0; i < 3; i++) {
    const rng = mulberry32(stat.length * 31 + i * 7919);
    const skill = composeSkill(rng, {
      id: `x${i}`, name: '', description: '',
      ability: stat, grammar: STAT_GRAMMAR[stat], budget: budgetForFloor(10),
    });
    const { pool, cost } = priceOfUse(skill);
    const what = purposes(skill.effects).map(say).join(', ');
    console.log(`  ${stat.padEnd(5)} ${skill.name.padEnd(22)} ${what}, reach ${skill.range}, ${cost} ${pool}`);
  }
}
