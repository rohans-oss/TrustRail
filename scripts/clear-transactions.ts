// Clear all old demo transactions so the dashboard starts fresh.
import { db } from "../src/lib/db";

async function main() {
  const before = await db.transaction.count();
  console.log(`Transactions before: ${before}`);
  const result = await db.transaction.deleteMany({});
  console.log(`Deleted: ${result.count} rows`);
  const after = await db.transaction.count();
  console.log(`Transactions after: ${after}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
