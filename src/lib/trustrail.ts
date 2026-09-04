/**
 * TrustRail — typed client for the Python FastAPI ML service.
 *
 * Two call paths:
 *   - Server-side (Next.js API routes): direct to http://localhost:8001
 *   - Client-side (browser, if ever needed): through Caddy at port 81 with
 *     XTransformPort=8001 query string
 *
 * All current callers are server-side API routes, so we use the direct path.
 */

const ML_PORT = 8001;
const ML_BASE_URL = `http://localhost:${ML_PORT}`;

function buildUrl(path: string, params?: Record<string, string | number | undefined>): string {
  const url = new URL(path, ML_BASE_URL);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

export interface TransactionRequest {
  payer_id: string;
  payee_id: string;
  amount: number;
  direction: "send" | "qr" | "collect";
  hour_of_day: number;
  approval_latency_ms: number;
  payer_typical_amount?: number;
  is_first_time_payee?: number;
  prior_txn_count_to_payee?: number;
  is_high_risk_merchant?: number;
  txn_id?: string;
}

export interface GatewayCounterfactual {
  gateway: "A" | "B";
  p_success_causal: number;
  p_success_naive: number;
  p_success_true: number | null;
}

export interface DecisionReason {
  id: string;
  label: string;
  detail: string;
}

export interface DecisionResponse {
  txn_id: string;
  timestamp: string;
  stage1_verdict: "pass" | "friction" | "hard_block";
  scam_risk_score: number;
  stage1_reasons: DecisionReason[];
  stage2_recommended_gateway: "A" | "B";
  stage2_counterfactuals: GatewayCounterfactual[];
  stage2_uplift_b_over_a: number;
  stage2_naive_recommendation: "A" | "B";
  final_action: "route_to_A" | "route_to_B" | "friction_review" | "hard_block";
  final_action_reason: string;
  processing_ms: number;
  // Item 3 — per-stage latency in ms
  stage1_ms?: number;
  stage2_ms?: number;
}

export interface StatsResponse {
  data_summary: {
    n_transactions: number;
    scam_rate: number;
    gateway_a_share: number;
    gateway_b_share: number;
    naive_success_rate_a: number;
    naive_success_rate_b: number;
    true_avg_p_success_a: number;
    true_avg_p_success_b: number;
    confounding_strength: {
      out_of_hours_in_B_vs_A: number;
      first_time_in_B_vs_A: number;
      amount_z_in_B_vs_A: number;
    };
  };
  intent_model: {
    auc_test: number;
    scam_rate_train: number;
    friction_threshold: number;
    coefficients: Record<string, number>;
  };
  naive_router: {
    n_txns: number;
    n_disagreements_with_oracle: number;
    pct_disagree_with_oracle: number;
    pct_agree_with_oracle: number;
    bias_in_p_a_estimate: number;
    bias_in_p_b_estimate: number;
    expected_success_on_disagreements_naive: number;
    expected_success_on_disagreements_oracle: number;
    uplift_loss_on_disagreements: number;
  };
  causal_router: {
    training_meta: {
      features: string[];
      n_train: number;
      n_folds_cross_fit: number;
      propensity_mean: number;
      propensity_std: number;
      propensity_auc: number;
      ate_b_vs_a_drllearner: number;
      ate_b_vs_a_crossfit: number;
      cate_mean_for_hard_txns: number;
      cate_mean_for_easy_txns: number;
      method: string;
    };
    evaluation: {
      n_total: number;
      n_disagree_naive_vs_causal: number;
      pct_disagree_naive_vs_causal: number;
      on_disagreements: {
        causal_matches_oracle_pct: number;
        naive_matches_oracle_pct: number;
        expected_success_naive: number;
        expected_success_causal: number;
        uplift_gain_from_causal: number;
      };
      overall_expected_success: {
        naive_router: number;
        causal_router: number;
        oracle_router: number;
        gap_naive_vs_oracle: number;
        gap_causal_vs_oracle: number;
        lift_causal_over_naive: number;
      };
      mean_abs_bias_uplift: {
        naive: number;
        causal: number;
      };
      mean_signed_bias_per_gateway: {
        p_a_naive: number;
        p_a_causal: number;
        p_b_naive: number;
        p_b_causal: number;
      };
      uplift_estimate_mean: {
        naive: number;
        causal: number;
        true: number;
      };
      uplift_mse: {
        naive: number;
        causal: number;
      };
      uplift_corr_with_truth: {
        naive: number;
        causal: number;
      };
    };
  };
  recent_decisions: {
    n: number;
    n_hard_blocked: number;
    n_friction_review: number;
    n_routed: number;
    routed_to_a: number;
    routed_to_b: number;
    avg_scam_score: number;
  };
  stress_test?: Array<{
    mode: "easy" | "hard" | "mixed";
    n_train: number;
    n_test: number;
    scam_rate_train: number;
    auc_train: number;
    auc_test: number;
    friction_threshold: number;
    scam_recall_at_threshold: number;
    scam_precision_at_threshold: number;
    scam_f1_at_threshold: number;
    false_positive_rate_at_threshold: number;
    confusion_matrix_at_threshold: { tn: number; fp: number; fn: number; tp: number };
    error?: string;
  }>;
  // Item 3 — per-stage latency percentiles over the last 1000 decisions
  latency?: {
    n_samples: number;
    stage1_ms: { p50: number; p95: number; p99: number; mean: number };
    stage2_ms: { p50: number; p95: number; p99: number; mean: number };
    total_ms: { p50: number; p95: number; p99: number; mean: number };
    sla_targets: {
      stage1_ms_p99: number;
      stage2_ms_p99: number;
      total_ms_p99: number;
    };
  };
  // Item 4 — drift status (full report on /api/drift)
  drift?: {
    last_check: string | null;
    severity: "OK" | "WARN" | "BREACH" | string;
    note?: string;
    error?: string;
    active_versions?: {
      intent_risk?: { version: string; trainedAt: string; trainingDataRows: number } | null;
      naive_router?: { version: string; trainedAt: string; trainingDataRows: number } | null;
      causal_router?: { version: string; trainedAt: string; trainingDataRows: number } | null;
    };
  };
}

export interface SimulateBatchResponse {
  n: number;
  responses: Array<DecisionResponse & {
    ground_truth?: {
      gateway_chosen: string;
      outcome: number;
      p_success_a_true: number;
      p_success_b_true: number;
      is_scam: number;
    };
  }>;
}

async function callML<T>(path: string, init?: RequestInit): Promise<T> {
  const url = buildUrl(path);
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    // Always fetch fresh — never cache live ML decisions
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ML service call failed: ${res.status} ${res.statusText} — ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function processTransaction(req: TransactionRequest): Promise<DecisionResponse> {
  return callML<DecisionResponse>("/transaction", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function getStats(): Promise<StatsResponse> {
  return callML<StatsResponse>("/stats");
}

export async function getRecentDecisions(limit: number = 50): Promise<{ transactions: DecisionResponse[] }> {
  return callML<{ transactions: DecisionResponse[] }>(`/transactions/recent?limit=${limit}`);
}

export async function simulateBatch(n: number, scamRate?: number, seed?: number): Promise<SimulateBatchResponse> {
  return callML<SimulateBatchResponse>("/simulate/batch", {
    method: "POST",
    body: JSON.stringify({ n, scam_rate: scamRate, seed }),
  });
}
