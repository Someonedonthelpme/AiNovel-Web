/**
 * Play the game in a terminal, against the local models, with real persistence.
 *
 *   node --experimental-strip-types scripts/play.ts                 interactive, English
 *   node --experimental-strip-types scripts/play.ts th              interactive, Thai
 *   node --experimental-strip-types scripts/play.ts th --auto       scripted, for verification
 *   node --experimental-strip-types scripts/play.ts --list          existing sessions
 *   node --experimental-strip-types scripts/play.ts --resume <id>   carry on where you left off
 *
 * Everything runs on LM Studio and the local Postgres, so a whole session costs
 * nothing and survives the process exiting.
 */
import { createInterface } from 'node:readline/promises';
import { mulberry32 } from '../src/engine/roll.ts';
import { pgFactRetriever } from '../src/db/facts.ts';
import { closeDb, bootstrap, isDatabaseUp } from '../src/db/db.ts';
import {
  appendTurn, createSession, listSessions, loadSession, saveSnapshot, shouldSnapshot,
} from '../src/db/sessions.ts';
import { localFactRetriever } from '../src/llm/canon.ts';
import { isLocalUp, LOCAL_MODELS } from '../src/llm/local.ts';
import { LocalProvider } from '../src/llm/localProvider.ts';
import { registerFor } from '../src/llm/register.ts';
import { climb, exitStatus } from '../src/play/climb.ts';
import { initialPlayState } from '../src/play/state.ts';
import type { Mode, PlayState } from '../src/play/state.ts';
import { playTurn, suggestedActions } from '../src/play/turn.ts';
import { runGenesis } from '../src/session/genesis.ts';
import { recordAnswer, startInterview, STAGES } from '../src/session/interview.ts';
import type { Interview } from '../src/session/interview.ts';
import { derive } from '../src/session/sheet.ts';
import { activeRegion, moveWithinRegion } from '../src/world/travel.ts';

const ANSWERS: Record<string, { en: string; th: string }> = {
  world: {
    en: 'A drowned coast where the sea never went back down, and the tower is the only dry thing left.',
    th: 'ชายฝั่งที่น้ำท่วมไม่เคยลด และหอคอยคือที่แห้งแห่งเดียวที่เหลืออยู่',
  },
  character: {
    en: 'A harbour guard who lost her brother on the third floor and has been paying his debts since.',
    th: 'ทหารยามท่าเรือที่เสียน้องชายไปบนชั้นสาม และใช้หนี้ของเขามาตั้งแต่นั้น',
  },
  drive: {
    en: 'She wants his body back. She is leaving behind a family that blames her.',
    th: 'เธออยากได้ร่างของเขาคืน และกำลังทิ้งครอบครัวที่โทษเธอไว้ข้างหลัง',
  },
  review: { en: 'ready', th: 'พร้อมแล้ว' },
};

const AUTO_TURNS = [
  { en: 'look around and get my bearings', th: 'มองไปรอบ ๆ ดูว่าอยู่ตรงไหน' },
  { en: 'ask what people know about the tower', th: 'ถามผู้คนว่ารู้อะไรเกี่ยวกับหอคอยบ้าง' },
];

function scriptedInterview(language: 'th' | 'en'): Interview {
  let iv = startInterview(language);
  for (const stage of STAGES) iv = recordAnswer(iv, ANSWERS[stage][language]).interview;
  return iv;
}

function describe(state: PlayState): string {
  const region = activeRegion(state.world);
  const place = region?.places.find((p) => p.id === state.world.currentPlace);
  const people = (place?.people ?? [])
    .map((id) => state.world.people[id])
    .filter(Boolean)
    .map((p) => `${p.name} (trust ${p.trust})`);

  return [
    `\n[turn ${state.world.turn}] floor ${region?.floor} · ${region?.name} — ${place?.name}`,
    people.length ? `  here: ${people.join(', ')}` : '  here: nobody',
  ].join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const language = (argv.includes('th') ? 'th' : 'en') as 'th' | 'en';
  const auto = argv.includes('--auto');
  const resumeId = argv[argv.indexOf('--resume') + 1];
  const resuming = argv.includes('--resume') && Boolean(resumeId);

  const dbUp = await isDatabaseUp();
  if (dbUp) await bootstrap();

  if (argv.includes('--list')) {
    if (!dbUp) {
      console.error('no database — nothing to list');
      return;
    }
    for (const s of await listSessions()) {
      console.log(`${s.id}  ${s.characterName.padEnd(18)} ${String(s.turns).padStart(3)} turns  ${s.language}  ${s.updatedAt.toISOString().slice(0, 16)}`);
      console.log(`    ${s.premise.slice(0, 90)}`);
    }
    await closeDb();
    return;
  }

  if (!(await isLocalUp())) {
    console.error('local model endpoint unreachable');
    process.exitCode = 1;
    return;
  }

  const provider = new LocalProvider(LOCAL_MODELS.writer);
  console.log(`provider: ${provider.name}`);
  console.log(dbUp ? 'persistence: postgres' : 'persistence: NONE (database unreachable, nothing will be saved)');

  let state: PlayState;
  let sessionId: string | null = null;
  let seq = 0;

  if (resuming) {
    if (!dbUp) throw new Error('cannot resume without a database');
    const loaded = await loadSession(resumeId);
    if (!loaded) throw new Error(`no session ${resumeId}`);
    state = loaded.state;
    sessionId = resumeId;
    seq = loaded.lastSeq;
    console.log(`\nresumed ${resumeId} — ${state.sheet.name}, turn ${state.world.turn} (replayed ${loaded.replayed} turns)`);
  } else {
    console.log(`language: ${language}\n\nSession Zero...`);
    const genesis = await runGenesis(provider, scriptedInterview(language), Date.now() % 2147483647);
    const d = derive(genesis.sheet);
    state = initialPlayState(genesis.world, genesis.sheet);

    console.log(`\n${genesis.sheet.name} — ${genesis.sheet.background.name}`);
    console.log(`  hp ${d.maxHp}  ac ${d.ac}  ${JSON.stringify(d.abilities)}`);
    console.log(`  voice: "${genesis.sheet.voice.selfPronoun}" / "${genesis.sheet.voice.underStress}"`);
    console.log(`  premise: ${genesis.premise}`);
    if (genesis.repairs.length) console.log(`  (${genesis.repairs.length} repairs applied)`);

    if (dbUp) {
      sessionId = await createSession(genesis.world, genesis.sheet, genesis.premise);
      console.log(`  session ${sessionId}`);
    }
  }

  const deps = {
    director: provider,
    writer: provider,
    rng: mulberry32(state.world.seed + state.world.turn),
    // With a database the canon guard keeps its embeddings between sessions.
    retrieveFacts: sessionId ? pgFactRetriever(sessionId) : localFactRetriever(),
  };
  const recent: string[] = [];
  const rl = auto ? null : createInterface({ input: process.stdin, output: process.stdout });

  for (let i = 0; ; i++) {
    console.log(describe(state));
    console.log(`  you could: ${suggestedActions(state).slice(0, 6).join(' | ')}`);

    let input: string;
    if (auto) {
      if (i === AUTO_TURNS.length) {
        const region = activeRegion(state.world);
        if (region?.exit && state.world.currentPlace !== region.exit) {
          const step = moveWithinRegion(state.world, region.exit);
          if (step.kind === 'moved') {
            state = { ...state, world: step.world };
            console.log(`\n> (walk to ${region.exit})`);
          }
        }
        input = 'climb';
        console.log(`> ${input}`);
      } else if (i > AUTO_TURNS.length) {
        break;
      } else {
        input = AUTO_TURNS[i][language];
        console.log(`\n> ${input}`);
      }
    } else {
      input = (await rl!.question('\n> ')).trim();
      if (!input || input === 'quit') break;
    }

    // Climbing changes floors; it is a world move, not a narrated turn.
    if (/^(climb|ascend|go up|ขึ้น|ปีน)/i.test(input)) {
      if (!exitStatus(state).canClimb) {
        console.log('  [not standing at the way up]');
        continue;
      }
      const up = await climb(provider, state);
      if (up.error) {
        console.log(`  [${up.error}]`);
      } else {
        state = up.state;
        const region = activeRegion(state.world);
        console.log(`\n  *** floor ${region?.floor}: ${region?.name} — ${region?.biome} ***`);
        console.log(`  danger ${region?.danger} | places ${region?.places.length} | creatures: ${up.generated?.creatures.join(', ')}`);
        for (const fix of up.generated?.repairs ?? []) console.log(`  [fixed: ${fix}]`);
        // A new floor is a large change; snapshot rather than replay it later.
        if (sessionId) await saveSnapshot(sessionId, state);
      }
      continue;
    }

    const mode: Mode = /^(go|walk|move|look|search|เดิน|ไป|มอง|ค้น)/i.test(input) ? 'exploration' : 'conversation';
    const started = Date.now();

    try {
      const result = await playTurn(deps, state, input, mode, recent);
      state = result.state;
      recent.push(result.record.prose);

      if (sessionId) {
        seq = await appendTurn(sessionId, result.record);
        if (shouldSnapshot(seq)) await saveSnapshot(sessionId, state);
      }

      console.log(`\n${result.record.prose}\n`);

      const bits = [`${((Date.now() - started) / 1000).toFixed(1)}s`, result.record.classification];
      if (result.record.roll) {
        const r = result.record.roll;
        bits.push(`${r.ability} ${r.dice[0]}+${r.dice[1]}${r.modifier >= 0 ? '+' : ''}${r.modifier}=${r.total} ${r.tier.toUpperCase()}`);
      }
      if (result.writer.regenerated) bits.push('register: regenerated');
      const failed = result.writer.checks.filter((c) => !c.check.ok);
      if (failed.length) bits.push(`register FAILED for ${failed.map((f) => f.person).join(', ')}`);
      console.log(`  [${bits.join(' | ')}]`);

      for (const f of failed) {
        const who = Object.values(state.world.people).find((p) => p.name === f.person);
        const want = who ? registerFor(who, who.trust) : null;
        const missing = [
          f.check.usedSelfPronoun ? '' : `self "${want?.selfPronoun}"`,
          f.check.usedAddress ? '' : `address "${want?.addressesPlayerAs}"`,
          f.check.usedParticle ? '' : `particle "${want?.particle}"`,
        ].filter(Boolean);
        if (missing.length) console.log(`    register ${f.person}: missing ${missing.join(', ')}`);
        if (f.check.forbiddenFound.length) console.log(`    register ${f.person}: used banned ${f.check.forbiddenFound.join(', ')}`);
      }
      for (const r of result.rejected) console.log(`  [refused: ${r}]`);
    } catch (e) {
      console.error(`  [turn failed: ${e instanceof Error ? e.message : e}]`);
    }
  }

  rl?.close();
  if (sessionId) await saveSnapshot(sessionId, state);

  console.log('\n--- session ---');
  console.log(`turns: ${state.world.turn}  facts: ${state.world.facts.length}  deepest floor: ${state.world.deepestFloor}`);
  for (const person of Object.values(state.world.people)) {
    console.log(`  ${person.name}: trust ${person.trust}`);
  }
  if (sessionId) console.log(`\nresume with:\n  node --experimental-strip-types scripts/play.ts --resume ${sessionId}`);
  await closeDb();
}

main().catch(async (e) => {
  console.error('FAILED:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
  await closeDb().catch(() => {});
});
