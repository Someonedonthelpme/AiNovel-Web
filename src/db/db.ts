import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as runMigrations } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { config } from '../config.ts';
import { sql } from 'drizzle-orm';
import * as schema from './schema.ts';
import { ENSURE_VECTOR_EXTENSION } from './schema.ts';

/**
 * The database connection.
 *
 * Drizzle owns the schema (`schema.ts`) and generates migrations from it, so the
 * tables and the queries are checked against each other at compile time rather
 * than drifting quietly apart.
 *
 * The connection string comes from `DATABASE_URL`; nothing secret lives here.
 */

export type Db = NodePgDatabase<typeof schema>;

let pool: pg.Pool | null = null;
let db: Db | null = null;

export function getDb(): Db {
  if (!db) {
    pool = new pg.Pool({
      connectionString: config.databaseUrl,
      // A local single-player game needs very little, and a small pool surfaces
      // a leaked connection quickly instead of hiding it.
      max: 4,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 4_000,
    });
    // Without this a dropped backend takes the whole process down.
    pool.on('error', (err) => console.error('[db] idle client error:', err.message));
    db = drizzle(pool, { schema });
  }
  return db;
}

export async function closeDb(): Promise<void> {
  const closing = pool;
  pool = null;
  db = null;
  if (closing) await closing.end();
}

/** Is the database actually there? Used to skip integration tests cleanly. */
export async function isDatabaseUp(): Promise<boolean> {
  try {
    await getDb().execute('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

let bootstrapped = false;

/**
 * Arbitrary but fixed: any process migrating this database takes the same lock.
 */
const MIGRATION_LOCK = 728_913_004;

/**
 * Prepare the database: the vector extension first, then migrations.
 *
 * The extension cannot live in a migration, because the `facts` table needs the
 * type to exist before it is created.
 *
 * Migration runs under a Postgres advisory lock. Two processes starting at once
 * — parallel test files, or two app instances — otherwise race and one of them
 * dies on "relation already exists". The in-process flag is not enough, because
 * the contention is between processes.
 */
export async function bootstrap(): Promise<void> {
  if (bootstrapped) return;
  const database = getDb();
  await database.execute(ENSURE_VECTOR_EXTENSION);

  await database.execute(sql`SELECT pg_advisory_lock(${MIGRATION_LOCK})`);
  try {
    await runMigrations(database, { migrationsFolder: 'drizzle' });
  } finally {
    await database.execute(sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK})`);
  }
  bootstrapped = true;
}

/** Run a unit of work in a transaction, rolling back on any failure. */
export const inTransaction = <T>(work: (tx: Parameters<Parameters<Db['transaction']>[0]>[0]) => Promise<T>): Promise<T> =>
  getDb().transaction(work);
