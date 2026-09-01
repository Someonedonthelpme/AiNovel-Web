import test from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, closeDb, getDb } from './db.ts';
import { isDatabaseUp } from './db.ts';
import { eq } from 'drizzle-orm';
import { events, snapshots } from './schema.ts';
import {
  appendTurn, createSession, deleteSession, listSessions, loadEvents,
  loadSession, saveSnapshot, saveSnapshotAt, shouldSnapshot, SNAPSHOT_EVERY,
} from './sessions.ts';
import { applyDelta, foldPlay } from '../play/delta.ts';
import { awaitingPlayer, beginEncounter, combatOptions, takeCombatAction } from '../play/combat.ts';
import { playState } from '../play/fixtures.ts';
import { sheetRecord } from '../play/sheetaction.ts';
import { skillTreeFor } from '../play/skilltree.ts';
import { groundFloor } from '../world/fixtures.ts';
import type { CombatAction } from '../play/combat.ts';
import type { PlayState, TurnRecord, WorldDelta } from '../play/state.ts';
import type { Region } from '../world/types.ts';

/**
 * Integration tests. They need the Postgres container; without it they skip
 * rather than fail, so `npm test` stays green on a machine with no Docker.
 */
const up = await isDatabaseUp();
if (up) await bootstrap();
const needsDb = up ? false : 'postgres not reachable — skipping integration tests';

const turn = (delta: WorldDelta, prose = ''): TurnRecord => ({
  kind: 'turn', input: 'x', mode: 'conversation', classification: 'NEUTRAL',
  addressed: null, roll: null, delta, rejected: [], prose,
});

const created: string[] = [];
async function newSession() {
  const base = playState();
  const id = await createSession(base.world, base.sheet, 'a tower opened');
  created.push(id);
  return { id, base };
}

test.after(async () => {
  if (up) {
    for (const id of created) await deleteSession(id).catch(() => {});
    await closeDb();
  }
});

test('a session round-trips through the database', { skip: needsDb }, async () => {
  const { id, base } = await newSession();
  const loaded = await loadSession(id);
  assert.ok(loaded);
  assert.equal(loaded.state.world.currentPlace, base.world.currentPlace);
  assert.equal(loaded.state.sheet.name, base.sheet.name);
  assert.equal(loaded.state.pc.hp, base.pc.hp, 'the character comes back at full health');
});

test('replaying the log reproduces the in-memory fold exactly', { skip: needsDb }, async () => {
  const { id, base } = await newSession();
  const log = [
    turn({ trust: { smith: 2 } }),
    turn({ moveTo: 'market' }),
    turn({ learnFacts: ['the forge runs at night'] }),
    turn({ flags: { asked: true } }),
  ];
  for (const record of log) await appendTurn(id, record);

  const loaded = await loadSession(id);
  const inMemory = foldPlay(base, log);

  assert.deepEqual(loaded?.state.world, inMemory.world);
  assert.equal(loaded?.lastSeq, log.length, 'seq 0 is the origin, then one per turn');
});

test('sequence numbers are dense and gap-free', { skip: needsDb }, async () => {
  const { id } = await newSession();
  const seqs: number[] = [];
  for (let i = 0; i < 5; i++) seqs.push(await appendTurn(id, turn({ timeSpent: 1 })));
  assert.deepEqual(seqs, [1, 2, 3, 4, 5]);
});

test('the same seq cannot be written twice', { skip: needsDb }, async () => {
  const { id } = await newSession();
  await appendTurn(id, turn({}));
  // Drizzle wraps driver errors, so the constraint violation is in the cause.
  const reason = await getDb()
    .insert(events)
    .values({ sessionId: id, seq: 1, kind: 'turn', payload: {} as never })
    .then(() => null)
    .catch((e: unknown) => {
      const chain: string[] = [];
      for (let err = e; err instanceof Error; err = err.cause) chain.push(err.message);
      return chain.join(' | ');
    });

  assert.ok(reason, 'a duplicate sequence must be rejected, not silently accepted');
  assert.match(reason, /duplicate key/);
});

test('a snapshot is ONLY a cache — deleting every one changes nothing', { skip: needsDb }, async () => {
  // The central claim of the design: the log is the source of truth. If a
  // snapshot could ever disagree with a replay, there would be two of them.
  const { id } = await newSession();
  const log = [
    turn({ trust: { smith: 3 } }),
    turn({ moveTo: 'market' }),
    turn({ learnFacts: ['the well ran dry'] }),
    turn({ moveTo: 'town' }),
    turn({ trust: { warden: -1 }, flags: { bribed: true } }),
  ];
  for (const record of log) await appendTurn(id, record);

  const mid = await loadSession(id);
  assert.ok(mid);
  await saveSnapshot(id, mid.state);

  const withSnapshot = await loadSession(id);
  await getDb().delete(snapshots).where(eq(snapshots.sessionId, id));
  const withoutSnapshot = await loadSession(id);

  assert.deepEqual(withSnapshot?.state, withoutSnapshot?.state);
  assert.ok(
    (withSnapshot?.replayed ?? 0) < (withoutSnapshot?.replayed ?? 0),
    'the snapshot should at least have saved some replay work',
  );
});

/** A floor with something on it, since nothing hunts at ground level. */
function dangerous(): PlayState {
  const floor: Region = {
    ...groundFloor(),
    id: 'floor-2', floor: 2, danger: 8, name: 'The Grey Grove', creatures: ['หมาป่าเงา'],
  };
  const base = playState();
  return {
    ...base,
    world: { ...base.world, currentRegion: 'floor-2', regions: { 'floor-2': floor }, currentPlace: 'town' },
  };
}

test('a snapshot carries the whole fold, not just the world', { skip: needsDb }, async () => {
  // Regression: snapshots stored `world` and `pc` only. Counters — which every
  // trait gates on — silently reset, and a run that had ended was forgotten, so
  // a defeated character stood up and walked away.
  const start = dangerous();
  const id = await createSession(start.world, start.sheet, 'a tower opened');
  created.push(id);

  // Fight it out for real, then record the decisions as one turn.
  const actions: CombatAction[] = [];
  let fight = beginEncounter(applyDelta(start, { startCombat: true }));
  for (let i = 0; i < 200 && fight.combat && !fight.combat.over && awaitingPlayer(fight); i++) {
    const [option] = combatOptions(fight);
    if (!option) break;
    actions.push(option.action);
    fight = takeCombatAction(fight, option.action).state;
  }
  await appendTurn(id, { ...turn({ startCombat: true }), combatActions: actions });

  const replayed = await loadSession(id);
  assert.ok(replayed);
  const outcome = replayed.state;
  assert.ok(
    outcome.ended !== null || Object.keys(outcome.sheet.counters).length > 0,
    'the fight has to have left SOMETHING outside the world for this test to mean anything',
  );

  await saveSnapshot(id, outcome);
  const cached = await loadSession(id);

  assert.deepEqual(cached?.state.ended, outcome.ended, 'a finished run stays finished across a reload');
  assert.deepEqual(cached?.state.sheet.counters, outcome.sheet.counters, 'counters survive the cache');
  assert.deepEqual(cached?.state, outcome, 'the cache agrees with the replay in full');
});

test('a panel action survives a reload', { skip: needsDb }, async () => {
  // Regression: sheet events were written to the log and then filtered out on
  // the way back, so a point spent or a node taken looked applied in the
  // browser and was gone the moment the page reloaded.
  const { id, base } = await newSession();
  const tree = skillTreeFor(base.world.seed, base.sheet.background.id, base.sheet.language);
  const firstStep = tree.nodes.find((n) => n.ring === 1)!;

  await appendTurn(id, sheetRecord({ type: 'allocate', node: firstStep.id }));

  const loaded = await loadSession(id);
  assert.ok(loaded?.state.sheet.allocated?.includes(firstStep.id), 'the node should still be taken');
  assert.equal(loaded?.state.sheet.skillPoints, (base.sheet.skillPoints ?? 0) - 1, 'and the point still spent');
});

test('loading from a snapshot replays only what came after it', { skip: needsDb }, async () => {
  const { id } = await newSession();
  for (let i = 0; i < 6; i++) await appendTurn(id, turn({ timeSpent: 1 }));

  const full = await loadSession(id);
  assert.equal(full?.replayed, 6);

  // Snapshot the fold of the first four turns only, so the label is honest.
  const firstFour = foldPlay(playState(), (await loadEvents(id)).slice(0, 4));
  await saveSnapshotAt(id, 4, firstFour);

  const partial = await loadSession(id);
  assert.equal(partial?.replayed, 2, 'only the turns after seq 4');
  assert.deepEqual(partial?.state.world, full?.state.world, 'and it still lands in the same place');
});

test('snapshots are taken on a cadence, not every turn', { skip: needsDb }, () => {
  assert.equal(shouldSnapshot(0), false);
  assert.equal(shouldSnapshot(1), false);
  assert.equal(shouldSnapshot(SNAPSHOT_EVERY), true);
  assert.equal(shouldSnapshot(SNAPSHOT_EVERY * 2), true);
});

test('only turn events are folded; the origin is not replayed as one', { skip: needsDb }, async () => {
  const { id } = await newSession();
  await appendTurn(id, turn({ timeSpent: 1 }));
  const events = await loadEvents(id);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'turn');
});

test('sessions can be listed with enough detail to pick one', { skip: needsDb }, async () => {
  const { id } = await newSession();
  await appendTurn(id, turn({ timeSpent: 1 }));

  const listed = (await listSessions(50)).find((s) => s.id === id);
  assert.ok(listed, 'the new session appears in the list');
  assert.equal(listed.turns, 1);
  assert.equal(listed.premise, 'a tower opened');
  assert.ok(listed.characterName.length > 0);
});

test('deleting a session takes its events and snapshots with it', { skip: needsDb }, async () => {
  const { id } = await newSession();
  await appendTurn(id, turn({ timeSpent: 1 }));
  await saveSnapshot(id, playState());
  await deleteSession(id);

  assert.equal(await loadSession(id), null);
  const orphans = await getDb().select({ seq: events.seq }).from(events).where(eq(events.sessionId, id));
  assert.equal(orphans.length, 0, 'events must not outlive their session');
});

test('an unknown session loads as nothing rather than throwing', { skip: needsDb }, async () => {
  assert.equal(await loadSession('00000000-0000-0000-0000-000000000000'), null);
});
