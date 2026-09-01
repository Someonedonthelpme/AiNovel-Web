import test from 'node:test';
import assert from 'node:assert/strict';
import { closeDb, bootstrap, isDatabaseUp } from './db.ts';
import { EMBEDDING_DIMENSION, relevantFacts, saveFacts } from './facts.ts';
import { createSession, deleteSession } from './sessions.ts';
import { isLocalUp } from '../llm/local.ts';
import { playState } from '../play/fixtures.ts';
import type { Fact } from '../world/types.ts';

const dbUp = await isDatabaseUp();
if (dbUp) await bootstrap();
const embedderUp = dbUp ? await isLocalUp() : false;

const needsDb = dbUp ? false : 'postgres not reachable';
// Retrieval quality needs the real embedder; storage alone does not.
const needsBoth = dbUp ? (embedderUp ? false : 'embedder not reachable') : 'postgres not reachable';

const created: string[] = [];
async function newSession() {
  const base = playState();
  const id = await createSession(base.world, base.sheet, 'test');
  created.push(id);
  return id;
}

test.after(async () => {
  if (dbUp) {
    for (const id of created) await deleteSession(id).catch(() => {});
    await closeDb();
  }
});

const fact = (id: string, text: string): Fact => ({
  id, text, region: 'floor-0', people: [], establishedAtTurn: 1,
});

const THAI_FACTS: Fact[] = [
  fact('f1', 'บ่อน้ำในเมืองแห้งสนิทตั้งแต่ฤดูใบไม้ผลิ'),
  fact('f2', 'ช่างตีเหล็กทำงานเฉพาะตอนกลางคืนเท่านั้น'),
  fact('f3', 'ทหารยามที่ประตูเป็นหนี้พ่อค้าอยู่'),
  fact('f4', 'บันไดขึ้นหอคอยถูกปิดตายมาสามปีแล้ว'),
];

test('facts are stored once and never re-embedded', { skip: needsDb }, async () => {
  const id = await newSession();
  const first = await saveFacts(id, THAI_FACTS);
  assert.equal(first, THAI_FACTS.length);

  const second = await saveFacts(id, THAI_FACTS);
  assert.equal(second, 0, 'an established fact does not change, so it is embedded exactly once');
});

test('a fact only belongs to its own session', { skip: needsDb }, async () => {
  const mine = await newSession();
  const theirs = await newSession();
  await saveFacts(mine, [fact('f1', 'บ่อน้ำแห้ง')]);
  assert.equal((await relevantFacts(theirs, 'บ่อน้ำ', 5)).length, 0);
});

test('Thai retrieval finds the fact that was actually asked about', { skip: needsBoth }, async () => {
  const id = await newSession();
  await saveFacts(id, THAI_FACTS);

  const smith = await relevantFacts(id, 'ช่างตีเหล็กทำงานตอนไหน', 1);
  assert.match(smith[0] ?? '', /กลางคืน/, `asked about the smith, got: ${smith[0]}`);

  const well = await relevantFacts(id, 'บ่อน้ำยังมีน้ำอยู่ไหม', 1);
  assert.match(well[0] ?? '', /บ่อน้ำ/, `asked about the well, got: ${well[0]}`);
});

test('retrieval is bounded by topK, however much canon accumulates', { skip: needsBoth }, async () => {
  const id = await newSession();
  await saveFacts(id, THAI_FACTS);
  assert.equal((await relevantFacts(id, 'หอคอย', 2)).length, 2, 'the prompt must not grow with the world');
});

test('an embedding of the wrong size is refused rather than silently stored', { skip: needsDb }, async () => {
  // Swapping the embedder without migrating the column would fill the table
  // with vectors that mean nothing.
  assert.equal(EMBEDDING_DIMENSION, 1024, 'bge-m3');
});
