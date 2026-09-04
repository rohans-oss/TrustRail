import { NextRequest, NextResponse } from "next/server";
import { processTransaction, type TransactionRequest } from "@/lib/trustrail";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/transaction
 * 1. Forward to Python ML service (port 8001 via Caddy XTransformPort)
 * 2. Persist the decision in Prisma so the dashboard can list recent decisions
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as TransactionRequest;
    const decision = await processTransaction(body);

    await db.transaction.create({
      data: {
        txnId: decision.txn_id,
        timestamp: new Date(decision.timestamp),
        stage1Verdict: decision.stage1_verdict,
        scamRiskScore: decision.scam_risk_score,
        stage1Reasons: JSON.stringify(decision.stage1_reasons),
        stage2Recommended: decision.stage2_recommended_gateway,
        stage2NaiveRecommend: decision.stage2_naive_recommendation,
        pSuccessACausal: decision.stage2_counterfactuals.find((c) => c.gateway === "A")!.p_success_causal,
        pSuccessBCausal: decision.stage2_counterfactuals.find((c) => c.gateway === "B")!.p_success_causal,
        pSuccessANaive: decision.stage2_counterfactuals.find((c) => c.gateway === "A")!.p_success_naive,
        pSuccessBNaive: decision.stage2_counterfactuals.find((c) => c.gateway === "B")!.p_success_naive,
        upliftBOverA: decision.stage2_uplift_b_over_a,
        finalAction: decision.final_action,
        finalActionReason: decision.final_action_reason,
        processingMs: decision.processing_ms,
        payerId: body.payer_id,
        payeeId: body.payee_id,
        amount: body.amount,
        direction: body.direction,
        hourOfDay: body.hour_of_day,
        approvalLatencyMs: body.approval_latency_ms,
        isFirstTimePayee: body.is_first_time_payee ?? 0,
        isHighRiskMerchant: body.is_high_risk_merchant ?? 0,
      },
    });

    return NextResponse.json(decision);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/transaction] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
