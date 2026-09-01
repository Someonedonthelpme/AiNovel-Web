/**
 * Drive Session Zero end to end against the local models.
 *
 * This is the free development harness the plan called for: it proves the whole
 * generation path — schema, provider, repair, validation — works against a real
 * model, without an API key and without spending anything.
 *
 * The local models are NOT good enough to write the final prose. This checks the
 * plumbing, not the writing.
 *
 *   node --experimental-strip-types scripts/session-zero.ts [th|en]
 */
import { LocalProvider, smallLocalProvider } from '../src/llm/localProvider.ts';
import { isLocalUp, LOCAL_MODELS } from '../src/llm/local.ts';
import { runGenesis } from '../src/session/genesis.ts';
import { derive } from '../src/session/sheet.ts';
import { recordAnswer, startInterview, STAGES } from '../src/session/interview.ts';
import type { Interview } from '../src/session/interview.ts';
import { validateRegion } from '../src/world/validate.ts';
import { isFull } from '../src/world/types.ts';

const ANSWERS: Record<string, { en: string; th: string }> = {
  world: {
    en: 'A drowned coast where the sea never went back down, and the tower is the only dry thing left.',
    th: 'ชายฝั่งที่น้ำท่วมไม่เคยลด และหอคอยคือที่แห้งแห่งเดียวที่เหลืออยู่',
  },
  character: {
    en: 'A harbour guard who lost her brother on the third floor and has been paying off his debts since.',
    th: 'ทหารยามท่าเรือที่เสียน้องชายไปบนชั้นสาม และใช้หนี้ของเขามาตั้งแต่นั้น',
  },
  drive: {
    en: 'She wants his body back. She is leaving behind a family that blames her.',
    th: 'เธออยากได้ร่างของเขาคืน และกำลังทิ้งครอบครัวที่โทษเธอไว้ข้างหลัง',
  },
  review: { en: 'ready', th: 'พร้อมแล้ว' },
};

function scriptedInterview(language: 'th' | 'en'): Interview {
  let iv = startInterview(language);
  for (const stage of STAGES) {
    iv = recordAnswer(iv, ANSWERS[stage][language]).interview;
  }
  return iv;
}

async function main() {
  const language = (process.argv[2] === 'th' ? 'th' : 'en') as 'th' | 'en';

  if (!(await isLocalUp())) {
    console.error('local endpoint unreachable');
    process.exitCode = 1;
    return;
  }

  const provider = new LocalProvider(LOCAL_MODELS.large);
  console.log(`provider: ${provider.name}`);
  console.log(`language: ${language}\n`);

  const started = Date.now();
  let result;
  try {
    result = await runGenesis(provider, scriptedInterview(language), 1234);
  } catch (e) {
    console.error(`FAILED: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
    return;
  }
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  const { sheet, world } = result;
  const d = derive(sheet);

  console.log(`--- character (${elapsed}s) ---`);
  console.log(`${sheet.name} — ${sheet.background.name}`);
  console.log(`  ${sheet.background.description}`);
  console.log(`  abilities ${JSON.stringify(d.abilities)}`);
  console.log(`  hp ${d.maxHp}  ac ${d.ac}  prof +${d.proficiency}`);
  console.log(`  voice: self "${sheet.voice.selfPronoun}", stressed "${sheet.voice.underStress}"`);
  console.log(`  traits: ${sheet.traits.join(', ')}`);
  for (const s of d.skills) console.log(`  skill: ${s.name} (${s.ability}, ${s.kind}) — ${s.description}`);
  for (const a of sheet.background.startingAttacks) {
    console.log(`  attack: ${a.name} ${a.damage.count}d${a.damage.sides}+${a.damage.bonusAbility} range ${a.range}`);
  }

  console.log(`\n--- ${world.language} ground floor ---`);
  console.log(`premise: ${result.premise}`);
  const region = world.regions['floor-0'];
  if (!isFull(region)) {
    console.error('ground floor did not come back in full detail');
    process.exitCode = 1;
    return;
  }
  console.log(`${region.name} — ${region.biome}; ${region.culture}`);
  for (const p of region.places) {
    const who = p.people.length ? `  [${p.people.join(', ')}]` : '';
    const mark = p.id === region.entrance ? ' (entrance)' : p.id === region.exit ? ' (way up)' : '';
    console.log(`  ${p.id}${mark} "${p.name}" ${p.kind} -> ${p.connections.join(', ') || '(none)'}${who}`);
    console.log(`      can: ${p.affordances.join('; ')}`);
  }
  for (const person of Object.values(world.people)) {
    console.log(`  person ${person.id}: ${person.name} — ${person.oneLine} (trust ${person.trust})`);
  }

  console.log('\n--- checks ---');
  const check = validateRegion(region, world.people);
  console.log(`region valid: ${check.ok}`);
  for (const e of check.errors) console.log(`  ERROR ${e.code}: ${e.message}`);
  for (const w of check.warnings) console.log(`  warn  ${w.code}: ${w.message}`);
  console.log(`repairs applied: ${result.repairs.length}`);
  for (const r of result.repairs) console.log(`  fixed: ${r}`);
  for (const w of result.warnings) console.log(`  warn: ${w}`);

  console.log(`\nstarting at: ${world.currentPlace} in ${world.currentRegion}`);

  // The small model only has to survive the plumbing.
  const small = smallLocalProvider();
  const echo = await small.text({ messages: [{ role: 'user', content: 'Say only: ok' }], maxTokens: 16 });
  console.log(`dev harness (${small.name}): "${echo.trim().slice(0, 20)}"`);

  if (!check.ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FAILED:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
