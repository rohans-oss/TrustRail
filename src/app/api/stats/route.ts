import { NextResponse } from "next/server";
import { getStats } from "@/lib/trustrail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/stats
 * Proxy to Python ML service /stats endpoint.
 */
export async function GET() {
  try {
    const stats = await getStats();
    return NextResponse.json(stats);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/stats] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
