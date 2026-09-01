/**
 * Live capability check against the local LM Studio endpoint.
 *
 * Not a unit test — it needs the network. It answers what the local models can
 * actually be trusted with, per language, rather than assuming.
 *
 *   node --experimental-strip-types scripts/check-local.ts
 */
import {
  EMBEDDING_COLLAPSE_THRESHOLD,
  embed,
  isLocalUp,
  LOCAL_BASE_URL,
  LOCAL_MODELS,
  localChat,
  probeEmbeddingSeparation,
} from '../src/llm/local.ts';
import { rankClues } from '../src/llm/similarity.ts';

type Case = { clue: string; text: string };

const TH_CLUES: Case[] = [
  { clue: 'c1', text: 'สมุดบัญชีถูกซ่อนอยู่ใต้พื้นไม้ของคลินิก' },
  { clue: 'c2', text: 'ผู้ตายเสียชีวิตก่อนที่จะมีเสียงปืนดังขึ้น' },
  { clue: 'c3', text: 'มีคนเห็นมะลิอยู่ที่บ้านพักหลังเที่ยงคืน' },
  { clue: 'c4', text: 'มะลิปลอมลายเซ็นของพี่ชายในสมุดบัญชี' },
];
const TH_QUERIES = [
  { text: 'ถามหมอเรื่องเวลาที่คนตายจริง ๆ', expect: 'c2' },
  { text: 'ค้นใต้พื้นห้องหาสมุด', expect: 'c1' },
  { text: 'ใครเห็นมะลิตอนกลางคืนบ้าง', expect: 'c3' },
  { text: 'ลายเซ็นในสมุดเป็นของปลอมหรือเปล่า', expect: 'c4' },
];

const EN_CLUES: Case[] = [
  { clue: 'c1', text: 'The ledger was hidden under the floorboards of the clinic' },
  { clue: 'c2', text: 'The victim died before the gunshot was heard' },
  { clue: 'c3', text: 'Mali was seen at the villa after midnight' },
  { clue: 'c4', text: "Mali forged her brother's signature in the ledger" },
];
const EN_QUERIES = [
  { text: 'ask the doctor about the real time of death', expect: 'c2' },
  { text: 'search under the floor for a book', expect: 'c1' },
  { text: 'who saw Mali during the night', expect: 'c3' },
  { text: 'is the signature in the ledger a forgery', expect: 'c4' },
];

async function retrieval(label: string, clues: Case[], queries: { text: string; expect: string }[]) {
  const spread = await probeEmbeddingSeparation(clues.map((c) => c.text));
  const collapsed = spread < EMBEDDING_COLLAPSE_THRESHOLD;

  console.log(`\n[${label}] embedding separation spread: ${spread.toFixed(6)}`);
  if (collapsed) {
    console.log(`  COLLAPSED — the model returns effectively one vector for all ${label} text.`);
    console.log('  Embeddings are UNUSABLE here; do not gate clue matching on them.');
    return { collapsed, correct: 0, total: queries.length };
  }

  const clueVecs = await embed(clues.map((c) => c.text));
  const queryVecs = await embed(queries.map((q) => q.text));
  const vectors = clues.map((c, i) => ({ clue: c.clue, vector: clueVecs[i] }));

  let correct = 0;
  for (const [i, q] of queries.entries()) {
    const ranked = rankClues(queryVecs[i], vectors, { limit: 2 });
    const hit = ranked[0]?.clue === q.expect;
    if (hit) correct++;
    const margin = (ranked[0]?.score ?? 0) - (ranked[1]?.score ?? 0);
    console.log(
      `  ${hit ? 'PASS' : 'FAIL'}  ${ranked[0]?.clue} (${ranked[0]?.score.toFixed(3)}, margin ${margin.toFixed(3)}) expected ${q.expect}  "${q.text}"`,
    );
  }
  console.log(`  retrieval: ${correct}/${queries.length}`);
  return { collapsed, correct, total: queries.length };
}

async function main() {
  console.log(`endpoint: ${LOCAL_BASE_URL}`);
  if (!(await isLocalUp())) {
    console.error('FAIL: endpoint unreachable');
    process.exitCode = 1;
    return;
  }
  console.log('PASS  endpoint reachable');

  const en = await retrieval('EN', EN_CLUES, EN_QUERIES);
  const th = await retrieval('TH', TH_CLUES, TH_QUERIES);

  const harness = await localChat([{ role: 'user', content: 'Reply with exactly one word: ready' }], {
    model: LOCAL_MODELS.small,
    maxTokens: 32,
    temperature: 0,
  });
  console.log(`\n[harness] ${LOCAL_MODELS.small}: "${harness.text.slice(0, 40)}" ${harness.ms}ms`);

  console.log('\n--- verdict ---');
  console.log(`English clue matching : ${en.collapsed ? 'UNUSABLE' : `${en.correct}/${en.total}`}`);
  console.log(`Thai clue matching    : ${th.collapsed ? 'UNUSABLE (embedding space collapsed)' : `${th.correct}/${th.total}`}`);
  if (th.collapsed) {
    console.log('\nThai needs a multilingual embedding model (e.g. bge-m3 or multilingual-e5)');
    console.log('installed in LM Studio, or clue matching must come from the Director instead.');
  }
}

main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
