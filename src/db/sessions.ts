import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, gt, max, sql } from 'drizzle-orm';
import { initialPlayState } from '../play/state.ts';
import type { SheetRecord } from '../play/sheetaction.ts';
import { foldPlay } from '../play/delta.ts';
import type { PlayEvent, PlayState, TurnRecord } from '../play/state.ts';
import type { CharacterSheet } from '../session/sheet.ts';
import type { World } from '../world/types.ts';
import { getDb, inTransaction } from './db.ts';
import { events, sessions, snapshots } from './schema.ts';

/**
 * Sessions, stored as an append-only log.
 *
 * The log is the source of truth and `PlayState` is a fold over it. Snapshots
 * exist only so a hundred-turn session does not replay from turn one on every
 * load — deleting every snapshot must change nothing except how long loading
 * takes, and there is a test that says exactly that.
 */

/** How often to cache the fold. Cheap to write, and bounds replay on load. */
export const SNAPSHOT_EVERY = 20;

export type SessionSummary = {
  id: string;
  seed: number;
  language: 'th' | 'en';
  premise: string;
  characterName: string;
  turns: number;
  updatedAt: Date;
};

export async function createSession(
  world: World,
  sheet: CharacterSheet,
  premise: string,
): Promise<string> {
  const id = randomUUID();
  await inTransaction(async (tx) => {
    await tx.insert(sessions).values({ id, seed: world.seed, language: world.language, premise, sheet });
    // Seq 0 is the world as generated, before anything happened to it.
    await tx.insert(events).values({ sessionId: id, seq: 0, kind: 'start', payload: { world } });
  });
  return id;
}

/**
 * Append one turn.
 *
 * Sequence numbers are allocated inside the insert so they stay dense and
 * gap-free — they ARE the replay order, and the primary key rejects a duplicate
 * rather than letting two writers silently interleave.
 */
export async function appendTurn(sessionId: string, record: TurnRecord | SheetRecord): Promise<number> {
  const db = getDb();
  const inserted = await db
    .insert(events)
    .values({
      sessionId,
      seq: sql<number>`(SELECT COALESCE(MAX(e.seq), 0) + 1 FROM ${events} e WHERE e.session_id = ${sessionId})`,
      kind: record.kind,
      payload: record as never,
    })
    .returning({ seq: events.seq });

  await db.update(sessions).set({ updatedAt: new Date() }).where(eq(sessions.id, sessionId));
  return inserted[0].seq;
}

/** Event kinds `foldPlay` knows how to apply. */
const FOLDED_KINDS = new Set(['turn', 'sheet']);

export async function loadEvents(sessionId: string, afterSeq = -1): Promise<PlayEvent[]> {
  const rows = await getDb()
    .select({ kind: events.kind, payload: events.payload })
    .from(events)
    .where(and(eq(events.sessionId, sessionId), gt(events.seq, afterSeq)))
    .orderBy(events.seq);

  // Everything the fold understands, and nothing else — the origin at seq 0 is
  // the starting state, not something to replay over itself.
  //
  // This was `kind === 'turn'` alone, which wrote panel actions to the log and
  // then silently dropped them on the way back: points spent and nodes taken
  // vanished on reload. Adding an event kind means adding it here.
  return rows
    .filter((row) => FOLDED_KINDS.has(row.kind))
    .map((row) => row.payload as PlayEvent);
}

/**
 * Snapshot the CURRENT state, labelled with the sequence it actually reflects.
 *
 * The sequence is read from the log rather than supplied, because a mislabelled
 * snapshot corrupts a save silently: loading replays the turns after the claimed
 * seq a second time, on top of a state that already contains them.
 */
export async function saveSnapshot(sessionId: string, state: PlayState): Promise<number> {
  const [row] = await getDb()
    .select({ seq: max(events.seq) })
    .from(events)
    .where(eq(events.sessionId, sessionId));

  const atSeq = row?.seq ?? 0;
  await saveSnapshotAt(sessionId, atSeq, state);
  return atSeq;
}

/**
 * Snapshot a state at an explicit sequence.
 *
 * Only correct when `state` is precisely the fold of events 0..atSeq. Prefer
 * `saveSnapshot`, which cannot get that wrong.
 */
export async function saveSnapshotAt(sessionId: string, atSeq: number, state: PlayState): Promise<void> {
  await getDb()
    .insert(snapshots)
    .values({ sessionId, atSeq, world: state.world, pc: state.pc, sheet: state.sheet, ended: state.ended })
    .onConflictDoUpdate({
      target: [snapshots.sessionId, snapshots.atSeq],
      set: { world: state.world, pc: state.pc, sheet: state.sheet, ended: state.ended },
    });
}

export type LoadedSession = { state: PlayState; lastSeq: number; replayed: number };

/**
 * Rebuild a session: newest snapshot, then replay everything after it.
 *
 * With no snapshots this replays the whole log and reaches exactly the same
 * state — a snapshot is an optimisation, never a second source of truth.
 */
export async function loadSession(sessionId: string): Promise<LoadedSession | null> {
  const db = getDb();

  const [session] = await db
    .select({ sheet: sessions.sheet })
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  if (!session) return null;

  const [origin] = await db
    .select({ payload: events.payload })
    .from(events)
    .where(and(eq(events.sessionId, sessionId), eq(events.seq, 0)));
  if (!origin) return null;

  const [snapshot] = await db
    .select({
      atSeq: snapshots.atSeq, world: snapshots.world, pc: snapshots.pc,
      sheet: snapshots.sheet, ended: snapshots.ended,
    })
    .from(snapshots)
    .where(eq(snapshots.sessionId, sessionId))
    .orderBy(desc(snapshots.atSeq))
    .limit(1);

  const sheet = session.sheet;
  const start: PlayState = snapshot
    ? {
        world: snapshot.world,
        // Snapshots taken before these were stored fall back to the opening
        // sheet and an unfinished run, which is what they used to mean.
        sheet: snapshot.sheet ?? sheet,
        // And the same for a field added to `pc` later. A snapshot written
        // before skill uses were tracked restores a pc without the map, and
        // the play page threw a 500 on it — the run became unopenable rather
        // than merely missing a number. Nothing spent is what it used to mean.
        pc: { ...snapshot.pc, skillUses: snapshot.pc.skillUses ?? {} },
        combat: null,
        ended: snapshot.ended ?? null,
      }
    : {
        world: (origin.payload as { world: World }).world,
        sheet,
        pc: initialPlayState((origin.payload as { world: World }).world, sheet).pc,
        // A fight is never persisted: it is resolved within the turn that
        // started it, and a half-finished one is not a thing to restore.
        combat: null,
        ended: null,
      };

  const afterSeq = snapshot ? snapshot.atSeq : 0;
  const replay = await loadEvents(sessionId, afterSeq);

  const [last] = await db
    .select({ seq: max(events.seq) })
    .from(events)
    .where(eq(events.sessionId, sessionId));

  return { state: foldPlay(start, replay), lastSeq: last?.seq ?? 0, replayed: replay.length };
}

export async function listSessions(limit = 20): Promise<SessionSummary[]> {
  const turns = getDb()
    .select({ sessionId: events.sessionId, turns: count().as('turns') })
    .from(events)
    .where(eq(events.kind, 'turn'))
    .groupBy(events.sessionId)
    .as('turns');

  const rows = await getDb()
    .select({
      id: sessions.id,
      seed: sessions.seed,
      language: sessions.language,
      premise: sessions.premise,
      updatedAt: sessions.updatedAt,
      characterName: sql<string>`${sessions.sheet}->>'name'`,
      turns: turns.turns,
    })
    .from(sessions)
    .leftJoin(turns, eq(turns.sessionId, sessions.id))
    .orderBy(desc(sessions.updatedAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    seed: Number(row.seed),
    language: row.language as 'th' | 'en',
    premise: row.premise,
    characterName: row.characterName ?? '',
    turns: Number(row.turns ?? 0),
    updatedAt: row.updatedAt,
  }));
}

export async function deleteSession(sessionId: string): Promise<void> {
  await getDb().delete(sessions).where(eq(sessions.id, sessionId));
}

/** Snapshot on a cadence so loading stays fast without writing one per turn. */
export const shouldSnapshot = (seq: number): boolean => seq > 0 && seq % SNAPSHOT_EVERY === 0;
