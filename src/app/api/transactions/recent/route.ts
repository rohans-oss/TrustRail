import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/transactions/recent?limit=50
 * Returns the most recent decisions from the Prisma-backed transaction log.
 * This is what the live feed on the dashboard polls.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") || "50", 10);
  try {
    const rows = await db.transaction.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 200),
    });
    // Reshape to match the dashboard's expected shape
    const transactions = rows.map((r) => ({
      txn_id: r.txnId,
      timestamp: r.timestamp.toISOString(),
      stage1_verdict: r.stage1Verdict,
      scam_risk_score: r.scamRiskScore,
      stage1_reasons: JSON.parse(r.stage1Reasons || "[]"),
      stage2_recommended_gateway: r.stage2Recommended,
      stage2_naive_recommendation: r.stage2NaiveRecommend,
      stage2_counterfactuals: [
        {
          gateway: "A" as const,
          p_success_causal: r.pSuccessACausal,
          p_success_naive: r.pSuccessANaive,
          p_success_true: r.pSuccessATrue,
        },
        {
          gateway: "B" as const,
          p_success_causal: r.pSuccessBCausal,
          p_success_naive: r.pSuccessBNaive,
          p_success_true: r.pSuccessBTrue,
        },
      ],
      stage2_uplift_b_over_a: r.upliftBOverA,
      final_action: r.finalAction,
      final_action_reason: r.finalActionReason,
      processing_ms: r.processingMs,
      // raw inputs for display
      payer_id: r.payerId,
      payee_id: r.payeeId,
      amount: r.amount,
      direction: r.direction,
      hour_of_day: r.hourOfDay,
      approval_latency_ms: r.approvalLatencyMs,
      is_first_time_payee: r.isFirstTimePayee,
      is_high_risk_merchant: r.isHighRiskMerchant,
    }));
    return NextResponse.json({ transactions });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/transactions/recent] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
