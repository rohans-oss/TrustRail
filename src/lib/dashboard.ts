/**
 * TrustRail dashboard — shared types and helpers.
 */

export interface DecisionResponse {
  txn_id: string;
  timestamp: string;
  stage1_verdict: "pass" | "friction" | "hard_block";
  scam_risk_score: number;
  stage1_reasons: Array<{ id: string; label: string; detail: string }>;
  stage2_recommended_gateway: "A" | "B";
  stage2_naive_recommendation: "A" | "B";
  stage2_counterfactuals: Array<{
    gateway: "A" | "B";
    p_success_causal: number;
    p_success_naive: number;
    p_success_true: number | null;
  }>;
  stage2_uplift_b_over_a: number;
  final_action: "route_to_A" | "route_to_B" | "friction_review" | "hard_block";
  final_action_reason: string;
  processing_ms: number;
  payer_id?: string;
  payee_id?: string;
  amount?: number;
  direction?: string;
  hour_of_day?: number;
  approval_latency_ms?: number;
  is_first_time_payee?: number;
  is_high_risk_merchant?: number;
}

export const VERDICT_LABELS: Record<string, { label: string; tone: "pass" | "friction" | "block" }> = {
  pass: { label: "Pass", tone: "pass" },
  friction: { label: "Friction", tone: "friction" },
  hard_block: { label: "Hard Block", tone: "block" },
};

export const ACTION_LABELS: Record<string, { label: string; tone: "pass" | "friction" | "block" | "route" }> = {
  route_to_A: { label: "Route → Gateway A", tone: "route" },
  route_to_B: { label: "Route → Gateway B", tone: "route" },
  friction_review: { label: "Hold for Review", tone: "friction" },
  hard_block: { label: "Blocked", tone: "block" },
};

export function fmtPct(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return `${(x * 100).toFixed(digits)}%`;
}

export function fmtNum(x: number | null | undefined, digits = 4): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return x.toFixed(digits);
}

export function fmtSignedPct(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  const sign = x >= 0 ? "+" : "";
  return `${sign}${(x * 100).toFixed(digits)}pp`;
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.max(0, Math.floor((now - then) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}
