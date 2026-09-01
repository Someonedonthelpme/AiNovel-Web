import { defineConfig } from 'drizzle-kit';
import { config } from './src/config.ts';

/**
 * Drizzle owns the schema. Migrations are generated from `src/db/schema.ts`,
 * so the tables and the queries cannot drift apart.
 */
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: config.databaseUrl },
  // pgvector is created by the bootstrap in `db.ts`, not by a migration.
  extensionsFilters: ['postgres_vector'],
  verbose: true,
  strict: true,
});
