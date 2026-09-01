import { sql } from 'drizzle-orm';
import {
  bigint, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid, vector,
} from 'drizzle-orm/pg-core';
import type { PlayState, TurnRecord } from '../play/state.ts';
import type { CharacterSheet } from '../session/sheet.ts';
import type { World } from '../world/types.ts';

/**
 * The database schema, as TypeScript.
 *
 * This is now the single source of truth for the tables — `drizzle-kit` derives
 * migrations from it, so the schema and the queries can no longer drift apart.
 *
 * The shape is unchanged from the hand-written SQL it replaces: an append-only
 * event log is the source of truth, snapshots are a disposable cache of the
 * fold, and facts carry their embedding so the canon guard has a real index.
 */

/** bge-m3. A different embedder means a different width, and a migration. */
export const EMBEDDING_DIMENSION = 1024;

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey(),
  seed: bigint('seed', { mode: 'number' }).notNull(),
  language: text('language').notNull(),
  premise: text('premise').notNull().default(''),
  /** Mutable: levelling and personality drift will rewrite this. */
  sheet: jsonb('sheet').$type<CharacterSheet>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('sessions_updated_idx').on(t.updatedAt.desc())]);

export const events = pgTable('events', {
  sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  /** Dense and gap-free per session: this IS the replay order. */
  seq: integer('seq').notNull(),
  kind: text('kind').notNull(),
  /** A TurnRecord, or `{ world }` for the origin event at seq 0. */
  payload: jsonb('payload').$type<TurnRecord | { world: World }>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.sessionId, t.seq] }),
  index('events_session_seq_idx').on(t.sessionId, t.seq.desc()),
]);

export const snapshots = pgTable('snapshots', {
  sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  /** The state after applying every event up to and including this seq. */
  atSeq: integer('at_seq').notNull(),
  world: jsonb('world').$type<World>().notNull(),
  pc: jsonb('pc').$type<PlayState['pc']>().notNull(),
  /**
   * The rest of the fold.
   *
   * A snapshot is only a cache if it is LOSSLESS — otherwise loading a session
   * disagrees with replaying it. These two were originally left out, which lost
   * the counters traits gate on and forgot that a run had ended, so a defeated
   * character got up and walked away.
   *
   * Nullable because snapshots written before they existed have to keep loading;
   * `combat` is genuinely absent, since a fight resolves inside its own turn.
   */
  sheet: jsonb('sheet').$type<PlayState['sheet']>(),
  ended: jsonb('ended').$type<PlayState['ended']>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.sessionId, t.atSeq] })]);

export const facts = pgTable('facts', {
  sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  factId: text('fact_id').notNull(),
  text: text('text').notNull(),
  region: text('region'),
  establishedTurn: integer('established_turn').notNull().default(0),
  embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSION }),
}, (t) => [
  primaryKey({ columns: [t.sessionId, t.factId] }),
  // Cosine, matching how similarity is scored everywhere else in the codebase.
  index('facts_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
]);

/** pgvector must exist before the facts table can be created. */
export const ENSURE_VECTOR_EXTENSION = sql`CREATE EXTENSION IF NOT EXISTS vector`;
