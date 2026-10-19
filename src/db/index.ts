import path from 'node:path';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

/**
 * One application-wide database type. Both drivers we use
 * (`drizzle-orm/node-postgres` in production, `drizzle-orm/pglite` locally)
 * structurally satisfy `PgDatabase<PgQueryResultHKT, schema>`, so every query
 * in the app is typed against a single interface regardless of environment.
 */
export type AppDb = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

export type Tx = Parameters<Parameters<AppDb['transaction']>[0]>[0];

export const MIGRATIONS_FOLDER = path.join(process.cwd(), 'drizzle');

type GlobalWithDb = typeof globalThis & {
  __bysDbPromise?: Promise<AppDb>;
  __bysClose?: () => Promise<void>;
  __bysDir?: string | undefined;
};

/** True when running against an in-process database (local dev / tests). */
export function isLocalDb(): boolean {
  return !process.env.DATABASE_URL;
}

export async function getDb(opts?: { migrate?: boolean }): Promise<AppDb> {
  const g = globalThis as GlobalWithDb;
  if (!g.__bysDbPromise) {
    g.__bysDbPromise = createDb(opts?.migrate === true).catch((err) => {
      // Do not cache failures — the next request should retry.
      g.__bysDbPromise = undefined;
      throw err;
    });
  }
  return g.__bysDbPromise;
}

async function createDb(forceMigrate = false): Promise<AppDb> {
  const url = process.env.DATABASE_URL;
  // The db:migrate / db:seed CLI commands pass `migrate: true`, so an explicit
  // migration request always runs — even with NODE_ENV=production (Vercel build).
  const shouldMigrate =
    forceMigrate ||
    process.env.NODE_ENV !== 'production' ||
    process.env.MIGRATE_ON_BOOT === 'true';

  if (url) {
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { Pool } = await import('pg');
    const pool = new Pool({
      connectionString: url,
      max: Number(process.env.PG_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ...(process.env.PG_SSL === 'true' ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    pool.on('error', (err) => console.error('[db] idle client error', err));
    const g = globalThis as GlobalWithDb;
    g.__bysClose = () => pool.end();
    g.__bysDir = undefined;
    const db = drizzle(pool, { schema });
    if (shouldMigrate)
      await runMigrate(async () => {
        const { migrate } = await import('drizzle-orm/node-postgres/migrator');
        await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      });
    return db;
  }

  // Local development / tests: real Postgres (PGlite) in-process, file-backed.
  const { drizzle } = await import('drizzle-orm/pglite');
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = localDbDir();
  if (dir) {
    // PGlite's node fs adapter does not create parent directories itself.
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dir, { recursive: true });
  }
  const client = new PGlite(dir);
  const db = drizzle(client, { schema });
  const g = globalThis as GlobalWithDb;
  g.__bysClose = () => client.close();
  g.__bysDir = dir;
  if (shouldMigrate) {
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    await runMigrate(() => migrate(db, { migrationsFolder: MIGRATIONS_FOLDER }));
  }
  return db;
}

async function runMigrate(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error('[db] migration failed:', err);
    throw err;
  }
}

/** Small helper — many call sites just want "the db, now". */
export async function db(): Promise<AppDb> {
  return getDb();
}

/** File-backed PGlite directory for this process (`undefined` ⇒ in-memory). */
function localDbDir(): string | undefined {
  return (
    process.env.PGLITE_DIR ??
    (process.env.VITEST
      ? undefined // in-memory per test worker
      : path.join(process.cwd(), '.data', 'local'))
  );
}

/**
 * Wipe the LOCAL database (file-backed PGlite) and re-run migrations.
 * Refuses to run when DATABASE_URL points at a real server.
 */
export async function resetLocalDatabase(): Promise<void> {
  if (process.env.DATABASE_URL) {
    throw new Error('reset is disabled while DATABASE_URL is set — drop/recreate the database in your provider instead.');
  }
  const g = globalThis as GlobalWithDb;
  if (g.__bysClose) await g.__bysClose().catch(() => undefined);
  // Resolve the directory even when this process never opened the db —
  // otherwise a cold `db:reset` skips the wipe and re-opens the old files.
  const dir = g.__bysDir ?? localDbDir();
  if (dir) {
    const { rm } = await import('node:fs/promises');
    await rm(dir, { recursive: true, force: true });
  }
  g.__bysDbPromise = undefined;
  g.__bysClose = undefined;
  // The directory is empty now — migrations are not optional here.
  await getDb({ migrate: true });
}
