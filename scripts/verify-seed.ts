import { getDb } from '../src/db/index';
import * as T from '../src/db/schema';

async function main() {
  const db = await getDb();
  const counts = {
    users: await db.$count(T.users),
    providers: await db.$count(T.providers),
    branches: await db.$count(T.branches),
    treatments: await db.$count(T.treatments),
    branchTreatments: await db.$count(T.branchTreatments),
    therapists: await db.$count(T.therapists),
    schedules: await db.$count(T.schedules),
    agents: await db.$count(T.agents),
    agentRates: await db.$count(T.agentRates),
    coupons: await db.$count(T.coupons),
    promotions: await db.$count(T.promotions),
    bookings: await db.$count(T.bookings),
    payments: await db.$count(T.payments),
    commissions: await db.$count(T.commissions),
    settings: await db.$count(T.settings),
    pages: await db.$count(T.pages),
  };
  console.log(JSON.stringify(counts, null, 2));
  const b = await db.query.bookings.findFirst({ with: { treatment: true, branch: true } });
  console.log('sample:', b?.code, b?.guestEmail, b?.status, b?.totalAmount, b?.currency, '|', b?.treatment?.name, '@', b?.branch?.name);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
