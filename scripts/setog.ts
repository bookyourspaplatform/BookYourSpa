import { getDb } from '../src/db/index';
import { settings } from '../src/db/schema';
import { eq } from 'drizzle-orm';
async function main() {
  const db = await getDb();
  await db.update(settings).set({ value: '' }).where(eq(settings.key, 'seo.ogImage'));
  const row = await db.query.settings.findFirst({ where: eq(settings.key, 'seo.ogImage') });
  console.log('seo.ogImage =', JSON.stringify(row?.value));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
