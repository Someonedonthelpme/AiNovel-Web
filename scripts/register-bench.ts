/**
 * Thai register adherence benchmark.
 *
 * The register mechanic is what this game is built around: an NPC's pronoun and
 * sentence-ending particle shift with trust, and the player hears the
 * relationship change. The Writer is TOLD the exact forms to use on every turn —
 * so the only question that matters for a candidate model is whether it obeys.
 *
 * This measures that mechanically instead of guessing.
 *
 *   node --experimental-strip-types scripts/register-bench.ts [model ...]
 */
import { checkRegister } from '../src/llm/register.ts';
import { isLocalUp, LOCAL_BASE_URL, localChat } from '../src/llm/local.ts';

type Case = {
  id: string;
  trust: number;
  want: { selfPronoun: string; addressesPlayerAs: string; particle: string };
  forbidden: string[];
  who: string;
  scene: string;
};

/** Five bands across the range the mechanic actually uses. */
const CASES: Case[] = [
  {
    id: 'cold-formal',
    trust: -2,
    want: { selfPronoun: 'ดิฉัน', addressesPlayerAs: 'คุณ', particle: 'ค่ะ' },
    forbidden: ['กู', 'มึง', 'เธอ', 'ผม', 'ฉัน', 'ครับ'],
    who: 'a clinic doctor, cornered and hostile, speaking to a stranger she does not trust',
    scene: 'The stranger has just asked her what time the victim really died.',
  },
  {
    id: 'polite-male',
    trust: 0,
    want: { selfPronoun: 'ผม', addressesPlayerAs: 'คุณ', particle: 'ครับ' },
    forbidden: ['กู', 'มึง', 'เธอ', 'ดิฉัน', 'ค่ะ'],
    who: 'a harbour clerk, correct and careful, speaking to a customer',
    scene: 'The customer asks whether a certain boat came in last night.',
  },
  {
    id: 'warming',
    trust: 2,
    want: { selfPronoun: 'ฉัน', addressesPlayerAs: 'เธอ', particle: 'นะ' },
    forbidden: ['กู', 'มึง', 'คุณ', 'ดิฉัน', 'ค่ะ', 'ครับ'],
    who: 'a fish seller who has decided she likes this person',
    scene: 'She is warning them, kindly, not to go up the tower today.',
  },
  {
    id: 'intimate-no-particle',
    trust: 4,
    want: { selfPronoun: 'ฉัน', addressesPlayerAs: 'เธอ', particle: '' },
    forbidden: ['ครับ', 'ค่ะ', 'คุณ', 'ดิฉัน', 'มึง'],
    who: 'an old friend, entirely at ease, with no distance left to keep',
    scene: 'They are telling the person to stop apologising and sit down.',
  },
  {
    id: 'hostile-blunt',
    trust: -3,
    want: { selfPronoun: 'กู', addressesPlayerAs: 'มึง', particle: 'วะ' },
    forbidden: ['ค่ะ', 'ครับ', 'ดิฉัน', 'คุณ', 'เธอ', 'ผม'],
    who: 'a dock thug, furious, with no reason left to be polite',
    scene: 'He has just caught the person going through his things.',
  },
];

function prompt(c: Case): { system: string; user: string } {
  const particleRule = c.want.particle
    ? `End sentences with the particle "${c.want.particle}".`
    : 'Use NO polite sentence-ending particle at all — the closeness has dissolved them.';

  return {
    system: [
      'You write a single short passage of Thai dialogue for a game.',
      'You will be given the exact register to use. Obey it exactly — it encodes the relationship.',
      `The speaker refers to themselves as "${c.want.selfPronoun}".`,
      `The speaker addresses the other person as "${c.want.addressesPlayerAs}".`,
      particleRule,
      c.forbidden.length ? `Never use: ${c.forbidden.join(', ')}.` : '',
      'Two or three sentences. Output only the Thai dialogue, no commentary.',
    ].filter(Boolean).join('\n'),
    user: `Speaker: ${c.who}\nSituation: ${c.scene}`,
  };
}

type Score = {
  model: string;
  runs: number;
  strictPass: number;
  meanScore: number;
  selfPronoun: number;
  address: number;
  particle: number;
  banned: number;
  thai: number;
  meanMs: number;
  samples: { id: string; ok: boolean; text: string }[];
};

/** Repeat each case, because one lucky generation is not evidence. */
const TRIALS = Number(process.env.REGISTER_BENCH_TRIALS ?? '1') || 1;

async function benchmark(model: string): Promise<Score> {
  const s: Score = {
    model, runs: 0, strictPass: 0, meanScore: 0,
    selfPronoun: 0, address: 0, particle: 0, banned: 0, thai: 0, meanMs: 0, samples: [],
  };
  let scoreSum = 0;
  let msSum = 0;

  const schedule = CASES.flatMap((c) => Array.from({ length: TRIALS }, () => c));

  for (const c of schedule) {
    const p = prompt(c);
    let text = '';
    const started = Date.now();
    try {
      const out = await localChat(
        [{ role: 'system', content: p.system }, { role: 'user', content: p.user }],
        { model, maxTokens: 1500, temperature: 0.8 },
      );
      text = out.text;
    } catch (e) {
      text = '';
      console.error(`    ${c.id}: call failed — ${e instanceof Error ? e.message : e}`);
    }
    msSum += Date.now() - started;

    const check = checkRegister(text, c.want, c.forbidden);
    s.runs++;
    scoreSum += check.score;
    if (check.ok) s.strictPass++;
    if (check.usedSelfPronoun) s.selfPronoun++;
    if (check.usedAddress) s.address++;
    if (check.usedParticle) s.particle++;
    if (check.forbiddenFound.length) s.banned++;
    if (check.isThai) s.thai++;
    const shown = s.samples.filter((x) => x.id === c.id).length;
    if (shown === 0 || !check.ok) {
  s.samples.push({ id: c.id, ok: check.ok, text: text.replace(/\s+/g, ' ').slice(0, 90) });
    }
  }

  s.meanScore = scoreSum / Math.max(1, s.runs);
  s.meanMs = msSum / Math.max(1, s.runs);
  return s;
}

async function installedChatModels(): Promise<string[]> {
  const res = await fetch(`${LOCAL_BASE_URL}/models`);
  const json = await res.json();
  const ids: string[] = (json?.data ?? []).map((d: { id: string }) => d.id);
  // Embedding and speech models cannot answer this.
  return ids.filter((id) => !/embed|orpheus/i.test(id));
}

async function main() {
  if (!(await isLocalUp())) {
    console.error('local endpoint unreachable');
    process.exitCode = 1;
    return;
  }

  const requested = process.argv.slice(2);
  const models = requested.length ? requested : await installedChatModels();

  console.log('Thai register adherence — does the model obey the register it was given?\n');
  console.log(`cases: ${CASES.length}  trials each: ${TRIALS}  models: ${models.length}\n`);

  const results: Score[] = [];
  for (const model of models) {
    console.log(`${model} ...`);
    const score = await benchmark(model);
    results.push(score);
    for (const sample of score.samples) {
      console.log(`    ${sample.ok ? 'PASS' : 'FAIL'} ${sample.id.padEnd(22)} ${sample.text}`);
    }
    console.log(
      `    strict ${score.strictPass}/${score.runs}  mean ${score.meanScore.toFixed(2)}  ${Math.round(score.meanMs / 1000)}s/case\n`,
    );
  }

  results.sort((a, b) => b.strictPass - a.strictPass || b.meanScore - a.meanScore);

  console.log('--- ranking ---');
  console.log('model'.padEnd(46), 'strict  mean  self  addr  part  banned  s/case');
  for (const r of results) {
    console.log(
      r.model.slice(0, 45).padEnd(46),
      `${r.strictPass}/${r.runs}`.padEnd(7),
      r.meanScore.toFixed(2).padEnd(5),
      `${r.selfPronoun}/${r.runs}`.padEnd(5),
      `${r.address}/${r.runs}`.padEnd(5),
      `${r.particle}/${r.runs}`.padEnd(5),
      `${r.banned}`.padEnd(7),
      Math.round(r.meanMs / 1000),
    );
  }

  const best = results[0];
  console.log(
    `\nbest: ${best?.model} — ${best?.strictPass}/${best?.runs} passages obeyed every constraint.`,
  );
  if ((best?.strictPass ?? 0) < CASES.length) {
    console.log('No local model obeys register reliably yet; the Writer should stay hosted.');
  }
}

main().catch((e) => {
  console.error('FAILED:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
