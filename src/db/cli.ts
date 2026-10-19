import { getDb, resetLocalDatabase, type AppDb } from './index';
import { runSeed } from './seed';

async function main() {
  const cmd = process.argv[2] ?? 'migrate';
  const force = process.argv.includes('--force');

  if (cmd === 'migrate') {
    // Explicit migration request: always run, even when NODE_ENV=production
    // (Vercel sets that during `npm run build`, which shells out to this CLI).
    await getDb({ migrate: true });
    console.log('✓ migrations applied');
    return;
  }

  if (cmd === 'seed') {
    await getDb({ migrate: true });
    await runSeed({ force });
    return;
  }

  if (cmd === 'reset') {
    await resetLocalDatabase();
    console.log('✓ database reset (local only)');
    await runSeed({ force: true });
    return;
  }

  console.log(`Usage: tsx src/db/cli.ts <migrate|seed|reset> [--force]
  migrate  apply pending migrations
  seed     insert demo providers, agents, customers and bookings
  reset    wipe the LOCAL database and re-seed (refuses when DATABASE_URL is set)`);
  process.exitCode = 1;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

export type { AppDb };
