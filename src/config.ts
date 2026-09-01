/**
 * Configuration, loaded once from the environment.
 *
 * Node 24 reads `.env` natively, so this needs no dependency. Loading is
 * explicit rather than a side effect of importing the database module — a
 * module that silently mutates `process.env` when imported is a module that is
 * hard to test and harder to reason about.
 *
 * Nothing secret is ever defaulted to a real value. The Postgres fallback points
 * at the local dev container and nowhere else.
 */

let loaded = false;

/** Read `.env` if present. Safe to call repeatedly; the first call wins. */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  try {
    process.loadEnvFile('.env');
  } catch {
    // No .env is normal in CI or a fresh clone; the defaults below cover it.
  }
}

const read = (key: string, fallback: string): string => {
  loadEnv();
  const value = process.env[key];
  return value && value.trim() ? value.trim() : fallback;
};

/** The dev container from `docker run --name ainovel-postgres -p 5433:5432`. */
export const DEFAULT_DATABASE_URL = 'postgresql://ainovel:ainovel_dev_local@localhost:5433/ainovel';

export const config = {
  get databaseUrl(): string {
    return read('DATABASE_URL', DEFAULT_DATABASE_URL);
  },
  get localLlmUrl(): string {
    return read('LOCAL_LLM_URL', 'http://192.168.0.108:1234/v1');
  },
  get embedModel(): string {
    return read('LOCAL_EMBED_MODEL', 'text-embedding-bge-m3');
  },
};
