import { execFile } from 'node:child_process';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);

/**
 * `npm run build` shells out to `tsx src/db/cli.ts migrate` before `next build`.
 * Vercel sets NODE_ENV=production for that whole step, so the CLI must migrate
 * unconditionally — otherwise a fresh production database ships empty while the
 * command still prints "✓ migrations applied". (This regressed once for real.)
 */
describe('db CLI under NODE_ENV=production', () => {
  it('applies migrations to an empty database', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'bys-mig-'));
    try {
      const { stdout } = await run(
        process.execPath,
        ['node_modules/tsx/dist/cli.mjs', 'src/db/cli.ts', 'migrate'],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            NODE_ENV: 'production',
            PGLITE_DIR: dir,
            DATABASE_URL: '', // keep it on the local driver
            VITEST: '', // don't let the test runner flip the driver to in-memory
          },
          timeout: 120_000,
        },
      );
      expect(stdout).toContain('migrations applied');

      // A migrated PGlite directory contains the catalog and at least one
      // applied migration; an empty one does not.
      const entries = await readdir(dir);
      expect(entries).toContain('PG_VERSION');

      const { PGlite } = await import('@electric-sql/pglite');
      const pg = new PGlite(dir);
      try {
        const res = await pg.query<{ n: number }>(
          'select count(*)::int as n from drizzle.__drizzle_migrations',
        );
        expect(Number(res.rows[0]?.n ?? 0)).toBeGreaterThan(0);
      } finally {
        await pg.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 150_000);
});
