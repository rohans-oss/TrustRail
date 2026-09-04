"""
TrustRail — Phase 5: FastAPI service wiring Stage 1 (intent risk) + Stage 2 (causal routing).

Endpoints:
  GET  /health                  -> liveness + model status
  POST /transaction             -> run Stage 1 (scam check) then Stage 2 (causal routing)
  GET  /stats                   -> dashboard headline stats (data + models)
  GET  /transactions/recent     -> recent decisions for the live feed
  GET  /transaction/{txn_id}    -> full decision explainability
  POST /feedback                -> log outcome of a routed transaction (Phase 7)
  POST /simulate/batch          -> run N synthetic transactions for demo
  POST /retrain                 -> retrain models on feedback-extended data (Phase 7)

The /transaction endpoint is the heart of the system:
  Stage 1 (Intent risk)  -> friction / hard_block / pass
  Stage 2 (Causal routing) -> recommended gateway with counterfactual P(success) per gateway

If Stage 1 says "friction" or "hard_block", Stage 2 still runs (we want to know
what we WOULD have routed to) but the final decision is gated by Stage 1.
"""
from __future__ import annotations

import json
import os
import sys
import time
import uuid
from pathlib import Path
from typing import Dict, Any, List, Optional

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Local imports (same folder)
sys.path.insert(0, str(Path(__file__).resolve().parent))
from intent_risk import IntentRiskModel, _build_features
from naive_router import NaiveRouter
from causal_router import CausalRouter, GATEWAYS

ARTIFACTS_DIR = Path(__file__).resolve().parent / "artifacts"
DATA_DIR = Path(__file__).resolve().parent / "data"
FEEDBACK_PATH = DATA_DIR / "feedback.jsonl"
DECISIONS_LOG_PATH = DATA_DIR / "decisions.jsonl"

# ---------------------------------------------------------------------------
# Load models at startup (with fallback to training if artifacts missing)
# ---------------------------------------------------------------------------

def _load_or_train_intent() -> IntentRiskModel:
    try:
        return IntentRiskModel.load()
    except Exception:
        from intent_risk import train_and_save
        train_and_save()
        return IntentRiskModel.load()

def _load_or_train_naive() -> NaiveRouter:
    try:
        return NaiveRouter.load()
    except Exception:
        from naive_router import train_and_save
        train_and_save()
        return NaiveRouter.load()

def _load_or_train_causal() -> CausalRouter:
    try:
        return CausalRouter.load()
    except Exception:
        from causal_router import train_and_save
        train_and_save()
        return CausalRouter.load()


print("Loading TrustRail models...")
intent_model = _load_or_train_intent()
naive_router = _load_or_train_naive()
causal_router = _load_or_train_causal()

# Load the training data for context (e.g., recent transactions feed)
TRAIN_DF = pd.read_csv(DATA_DIR / "transactions.csv")
TRAIN_DF["timestamp"] = pd.to_datetime(TRAIN_DF["timestamp"])
TRAIN_DF = TRAIN_DF.sort_values("timestamp").reset_index(drop=True)

# Pre-compute summaries
with open(ARTIFACTS_DIR / "causal_summary.json") as f:
    CAUSAL_SUMMARY = json.load(f)
with open(ARTIFACTS_DIR / "naive_summary.json") as f:
    NAIVE_SUMMARY = json.load(f)
with open(ARTIFACTS_DIR / "intent_summary.json") as f:
    INTENT_SUMMARY = json.load(f)
with open(DATA_DIR / "summary.json") as f:
    DATA_SUMMARY = json.load(f)

# Ensure logs exist
FEEDBACK_PATH.touch(exist_ok=True)
DECISIONS_LOG_PATH.touch(exist_ok=True)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class TransactionRequest(BaseModel):
    """A single transaction to evaluate through the pipeline."""
    payer_id: str
    payee_id: str
    amount: float = Field(..., gt=0, description="Amount in INR (or any currency)")
    direction: str = Field("send", pattern="^(send|qr|collect)$")
    hour_of_day: int = Field(..., ge=0, le=23)
    approval_latency_ms: int = Field(..., ge=0)
    # Optional context — if missing, we'll derive from the historical record
    payer_typical_amount: Optional[float] = None
    is_first_time_payee: Optional[int] = None
    prior_txn_count_to_payee: Optional[int] = None
    is_high_risk_merchant: Optional[int] = 0
    # For demo: allow forcing the txn_id so the dashboard can reference it
    txn_id: Optional[str] = None


class GatewayCounterfactual(BaseModel):
    gateway: str
    p_success_causal: float
    p_success_naive: float  # shown for contrast
    p_success_true: Optional[float] = None  # only if ground truth available (demo)


class DecisionResponse(BaseModel):
    txn_id: str
    timestamp: str
    # Stage 1 — intent risk
    stage1_verdict: str  # "pass" | "friction" | "hard_block"
    scam_risk_score: float
    stage1_reasons: List[Dict[str, str]]
    # Stage 2 — causal routing
    stage2_recommended_gateway: str
    stage2_counterfactuals: List[GatewayCounterfactual]
    stage2_uplift_b_over_a: float
    stage2_naive_recommendation: str  # for contrast
    # Final action
    final_action: str  # "route_to_A" | "route_to_B" | "friction_review" | "hard_block"
    final_action_reason: str
    # Diagnostics — per-stage latency (Item 3)
    stage1_ms: float          # intent-risk inference time
    stage2_ms: float          # causal routing inference time
    processing_ms: float      # total end-to-end (stage1 + stage2 + overhead)


class FeedbackRequest(BaseModel):
    """Feedback logged after a routed transaction's outcome is known.

    The `source` field is CRITICAL for retrain integrity:
      - "observed_outcome" : real gateway callback → safe to retrain on
      - "human_labeled"    : analyst manually reviewed → safe to retrain on
      - "model_estimate"   : outcome was sampled from the model's OWN prediction
                             (used to be the default behavior, but it creates a
                             circular feedback loop and adds no real signal).
                             /retrain will SKIP these rows.
    """
    txn_id: str
    gateway_actually_used: str  # "A" or "B"
    outcome: int  # 1 success, 0 failure
    failure_reason: Optional[str] = "none"
    source: str = Field(
        default="observed_outcome",
        pattern="^(observed_outcome|human_labeled|model_estimate)$",
    )
    is_scam: Optional[int] = None  # 0 or 1, if the reviewer confirmed fraud/no-fraud


class SimulateBatchRequest(BaseModel):
    n: int = Field(20, ge=1, le=500)
    scam_rate: Optional[float] = None  # if None, use the data generator's default
    seed: Optional[int] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _row_from_request(req: TransactionRequest) -> pd.DataFrame:
    """Convert a request into a single-row DataFrame matching the training schema."""
    # Derive defaults from request + training data context
    payer_typical = req.payer_typical_amount
    if payer_typical is None:
        # Look up the payer in training data; fallback to median
        hist = TRAIN_DF[TRAIN_DF["payer_id"] == req.payer_id]
        if len(hist) > 0:
            payer_typical = float(hist["payer_typical_amount"].iloc[0])
        else:
            payer_typical = float(TRAIN_DF["payer_typical_amount"].median())

    is_first_time = req.is_first_time_payee
    if is_first_time is None:
        hist = TRAIN_DF[
            (TRAIN_DF["payer_id"] == req.payer_id) &
            (TRAIN_DF["payee_id"] == req.payee_id)
        ]
        is_first_time = 0 if len(hist) > 0 else 1

    prior_count = req.prior_txn_count_to_payee
    if prior_count is None:
        hist = TRAIN_DF[
            (TRAIN_DF["payer_id"] == req.payer_id) &
            (TRAIN_DF["payee_id"] == req.payee_id)
        ]
        prior_count = len(hist)

    amount_z = float(np.log1p(req.amount) - np.log1p(payer_typical))
    is_out_of_hours = 1 if req.hour_of_day < 8 or req.hour_of_day >= 21 else 0

    # For approval_latency_z, we use the payer's history if available, else 0
    payer_hist = TRAIN_DF[TRAIN_DF["payer_id"] == req.payer_id]
    if len(payer_hist) >= 2:
        latencies = payer_hist["approval_latency_ms"].values
        approval_latency_z = float(
            (req.approval_latency_ms - latencies.mean()) / (latencies.std(ddof=0) + 1e-6)
        )
    else:
        approval_latency_z = 0.0

    is_suspiciously_fast = 1 if approval_latency_z < -1.2 else 0
    amount_vs_typical_ratio = req.amount / max(payer_typical, 1.0)

    row = pd.DataFrame([{
        "txn_id": req.txn_id or f"live_{uuid.uuid4().hex[:8]}",
        "timestamp": pd.Timestamp.now().isoformat(),
        "payer_id": req.payer_id,
        "payee_id": req.payee_id,
        "amount": float(req.amount),
        "direction": req.direction,
        "hour_of_day": int(req.hour_of_day),
        "is_out_of_hours": float(is_out_of_hours),
        "is_first_time_payee": float(is_first_time),
        "is_high_risk_merchant": float(req.is_high_risk_merchant or 0),
        "prior_txn_count_to_payee": int(prior_count),
        "payer_typical_amount": float(payer_typical),
        "amount_vs_typical_ratio": float(amount_vs_typical_ratio),
        "approval_latency_ms": int(req.approval_latency_ms),
        "amount_z": float(amount_z),
        "approval_latency_z": float(approval_latency_z),
        "is_suspiciously_fast_approval": int(is_suspiciously_fast),
    }])
    return row


def _process_transaction(req: TransactionRequest) -> DecisionResponse:
    t0 = time.time()
    row = _row_from_request(req)
    txn_id = str(row["txn_id"].iloc[0])
    timestamp = str(row["timestamp"].iloc[0])

    # --- Stage 1: Intent risk ---
    t_stage1_start = time.time()
    intent_pred = intent_model.predict(row)
    t_stage1_ms = (time.time() - t_stage1_start) * 1000

    stage1_verdict = str(intent_pred["verdict"].iloc[0])
    scam_risk_score = float(intent_pred["scam_risk_score"].iloc[0])
    reasons = intent_pred["reasons"].iloc[0]

    # --- Stage 2: Causal routing ---
    t_stage2_start = time.time()
    causal_pred = causal_router.counterfactual_success(row)
    naive_pred = naive_router.predict_proba_per_gateway(row)
    t_stage2_ms = (time.time() - t_stage2_start) * 1000

    p_a_causal = float(causal_pred["p_success_a_causal"].iloc[0])
    p_b_causal = float(causal_pred["p_success_b_causal"].iloc[0])
    uplift = float(causal_pred["uplift_b_over_a_causal"].iloc[0])
    recommended = str(causal_pred["recommended_gateway_causal"].iloc[0])
    naive_recommended = str(naive_pred["recommended_gateway_naive"].iloc[0])

    counterfactuals = [
        GatewayCounterfactual(
            gateway="A",
            p_success_causal=p_a_causal,
            p_success_naive=float(naive_pred["p_success_a_naive"].iloc[0]),
        ),
        GatewayCounterfactual(
            gateway="B",
            p_success_causal=p_b_causal,
            p_success_naive=float(naive_pred["p_success_b_naive"].iloc[0]),
        ),
    ]

    # --- Final action ---
    if stage1_verdict == "hard_block":
        final_action = "hard_block"
        final_reason = (
            f"Stage 1 flagged this as a likely social-engineering scam "
            f"(risk score {scam_risk_score:.3f} >= hard-block threshold "
            f"{intent_model.hard_block_threshold}). Transaction blocked before routing."
        )
    elif stage1_verdict == "friction":
        final_action = "friction_review"
        final_reason = (
            f"Stage 1 flagged behavioral risk signals (risk score {scam_risk_score:.3f}). "
            f"Routing paused for human review. If approved, would route to Gateway {recommended} "
            f"(counterfactual P(success|{recommended})={max(p_a_causal, p_b_causal):.3f})."
        )
    else:
        final_action = f"route_to_{recommended}"
        better = "A" if recommended == "A" else "B"
        worse = "B" if recommended == "A" else "A"
        p_better = max(p_a_causal, p_b_causal)
        p_worse = min(p_a_causal, p_b_causal)
        final_reason = (
            f"Stage 1 cleared (risk score {scam_risk_score:.3f}). "
            f"Stage 2 counterfactual analysis: P(success|{better})={p_better:.3f} vs "
            f"P(success|{worse})={p_worse:.3f}, uplift={uplift:+.4f}. "
            f"Routing to Gateway {better}."
        )

    processing_ms = (time.time() - t0) * 1000

    response = DecisionResponse(
        txn_id=txn_id,
        timestamp=timestamp,
        stage1_verdict=stage1_verdict,
        scam_risk_score=scam_risk_score,
        stage1_reasons=reasons,
        stage2_recommended_gateway=recommended,
        stage2_counterfactuals=counterfactuals,
        stage2_uplift_b_over_a=uplift,
        stage2_naive_recommendation=naive_recommended,
        final_action=final_action,
        final_action_reason=final_reason,
        stage1_ms=t_stage1_ms,
        stage2_ms=t_stage2_ms,
        processing_ms=processing_ms,
    )

    # Item 3 — update the latency ring buffer for p50/p95/p99 computation
    _record_latency(t_stage1_ms, t_stage2_ms, processing_ms)

    # Log the decision
    _log_decision(response)
    return response


def _log_decision(resp: DecisionResponse):
    with open(DECISIONS_LOG_PATH, "a") as f:
        f.write(resp.model_dump_json() + "\n")


def _read_decisions(limit: int = 100) -> List[Dict[str, Any]]:
    if not DECISIONS_LOG_PATH.exists():
        return []
    lines = DECISIONS_LOG_PATH.read_text().splitlines()
    out = []
    for line in reversed(lines[-limit:]):
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except Exception:
            continue
    return out


def _load_stress_test_comparison() -> List[Dict[str, Any]]:
    """Load the easy/hard/mixed intent-model comparison if it exists.

    Produced by `python3 stress_test_intent.py`. If the file is missing
    (e.g. user only ran the default training), returns an empty list so
    the dashboard can gracefully omit the section.
    """
    path = ARTIFACTS_DIR / "intent_difficulty_comparison.json"
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text())
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Item 3 — Latency instrumentation: ring buffer of the last N decisions'
# per-stage timings, used to compute p50/p95/p99 on /stats.
# ---------------------------------------------------------------------------

import threading
from collections import deque

_LATENCY_BUFFER_SIZE = 1000
_latency_lock = threading.Lock()
_stage1_latencies_ms: deque = deque(maxlen=_LATENCY_BUFFER_SIZE)
_stage2_latencies_ms: deque = deque(maxlen=_LATENCY_BUFFER_SIZE)
_total_latencies_ms: deque = deque(maxlen=_LATENCY_BUFFER_SIZE)


def _record_latency(stage1_ms: float, stage2_ms: float, total_ms: float) -> None:
    with _latency_lock:
        _stage1_latencies_ms.append(stage1_ms)
        _stage2_latencies_ms.append(stage2_ms)
        _total_latencies_ms.append(total_ms)


def _percentile(values: List[float], p: float) -> float:
    """Compute the p-th percentile (p in [0, 100]) of a list of floats.
    Returns 0.0 for empty input.
    """
    if not values:
        return 0.0
    s = sorted(values)
    k = (len(s) - 1) * (p / 100.0)
    f = int(k)
    c = min(f + 1, len(s) - 1)
    if f == c:
        return s[f]
    return s[f] + (s[c] - s[f]) * (k - f)


def _latency_stats() -> Dict[str, Any]:
    """Return p50/p95/p99 for stage1, stage2, and total latency."""
    with _latency_lock:
        s1 = list(_stage1_latencies_ms)
        s2 = list(_stage2_latencies_ms)
        tot = list(_total_latencies_ms)
    return {
        "n_samples": len(tot),
        "stage1_ms": {
            "p50": _percentile(s1, 50),
            "p95": _percentile(s1, 95),
            "p99": _percentile(s1, 99),
            "mean": sum(s1) / len(s1) if s1 else 0.0,
        },
        "stage2_ms": {
            "p50": _percentile(s2, 50),
            "p95": _percentile(s2, 95),
            "p99": _percentile(s2, 99),
            "mean": sum(s2) / len(s2) if s2 else 0.0,
        },
        "total_ms": {
            "p50": _percentile(tot, 50),
            "p95": _percentile(tot, 95),
            "p99": _percentile(tot, 99),
            "mean": sum(tot) / len(tot) if tot else 0.0,
        },
        # SLA targets — p99 < 100ms is the goal for production routing
        "sla_targets": {
            "stage1_ms_p99": 50.0,
            "stage2_ms_p99": 80.0,
            "total_ms_p99": 150.0,
        },
    }


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="TrustRail — Payment Intelligence API",
    description=(
        "Two-stage payment pipeline:\n"
        "  Stage 1: Pre-approval scam / social-engineering detection (logistic regression)\n"
        "  Stage 2: Counterfactual gateway routing (Doubly-Robust causal estimator)\n\n"
        "Both stages share the same event ingestion + feature store."
    ),
    version="0.1.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "models_loaded": {
            "intent_risk": intent_model.pipeline is not None,
            "naive_router": len(naive_router.models) > 0,
            "causal_router": causal_router.final_A is not None,
        },
        "n_training_txns": int(len(TRAIN_DF)),
    }


@app.post("/transaction", response_model=DecisionResponse)
def process_transaction(req: TransactionRequest):
    return _process_transaction(req)


@app.get("/stats")
def stats():
    """Dashboard headline stats."""
    # Recent decisions stats
    recent = _read_decisions(limit=200)
    n_recent = len(recent)
    if n_recent > 0:
        actions = [d.get("final_action", "?") for d in recent]
        n_blocked = sum(1 for a in actions if a == "hard_block")
        n_friction = sum(1 for a in actions if a == "friction_review")
        n_routed = sum(1 for a in actions if a.startswith("route_to_"))
        routed_to_a = sum(1 for a in actions if a == "route_to_A")
        routed_to_b = sum(1 for a in actions if a == "route_to_B")
        avg_scam_score = float(np.mean([d.get("scam_risk_score", 0) for d in recent]))
    else:
        n_blocked = n_friction = n_routed = routed_to_a = routed_to_b = 0
        avg_scam_score = 0.0

    return {
        "data_summary": DATA_SUMMARY,
        "intent_model": {
            "auc_test": INTENT_SUMMARY.get("auc_test"),
            "scam_rate_train": INTENT_SUMMARY.get("scam_rate_train"),
            "friction_threshold": INTENT_SUMMARY.get("friction_threshold_calibrated"),
            "coefficients": INTENT_SUMMARY.get("coefficients"),
        },
        "naive_router": NAIVE_SUMMARY.get("bias_evaluation", {}),
        "causal_router": {
            "training_meta": CAUSAL_SUMMARY.get("training_meta", {}),
            "evaluation": CAUSAL_SUMMARY.get("evaluation", {}),
        },
        "recent_decisions": {
            "n": n_recent,
            "n_hard_blocked": n_blocked,
            "n_friction_review": n_friction,
            "n_routed": n_routed,
            "routed_to_a": routed_to_a,
            "routed_to_b": routed_to_b,
            "avg_scam_score": avg_scam_score,
        },
        # Item 2 — stress-test comparison: how the intent model performs on
        # easy vs hard vs mixed difficulty distributions. Surfaces honest
        # production expectations instead of just the rosy easy-mode numbers.
        "stress_test": _load_stress_test_comparison(),
        # Item 3 — per-stage latency percentiles (p50/p95/p99) over the last
        # 1000 decisions. Used by the dashboard to show whether the system
        # is meeting its SLA targets.
        "latency": _latency_stats(),
        # Item 4 — model versioning + drift monitoring status
        "drift": _load_drift_status(),
    }


def _load_drift_status() -> Dict[str, Any]:
    """Load the drift snapshot for /stats. Returns minimal info — full report
    is on /drift."""
    try:
        from model_versioning import get_drift_status_snapshot, get_active_version
        snapshot = get_drift_status_snapshot()
        # Add active versions for each model
        snapshot["active_versions"] = {
            "intent_risk": get_active_version("intent_risk"),
            "naive_router": get_active_version("naive_router"),
            "causal_router": get_active_version("causal_router"),
        }
        return snapshot
    except Exception as e:
        return {"error": str(e)}


@app.get("/transactions/recent")
def recent_transactions(limit: int = 50):
    return {"transactions": _read_decisions(limit=limit)}


@app.get("/transaction/{txn_id}")
def get_transaction(txn_id: str):
    # Search in the live decisions log first
    for d in _read_decisions(limit=1000):
        if d.get("txn_id") == txn_id:
            return d
    # Then in the training data (for ground-truth comparison)
    matches = TRAIN_DF[TRAIN_DF["txn_id"] == txn_id]
    if len(matches) == 0:
        raise HTTPException(status_code=404, detail=f"Transaction {txn_id} not found.")
    row = matches.iloc[0:1]
    intent_pred = intent_model.predict(row)
    causal_pred = causal_router.counterfactual_success(row)
    naive_pred = naive_router.predict_proba_per_gateway(row)
    return {
        "txn_id": txn_id,
        "source": "training_data",
        "raw_features": row.iloc[0].to_dict(),
        "ground_truth": {
            "gateway_chosen": str(row["gateway_chosen"].iloc[0]),
            "outcome": int(row["outcome"].iloc[0]),
            "p_success_a_true": float(row["p_success_a_true"].iloc[0]),
            "p_success_b_true": float(row["p_success_b_true"].iloc[0]),
            "is_scam": int(row["is_scam"].iloc[0]),
        },
        "stage1": {
            "verdict": str(intent_pred["verdict"].iloc[0]),
            "scam_risk_score": float(intent_pred["scam_risk_score"].iloc[0]),
            "reasons": intent_pred["reasons"].iloc[0],
        },
        "stage2": {
            "recommended_causal": str(causal_pred["recommended_gateway_causal"].iloc[0]),
            "p_success_a_causal": float(causal_pred["p_success_a_causal"].iloc[0]),
            "p_success_b_causal": float(causal_pred["p_success_b_causal"].iloc[0]),
            "recommended_naive": str(naive_pred["recommended_gateway_naive"].iloc[0]),
            "p_success_a_naive": float(naive_pred["p_success_a_naive"].iloc[0]),
            "p_success_b_naive": float(naive_pred["p_success_b_naive"].iloc[0]),
        },
    }


@app.post("/feedback")
def feedback(req: FeedbackRequest):
    """Log the actual outcome of a routed transaction.

    The `source` field is recorded so /retrain can later filter out
    `model_estimate` rows (which would create a circular feedback loop).
    """
    with open(FEEDBACK_PATH, "a") as f:
        f.write(json.dumps({
            "txn_id": req.txn_id,
            "gateway_actually_used": req.gateway_actually_used,
            "outcome": int(req.outcome),
            "failure_reason": req.failure_reason,
            "source": req.source,
            "is_scam": req.is_scam if req.is_scam is not None else None,
            "logged_at": pd.Timestamp.now().isoformat(),
        }) + "\n")
    return {"status": "logged", "txn_id": req.txn_id, "source": req.source}


@app.post("/simulate/batch")
def simulate_batch(req: SimulateBatchRequest):
    """Run N synthetic transactions for demo purposes."""
    from data_generator import generate_transactions
    df = generate_transactions(
        n=req.n,
        scam_rate=req.scam_rate if req.scam_rate is not None else 0.06,
        seed=req.seed if req.seed is not None else int(time.time()) % 10000,
    )
    # Make txn_ids unique across batches by prefixing with a batch UUID
    # (otherwise Prisma's unique constraint silently drops duplicates and the
    # dashboard's live feed looks smaller than it should).
    batch_uuid = uuid.uuid4().hex[:8]
    df["txn_id"] = df["txn_id"].apply(lambda t: f"sim_{batch_uuid}_{t}")
    # Run each through the pipeline and return the responses
    responses = []
    for _, row in df.iterrows():
        r = _process_transaction(TransactionRequest(
            payer_id=row["payer_id"],
            payee_id=row["payee_id"],
            amount=float(row["amount"]),
            direction=row["direction"],
            hour_of_day=int(row["hour_of_day"]),
            approval_latency_ms=int(row["approval_latency_ms"]),
            payer_typical_amount=float(row["payer_typical_amount"]),
            is_first_time_payee=int(row["is_first_time_payee"]),
            prior_txn_count_to_payee=int(row["prior_txn_count_to_payee"]),
            is_high_risk_merchant=int(row["is_high_risk_merchant"]),
            txn_id=str(row["txn_id"]),
        ))
        responses.append({
            **r.model_dump(),
            "ground_truth": {
                "gateway_chosen": str(row["gateway_chosen"]),
                "outcome": int(row["outcome"]),
                "p_success_a_true": float(row["p_success_a_true"]),
                "p_success_b_true": float(row["p_success_b_true"]),
                "is_scam": int(row["is_scam"]),
            },
        })
    return {"n": len(responses), "responses": responses}


@app.post("/retrain")
def retrain():
    """Retrain models using ONLY human-labeled or observed-outcome feedback.

    ⚠️ Anti-circular-loop contract:
    Rows with `source == "model_estimate"` are SKIPPED. They were generated by
    sampling from the model's own counterfactual estimate, so retraining on
    them would just amplify whatever biases the current model already has.
    Only `human_labeled` and `observed_outcome` rows represent real signal.
    """
    if not FEEDBACK_PATH.exists():
        raise HTTPException(status_code=400, detail="No feedback data available.")
    lines = FEEDBACK_PATH.read_text().splitlines()
    all_records = [json.loads(l) for l in lines if l.strip()]

    # Filter out circular rows
    USABLE_SOURCES = {"human_labeled", "observed_outcome"}
    feedback_records = [r for r in all_records if r.get("source") in USABLE_SOURCES]
    skipped_records = [r for r in all_records if r.get("source") not in USABLE_SOURCES]

    if len(feedback_records) < 50:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Need at least 50 USABLE feedback rows (human_labeled or "
                f"observed_outcome) to retrain; got {len(feedback_records)} "
                f"usable + {len(skipped_records)} skipped (model_estimate). "
                f"Use the Review Queue to log real outcomes."
            ),
        )

    # Overlay usable feedback outcomes on the original training data
    feedback_df = pd.DataFrame(feedback_records)
    extended = TRAIN_DF.merge(
        feedback_df[["txn_id", "gateway_actually_used", "outcome"]],
        on="txn_id", how="left", suffixes=("", "_fb")
    )
    has_fb = extended["gateway_actually_used"].notna()
    extended.loc[has_fb, "gateway_chosen"] = extended.loc[has_fb, "gateway_actually_used"]
    extended.loc[has_fb, "outcome"] = extended.loc[has_fb, "outcome_fb"]
    # If is_scam was provided in feedback, also override the scam label
    if "is_scam" in feedback_df.columns:
        scam_map = feedback_df.set_index("txn_id")["is_scam"].dropna().to_dict()
        for tid, scam_val in scam_map.items():
            mask = extended["txn_id"] == tid
            extended.loc[mask, "is_scam"] = int(scam_val)
    extended = extended.drop(columns=["gateway_actually_used", "outcome_fb"], errors="ignore")

    # Retrain
    global intent_model, naive_router, causal_router
    intent_model = IntentRiskModel()
    intent_meta = intent_model.fit(extended)
    intent_model.save()

    naive_router = NaiveRouter(model_type="gbdt")
    naive_router.fit(extended)
    naive_router.save()

    causal_router = CausalRouter()
    causal_meta = causal_router.fit(extended)
    causal_router.save()

    # ── Item 4: Model versioning + drift monitoring ──────────────────────
    # Record each retrained model as a ModelArtifact row in the Prisma DB.
    # Then compute drift metrics between the new training data and the
    # previous active artifact's training data (if we can recover it).
    versioning_info: Dict[str, Any] = {}
    drift_report: Dict[str, Any] = {}
    try:
        from model_versioning import (
            record_model_artifact,
            get_active_version,
            get_previous_training_data,
            compute_drift_metrics,
            check_propensity_auc_drift,
            save_drift_report,
        )
        import datetime as _dt

        # Capture previous propensity AUC BEFORE we record the new artifact
        prev_causal_artifact = get_active_version("causal_router")
        prev_propensity_auc = (
            prev_causal_artifact["metrics"].get("propensity_auc")
            if prev_causal_artifact else None
        )
        prev_training_df = get_previous_training_data()

        new_version = _dt.datetime.utcnow().strftime("0.1.%Y%m%d%H%M")
        for name, meta, path in [
            ("intent_risk", intent_meta, str(ARTIFACTS_DIR / "intent_risk.joblib")),
            ("naive_router", {
                "auc_a": NAIVE_SUMMARY.get("bias_evaluation", {}).get("bias_in_p_a_estimate"),
                "auc_b": NAIVE_SUMMARY.get("bias_evaluation", {}).get("bias_in_p_b_estimate"),
            }, str(ARTIFACTS_DIR / "naive_router.joblib")),
            ("causal_router", causal_meta, str(ARTIFACTS_DIR / "causal_router.joblib")),
        ]:
            record_model_artifact(name, new_version, meta, extended, path)

        versioning_info = {
            "new_version": new_version,
            "recorded_artifacts": ["intent_risk", "naive_router", "causal_router"],
        }

        # Drift check: feature distributions
        feature_drift: Dict[str, Any] = {}
        if prev_training_df is not None:
            feature_drift = compute_drift_metrics(extended, prev_training_df)
        else:
            feature_drift = {"summary": {"severity": "OK", "note": "First run — no previous data to compare."}}

        # Drift check: propensity AUC (confounding severity)
        propensity_drift = check_propensity_auc_drift(
            causal_meta.get("propensity_auc", 0.0),
            prev_propensity_auc,
        )

        # Overall severity: BREACH > WARN > OK
        severity_priority = {"OK": 0, "WARN": 1, "BREACH": 2}
        overall_severity = max(
            [feature_drift.get("summary", {}).get("severity", "OK"),
             propensity_drift.get("severity", "OK")],
            key=lambda s: severity_priority.get(s, 0),
        )

        drift_report = {
            "last_check": _dt.datetime.utcnow().isoformat(),
            "severity": overall_severity,
            "feature_drift": feature_drift,
            "propensity_auc_drift": propensity_drift,
            "previous_version": prev_causal_artifact.get("version") if prev_causal_artifact else None,
            "previous_trained_at": prev_causal_artifact.get("trainedAt") if prev_causal_artifact else None,
        }
        save_drift_report(drift_report)
    except Exception as e:
        # Versioning is best-effort — don't fail the retrain if the DB write
        # fails. Surface the error in the response.
        versioning_info = {"error": f"versioning failed: {e}"}
        drift_report = {"error": f"drift check failed: {e}"}

    return {
        "status": "retrained",
        "n_training_rows": int(len(extended)),
        "n_feedback_rows_used": int(has_fb.sum()),
        "n_feedback_rows_skipped": len(skipped_records),
        "skipped_reason": (
            f"{len(skipped_records)} rows had source='model_estimate' "
            "(circular) and were skipped."
        ) if skipped_records else None,
        "intent_meta": intent_meta,
        "causal_meta": causal_meta,
        # Item 4 — versioning + drift
        "versioning": versioning_info,
        "drift": drift_report,
    }


@app.get("/drift")
def drift_status():
    """Item 4 — Return the current drift status snapshot.

    Reads from artifacts/drift_report.json (written by /retrain).
    """
    from model_versioning import get_drift_status_snapshot, list_artifact_history
    snapshot = get_drift_status_snapshot()
    snapshot["artifact_history"] = {
        "intent_risk": list_artifact_history("intent_risk"),
        "naive_router": list_artifact_history("naive_router"),
        "causal_router": list_artifact_history("causal_router"),
    }
    return snapshot


@app.get("/")
def root():
    return {
        "name": "TrustRail API",
        "version": "0.1.0",
        "docs": "/docs",
        "endpoints": [
            "POST /transaction",
            "GET /stats",
            "GET /transactions/recent",
            "GET /transaction/{txn_id}",
            "POST /feedback",
            "POST /simulate/batch",
            "POST /retrain",
        ],
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("TRUSTRAIL_PORT", "8001"))
    print(f"TrustRail API starting on port {port}...")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
