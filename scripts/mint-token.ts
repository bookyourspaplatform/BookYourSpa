import { getDb } from '../src/db/index';
import { users } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { signSession } from '../src/lib/auth/jwt';

async function main() {
  const email = process.argv[2];
  if (!email) throw new Error('usage: tsx scripts/mint-token.ts <email>');
  const db = await getDb();
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user) throw new Error('no user ' + email);
  const token = await signSession({ sub: user.id, role: user.role, name: user.name, email: user.email });
  console.log(token);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
