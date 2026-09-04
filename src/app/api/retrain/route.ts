import { NextResponse } from "next/server";
import { ML_BASE_URL } from "@/lib/trustrail-internal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/retrain
 * Proxy to Python ML service /retrain endpoint (Phase 7).
 * Retrains all 3 models using feedback-extended data.
 */
export async function POST() {
  try {
    const res = await fetch(`${ML_BASE_URL}/retrain`, {
      method: "POST",
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`ML service: ${res.status} ${res.statusText} — ${text}`);
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/retrain] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
