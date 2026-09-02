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
 *   uses            a cheap payload should come with several uses and an
 *                   expensive one with a single use. If everything is on one
 *                   use, the payload sizing is too greedy.
 *   grammar         must be zero violations. A bow that heals is worse than an
 *                   unbalanced bow, because it reads as a bug.
 */
import { mulberry32 } from '../src/engine/roll.ts';
import { ARCHETYPES } from '../src/play/archetypes.ts';
import { composeSkill, nameFor, priceSkill } from '../src/skills/compose.ts';
import { budgetForFloor } from '../src/skills/book.ts';

const samples = Number(process.argv[2] ?? 400);

console.log('discipline    floor  budget   value  ratio   uses  payloads seen');
console.log('─'.repeat(78));

let violations = 0;
let ratios: number[] = [];

for (const archetype of ARCHETYPES) {
  for (const floor of [1, 6, 12, 20]) {
    const budget = budgetForFloor(floor);
    const kinds = new Map<string, number>();
    let value = 0;
    let uses = 0;

    for (let i = 0; i < samples; i++) {
      const rng = mulberry32(archetype.id.length * 10007 + floor * 101 + i);
      const skill = composeSkill(rng, {
        id: `s${i}`,
        name: '',
        description: '',
        kind: 'combat',
        ability: archetype.ability,
        grammar: archetype.draws,
        budget,
      });

      // The grammar is the hard constraint: an off-discipline payload or an
      // over-long reach is a bug, not a balance question.
      if (!archetype.draws.payloads.includes(skill.effect.kind as never)) violations++;
      if (skill.range > archetype.draws.maxRange) violations++;

      kinds.set(skill.effect.kind, (kinds.get(skill.effect.kind) ?? 0) + 1);
      value += priceSkill(skill);
      uses += skill.usesPerRest;
    }

    const meanValue = value / samples;
    const ratio = meanValue / budget;
    ratios.push(ratio);

    const seen = [...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).join(' ');
    console.log(
      `${archetype.id.padEnd(12)} ${String(floor).padStart(4)}  ${budget.toFixed(1).padStart(6)}  `
      + `${meanValue.toFixed(1).padStart(6)}  ${ratio.toFixed(2).padStart(5)}  `
      + `${(uses / samples).toFixed(1).padStart(4)}  ${seen}`,
    );
  }
}

ratios = ratios.sort((a, b) => a - b);
const median = ratios[Math.floor(ratios.length / 2)];

console.log('─'.repeat(78));
console.log(`grammar violations: ${violations}   (anything above zero is a bug)`);
console.log(`value/budget  min ${ratios[0].toFixed(2)}  median ${median.toFixed(2)}  max ${ratios[ratios.length - 1].toFixed(2)}`);

// A sample of what it actually reads like, because numbers do not tell you
// whether a skill sounds like something a person would learn.
console.log('\na few, as the player would see them:');
for (const archetype of [ARCHETYPES[0], ARCHETYPES[5], ARCHETYPES[9]]) {
  for (let i = 0; i < 3; i++) {
    const rng = mulberry32(archetype.id.length * 31 + i * 7919);
    const skill = composeSkill(rng, {
      id: `x${i}`, name: '', description: '', kind: 'combat',
      ability: archetype.ability, grammar: archetype.draws, budget: budgetForFloor(10),
    });
    const e = skill.effect;
    const what = e.kind === 'hinder' ? `${e.condition} ${e.rounds}r`
      : e.kind === 'strike' ? `${e.damage} dmg`
        : e.kind === 'burst' ? `${e.damage} in ${e.radius}`
          : e.kind === 'hex' ? `${e.damage} + ${e.condition}`
            : e.kind === 'drain' ? `${e.damage}/${e.heal}`
              : e.kind === 'mend' ? `heal ${e.amount}`
                : e.kind === 'edge' ? `+${e.bonus} ${e.ability}` : e.kind;
    console.log(`  ${archetype.id.padEnd(11)} ${nameFor(rng, skill.effect, 'en').padEnd(22)} ${what}, reach ${skill.range}, ${skill.usesPerRest} uses`);
  }
}
