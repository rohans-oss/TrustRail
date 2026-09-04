import { NextRequest, NextResponse } from "next/server";
import { ML_BASE_URL } from "@/lib/trustrail-internal";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface FeedbackBody {
  txn_id: string;
  gateway_actually_used: string;
  outcome: number;
  failure_reason?: string;
  source?: "observed_outcome" | "human_labeled" | "model_estimate";
  is_scam?: number | null;
}

/**
 * POST /api/feedback
 * 1. Proxy to Python ML service /feedback endpoint (so it lands in feedback.jsonl
 *    for the next /retrain run).
 * 2. ALSO persist the feedback fields + feedbackSource to Prisma, so the
 *    Review Queue can mark rows as resolved and the dashboard can show the
 *    real outcome next to the prediction.
 *
 * Critical: source distinguishes "model_estimate" (circular — /retrain skips)
 * from "human_labeled" / "observed_outcome" (safe — /retrain uses).
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as FeedbackBody;
    const source = body.source ?? "observed_outcome";

    // 1. Forward to Python ML service
    const res = await fetch(`${ML_BASE_URL}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, source }),
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`ML service: ${res.status} ${res.statusText} — ${text}`);
    }
    const data = await res.json();

    // 2. Persist to Prisma (best-effort — don't fail the request if DB write fails)
    try {
      await db.transaction.updateMany({
        where: { txnId: body.txn_id },
        data: {
          gatewayActuallyUsed: body.gateway_actually_used,
          outcome: body.outcome,
          failureReason: body.failure_reason ?? "none",
          feedbackSource: source,
          ...(body.is_scam !== null && body.is_scam !== undefined
            ? { isScam: body.is_scam }
            : {}),
        },
      });
    } catch (dbErr) {
      console.warn("[/api/feedback] Prisma update failed (non-fatal):", dbErr);
    }

    return NextResponse.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/feedback] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
