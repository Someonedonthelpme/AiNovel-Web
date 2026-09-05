/**
 * Head-to-head comparison of the local embedding models on the actual job:
 * retrieving the right clue for a player utterance, in Thai and in English.
 *
 * The bar that matters is not raw cosine — it is whether the correct clue ranks
 * first, and whether the space is separated enough that the ranking means
 * anything. Nomic scores a Thai separation spread of exactly 0.000000, which is
 * what motivated this comparison.
 *
 *   node --experimental-strip-types scripts/compare-embedders.ts
 */
import { embed, isLocalUp, LOCAL_MODELS, probeEmbeddingSeparation } from '../src/llm/local.ts';
import { rankFacts } from '../src/llm/similarity.ts';

type Clue = { clue: string; text: string };
type Query = { text: string; expect: string };

const TH_CLUES: Clue[] = [
  { clue: 'c1', text: 'สมุดบัญชีถูกซ่อนอยู่ใต้พื้นไม้ของคลินิก' },
  { clue: 'c2', text: 'ผู้ตายเสียชีวิตก่อนที่จะมีเสียงปืนดังขึ้น' },
  { clue: 'c3', text: 'มีคนเห็นมะลิอยู่ที่บ้านพักหลังเที่ยงคืน' },
  { clue: 'c4', text: 'มะลิปลอมลายเซ็นของพี่ชายในสมุดบัญชี' },
  { clue: 'c5', text: 'คนสวนได้ยินเสียงทะเลาะกันในห้องทำงาน' },
];
const TH_QUERIES: Query[] = [
  { text: 'ถามหมอเรื่องเวลาที่คนตายจริง ๆ', expect: 'c2' },
  { text: 'ค้นใต้พื้นห้องหาสมุด', expect: 'c1' },
  { text: 'ใครเห็นมะลิตอนกลางคืนบ้าง', expect: 'c3' },
  { text: 'ลายเซ็นในสมุดเป็นของปลอมหรือเปล่า', expect: 'c4' },
  { text: 'มีใครได้ยินเสียงเถียงกันไหม', expect: 'c5' },
];

const EN_CLUES: Clue[] = [
  { clue: 'c1', text: 'The ledger was hidden under the floorboards of the clinic' },
  { clue: 'c2', text: 'The victim died before the gunshot was heard' },
  { clue: 'c3', text: 'Mali was seen at the villa after midnight' },
  { clue: 'c4', text: "Mali forged her brother's signature in the ledger" },
  { clue: 'c5', text: 'The gardener heard an argument in the study' },
];
const EN_QUERIES: Query[] = [
  { text: 'ask the doctor about the real time of death', expect: 'c2' },
  { text: 'search under the floor for a book', expect: 'c1' },
  { text: 'who saw Mali during the night', expect: 'c3' },
  { text: 'is the signature in the ledger a forgery', expect: 'c4' },
  { text: 'did anyone hear people arguing', expect: 'c5' },
];

/** Cross-language: a Thai query must find the English clue and vice versa. */
const CROSS_QUERIES: Query[] = [
  { text: 'ask the doctor about the real time of death', expect: 'c2' },
  { text: 'who saw Mali during the night', expect: 'c3' },
];

type Score = { correct: number; total: number; spread: number; meanMargin: number; ms: number };

async function score(model: string, clues: Clue[], queries: Query[]): Promise<Score> {
  const started = Date.now();
  const spread = await probeEmbeddingSeparation(clues.map((c) => c.text), { model });
  const clueVecs = await embed(clues.map((c) => c.text), { model });
  const queryVecs = await embed(queries.map((q) => q.text), { model });
  // `rankClues` became `rankFacts` when clues did; the shape is unchanged.
  const vectors = clues.map((c, i) => ({ fact: c.clue, vector: clueVecs[i] }));

  let correct = 0;
  let marginSum = 0;
  for (const [i, q] of queries.entries()) {
    const ranked = rankFacts(queryVecs[i], vectors, { limit: 2 });
    if (ranked[0]?.fact === q.expect) correct++;
    marginSum += (ranked[0]?.score ?? 0) - (ranked[1]?.score ?? 0);
  }
  return { correct, total: queries.length, spread, meanMargin: marginSum / queries.length, ms: Date.now() - started };
}

const fmt = (s: Score) =>
  `${s.correct}/${s.total}  spread ${s.spread.toFixed(4)}  margin ${s.meanMargin.toFixed(4)}  ${s.ms}ms`;

async function main() {
  if (!(await isLocalUp())) {
    console.error('endpoint unreachable');
    process.exitCode = 1;
    return;
  }

  const models: [string, string][] = [
    ['nomic', LOCAL_MODELS.embedNomic],
    ['bge-m3', LOCAL_MODELS.embedBgeM3],
    ['qwen3-0.6b', LOCAL_MODELS.embedQwen3],
  ];

  console.log('Retrieval on the real task: does the correct clue rank first?\n');
  const results: Record<string, { th: Score; en: Score; cross: Score }> = {};

  for (const [label, model] of models) {
    process.stdout.write(`${label.padEnd(11)} warming... `);
    try {
      const en = await score(model, EN_CLUES, EN_QUERIES);
      const th = await score(model, TH_CLUES, TH_QUERIES);
      // Thai clue text, English queries — the hardest case.
      const cross = await score(model, TH_CLUES, CROSS_QUERIES);
      results[label] = { th, en, cross };
      console.log('done');
      console.log(`  EN    ${fmt(en)}`);
      console.log(`  TH    ${fmt(th)}`);
      console.log(`  X-ling ${fmt(cross)}   (English query -> Thai clue)`);
    } catch (e) {
      console.log(`FAILED: ${e instanceof Error ? e.message : e}`);
    }
    console.log();
  }

  console.log('--- verdict ---');
  for (const [label] of models) {
    const r = results[label];
    if (!r) continue;
    const usableTh = r.th.spread >= 0.02 && r.th.correct === r.th.total;
    const usableEn = r.en.spread >= 0.02 && r.en.correct === r.en.total;
    console.log(
      `${label.padEnd(11)} EN ${usableEn ? 'usable' : 'NOT usable'} | TH ${usableTh ? 'usable' : 'NOT usable'}${r.th.spread < 0.02 ? ' (space collapsed)' : ''}`,
    );
  }
}

main().catch((e) => {
  console.error('FAILED:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
