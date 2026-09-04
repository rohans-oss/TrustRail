import { NextRequest, NextResponse } from "next/server";
import { simulateBatch } from "@/lib/trustrail";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/simulate
 * Body: { n: number, scam_rate?: number, seed?: number }
 * Runs N synthetic transactions through the pipeline and persists each decision.
 * Used by the dashboard's simulator to demo edge cases at scale.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { n?: number; scam_rate?: number; seed?: number };
    const n = Math.min(body.n ?? 20, 200);
    const result = await simulateBatch(n, body.scam_rate, body.seed);

    // Persist each decision to Prisma for the live feed
    for (const r of result.responses) {
      try {
        await db.transaction.create({
          data: {
            txnId: r.txn_id,
            timestamp: new Date(r.timestamp),
            stage1Verdict: r.stage1_verdict,
            scamRiskScore: r.scam_risk_score,
            stage1Reasons: JSON.stringify(r.stage1_reasons),
            stage2Recommended: r.stage2_recommended_gateway,
            stage2NaiveRecommend: r.stage2_naive_recommendation,
            pSuccessACausal: r.stage2_counterfactuals.find((c) => c.gateway === "A")!.p_success_causal,
            pSuccessBCausal: r.stage2_counterfactuals.find((c) => c.gateway === "B")!.p_success_causal,
            pSuccessANaive: r.stage2_counterfactuals.find((c) => c.gateway === "A")!.p_success_naive,
            pSuccessBNaive: r.stage2_counterfactuals.find((c) => c.gateway === "B")!.p_success_naive,
            upliftBOverA: r.stage2_uplift_b_over_a,
            finalAction: r.final_action,
            finalActionReason: r.final_action_reason,
            processingMs: r.processing_ms,
            payerId: "sim_payer",
            payeeId: "sim_payee",
            amount: 0, // we don't get this back from the simulator; could be added
            direction: "send",
            hourOfDay: 0,
            approvalLatencyMs: 0,
            isFirstTimePayee: 0,
            isHighRiskMerchant: 0,
            // Ground truth
            pSuccessATrue: r.ground_truth?.p_success_a_true ?? null,
            pSuccessBTrue: r.ground_truth?.p_success_b_true ?? null,
            isScam: r.ground_truth?.is_scam ?? null,
            gatewayActuallyUsed: r.ground_truth?.gateway_chosen ?? null,
            outcome: r.ground_truth?.outcome ?? null,
          },
        });
      } catch (e) {
        // ignore dupes
      }
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/simulate] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
