import { getDb } from '../src/db/index';
import { bookings } from '../src/db/schema';
import { desc } from 'drizzle-orm';
async function main() {
  const db = await getDb();
  const rows = await db.select({ code: bookings.code, status: bookings.status, paymentStatus: bookings.paymentStatus }).from(bookings).orderBy(desc(bookings.createdAt)).limit(5);
  console.log(JSON.stringify(rows));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
