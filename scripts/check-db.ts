// Quick DB check
import { db } from "../src/lib/db";

async function main() {
  const count = await db.transaction.count();
  console.log("Transaction count:", count);
  const recent = await db.transaction.findMany({
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { txnId: true, createdAt: true, finalAction: true },
  });
  console.log("Recent 5:", recent);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
