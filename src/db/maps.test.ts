import test from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { bootstrap, closeDb, getDb, isDatabaseUp } from './db.ts';
import { mapFor } from './maps.ts';
import { maps } from './schema.ts';
import { createSession, deleteSession } from './sessions.ts';
import { playState } from '../play/fixtures.ts';
import type { GameMap } from '../world/map.ts';

/** W2: a map is stored on first entry, and a changed generator never moves it. Needs Postgres. */
const up = await isDatabaseUp();
if (up) await bootstrap();
const needsDb = up ? false : 'postgres not reachable — skipping integration tests';

const created: string[] = [];
async function newSession() {
  const base = playState();
  const id = await createSession(base.world, base.sheet, 'a tower opened');
  created.push(id);
  return id;
}
test.after(async () => {
  if (up) {
    for (const id of created) await deleteSession(id).catch(() => {});
    await closeDb();
  }
});

const first = { id: 'hub:floor-0:town', kind: 'hub', rows: ['..', '.#'] } as GameMap;
const other = { ...first, rows: ['##', '##'] } as GameMap;

test('a map is drawn on first ask and stored; a changed generator gets the stored one', { skip: needsDb }, async () => {
  const id = await newSession();
  assert.deepEqual(await mapFor(id, first.id, () => first), first);
  assert.deepEqual(await mapFor(id, first.id, () => other), first);
});

test('two sessions keep their own copy of the same map id', { skip: needsDb }, async () => {
  const a = await newSession();
  const b = await newSession();
  await mapFor(a, first.id, () => first);
  assert.deepEqual(await mapFor(b, first.id, () => other), other);
  assert.deepEqual(await mapFor(a, first.id, () => other), first);
});

test('deleting a session takes its maps with it', { skip: needsDb }, async () => {
  const id = await newSession();
  await mapFor(id, first.id, () => first);
  await deleteSession(id);
  assert.equal((await getDb().select().from(maps).where(eq(maps.sessionId, id))).length, 0);
});
