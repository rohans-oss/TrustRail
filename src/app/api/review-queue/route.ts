import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/review-queue?limit=50
 *
 * Lists transactions that have been decided but NOT yet given a real
 * (human_labeled or observed_outcome) feedback label. These are the rows
 * that need analyst review before /retrain can use them.
 *
 * Filters:
 *  - exclude rows where feedbackSource = "human_labeled" or "observed_outcome"
 *  - include rows where feedbackSource IS NULL (never reviewed)
 *  - include rows where feedbackSource = "model_estimate" (circular — needs override)
 *
 * Optional: ?verdict=friction to filter by Stage 1 verdict (the ones most
 * worth reviewing first).
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);
  const verdictFilter = url.searchParams.get("verdict"); // "pass" | "friction" | "hard_block"

  try {
    // Use raw query because Prisma's `NOT IN` on nullable columns is awkward.
    // We want: feedbackSource IS NULL OR feedbackSource = "model_estimate".
    // (Rows with feedbackSource = "human_labeled" / "observed_outcome" are resolved.)
    const whereClause = verdictFilter
      ? `WHERE ("Transaction"."feedbackSource" IS NULL OR "Transaction"."feedbackSource" = 'model_estimate') AND "Transaction"."stage1Verdict" = ?`
      : `WHERE ("Transaction"."feedbackSource" IS NULL OR "Transaction"."feedbackSource" = 'model_estimate')`;
    const params = verdictFilter ? [verdictFilter, limit] : [limit];

    const rows = await db.$queryRawUnsafe<Array<{
      txnId: string;
      timestamp: Date;
      payerId: string;
      payeeId: string;
      amount: number;
      direction: string;
      stage1Verdict: string;
      scamRiskScore: number;
      stage2Recommended: string;
      finalAction: string;
      feedbackSource: string | null;
    }>>(
      `SELECT "txnId", "timestamp", "payerId", "payeeId", "amount", "direction",
              "stage1Verdict", "scamRiskScore", "stage2Recommended", "finalAction",
              "feedbackSource"
       FROM "Transaction"
       ${whereClause}
       ORDER BY "createdAt" DESC
       LIMIT ?`,
      ...params,
    );

    return NextResponse.json({
      transactions: rows,
      n: rows.length,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/review-queue] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
