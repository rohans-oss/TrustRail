"""
TrustRail — Phase 1: Synthetic data generator with REALISTIC CONFOUNDING.

The single most important artifact in the whole project.
If the confounding isn't realistic, the causal-correction demo has nothing to prove.

Design (intentional biases baked in):
  - Gateway A is the DEFAULT gateway. Operators send "easy, low-risk, in-hours,
    small-amount, known-payee" transactions there disproportionately.
  - Gateway B is the "high-value / out-of-hours / first-time-payee" overflow gateway.
  - Both gateways have DIFFERENT true success functions. Gateway A is genuinely
    better for small in-hours txns; Gateway B is genuinely better for large
    out-of-hours first-time-payee txns. (i.e. neither dominates globally.)
  - Because the operator's routing policy correlates with transaction difficulty,
    a naive classifier trained on (features -> gateway -> outcome) learns
    "Gateway A always succeeds" — a confounded estimate.

Also generates SCAM transactions (social-engineering collect requests) so the
Stage-1 intent-risk model has a target to learn. Scams look technically normal
on transactional signals (real device, real account, approved by user) but have
behavioral red flags: first-time payee + unusually high amount + collect-request
direction + odd hour + unusually fast approval.

Output:
  - data/transactions.csv   (features, gateway_chosen, outcome, scam_label, counterfactuals)
  - data/transactions.parquet (optional, if pyarrow present)

Schema mirrors what the production feature store would expose.
"""
from __future__ import annotations

import json
import os
import random
import uuid
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Any

import numpy as np
import pandas as pd

ARTIFACTS_DIR = Path(__file__).resolve().parent / "artifacts"
DATA_DIR = Path(__file__).resolve().parent / "data"
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

NUM_PAYERS = 2_000
NUM_PAYEES = 5_000
NUM_TXNS_DEFAULT = 12_000
SCAM_RATE = 0.06          # 6% of transactions are social-engineering scams
GATEWAY_A_DEFAULT_RATE = 0.70  # operators default-lean toward gateway A

# True (latent) success probability functions per gateway.
# These are what the causal model should recover. Naive model can't see them.
def true_success_prob_a(features: Dict[str, float]) -> float:
    """Gateway A: better for small, in-hours, repeat-payee, low-amount txns."""
    logit = (
        2.5                                    # baseline (high)
        - 1.8 * features["amount_z"]           # dislikes large amounts
        - 1.5 * features["is_out_of_hours"]    # dislikes odd hours
        - 1.2 * features["is_first_time_payee"]# dislikes first-time payees
        - 0.6 * features["is_high_risk_merchant"]
    )
    return float(1.0 / (1.0 + np.exp(-logit)))

def true_success_prob_b(features: Dict[str, float]) -> float:
    """Gateway B: better for large, out-of-hours, first-time-payee txns."""
    logit = (
        0.4                                    # baseline (lower)
        + 1.6 * features["amount_z"]           # likes large amounts
        + 1.3 * features["is_out_of_hours"]
        + 1.0 * features["is_first_time_payee"]
        - 0.3 * features["is_high_risk_merchant"]
    )
    return float(1.0 / (1.0 + np.exp(-logit)))


@dataclass
class PayerProfile:
    payer_id: str
    typical_amount: float        # log-normal mean
    typical_hour: int            # most active hour
    payees_seen: set[str]


def _make_payers(n: int) -> List[PayerProfile]:
    rng = random.Random(42)
    out = []
    for i in range(n):
        out.append(PayerProfile(
            payer_id=f"payer_{i:05d}",
            typical_amount=float(np.exp(np.random.normal(6.5, 0.8))),  # ~€665 median
            typical_hour=rng.choice([9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]),
            payees_seen=set(),
        ))
    return out


def _make_payee_id(i: int, high_risk_rate: float = 0.08) -> Dict[str, Any]:
    return {
        "payee_id": f"payee_{i:05d}",
        "is_high_risk_merchant": 1.0 if random.random() < high_risk_rate else 0.0,
    }


# ---------------------------------------------------------------------------
# Transaction generator
# ---------------------------------------------------------------------------

def generate_transactions(
    n: int = NUM_TXNS_DEFAULT,
    scam_rate: float = SCAM_RATE,
    gateway_a_default_rate: float = GATEWAY_A_DEFAULT_RATE,
    seed: int = 7,
    difficulty_mode: str = "easy",
) -> pd.DataFrame:
    """Generate synthetic transactions.

    difficulty_mode:
      - "easy"  : original behavior — every scam fires all 4 signals
                  (collect + first_time + high_amount + fast_approval + odd_hour).
                  The intent model gets near-perfect AUC because the patterns
                  are trivially separable.
      - "hard"  : stress-test distribution with three adversarial patterns:
                  (a) partial-signal scams: only 2-3 of the 4 signals present
                  (b) patient scammers: normal approval latency (3-8s) to
                      evade the "suspiciously fast" rule
                  (c) hard negatives: legitimate high-value first-time
                      payments that resemble scams (e.g., security deposit,
                      advance rent, vendor onboarding)
      - "mixed" : 60% easy + 40% hard — the realistic distribution.
    """
    if difficulty_mode not in {"easy", "hard", "mixed"}:
        raise ValueError(f"difficulty_mode must be one of easy/hard/mixed, got {difficulty_mode!r}")

    rng = random.Random(seed)
    np.random.seed(seed)

    payers = _make_payers(NUM_PAYERS)
    payees = [_make_payee_id(i) for i in range(NUM_PAYEES)]

    rows: List[Dict[str, Any]] = []
    start_time = datetime(2025, 1, 1, 0, 0, 0)

    for i in range(n):
        payer = rng.choice(payers)
        # 60% repeat payee (within payer's history), 40% new
        if payer.payees_seen and rng.random() < 0.6:
            payee_id = rng.choice(list(payer.payees_seen))
            is_first_time_payee = 0.0
        else:
            payee = rng.choice(payees)
            payee_id = payee["payee_id"]
            payer.payees_seen.add(payee_id)
            is_first_time_payee = 1.0
        is_high_risk_merchant = next(p["is_high_risk_merchant"] for p in payees if p["payee_id"] == payee_id)

        # Decide if this is a SCAM (social-engineering collect request)
        is_scam = 1.0 if rng.random() < scam_rate else 0.0

        # Pick which scam sub-pattern to use (only in hard/mixed modes)
        if is_scam and difficulty_mode == "easy":
            scam_subpattern = "classic"
        elif is_scam and difficulty_mode in ("hard", "mixed"):
            # 60% classic / 25% partial-signal / 15% patient in "mixed"
            # 25% classic / 40% partial-signal / 35% patient in "hard"
            if difficulty_mode == "mixed":
                scam_subpattern = rng.choices(
                    ["classic", "partial", "patient"],
                    weights=[0.60, 0.25, 0.15],
                )[0]
            else:  # "hard"
                scam_subpattern = rng.choices(
                    ["classic", "partial", "patient"],
                    weights=[0.25, 0.40, 0.35],
                )[0]
        elif not is_scam and difficulty_mode in ("hard", "mixed"):
            # Inject hard negatives: legitimate transactions that look like scams.
            # In mixed mode, only ~3% of non-scams are hard negatives.
            # In hard mode, ~10% are.
            hard_neg_rate = 0.03 if difficulty_mode == "mixed" else 0.10
            if rng.random() < hard_neg_rate:
                scam_subpattern = "hard_negative"
            else:
                scam_subpattern = None
        else:
            scam_subpattern = None

        # ----- Generate the scam/non-scam features based on subpattern -----
        if scam_subpattern == "classic":
            # Original scam profile: all 4 signals fire
            direction = "collect"
            amount = float(np.exp(np.random.normal(8.5, 0.6)))   # ~€5k
            hour = rng.choice([0, 1, 2, 3, 4, 5, 22, 23, 12, 13]) # odd hours
            approval_latency_ms = int(np.random.uniform(800, 4000))  # suspiciously fast
            is_first_time_payee = 1.0  # force first-time for classic scams
        elif scam_subpattern == "partial":
            # Partial-signal scam: only 2-3 of 4 signals present.
            # Randomly choose which to keep — model must generalize.
            direction = "collect"
            amount = float(np.exp(np.random.normal(8.5, 0.6)))
            hour = rng.choice([0, 1, 2, 3, 4, 5, 22, 23, 12, 13])
            approval_latency_ms = int(np.random.uniform(800, 4000))
            # Randomly drop 1-2 of the 3 non-direction signals
            signals = ["high_amount", "odd_hour", "fast_approval", "first_time"]
            n_drop = rng.choice([1, 2])
            drop = set(rng.sample(signals, n_drop))
            if "high_amount" in drop:
                amount = float(np.clip(np.random.normal(payer.typical_amount, 0.4 * payer.typical_amount), 10, 50000))
            if "odd_hour" in drop:
                hour = int(np.clip(np.random.normal(payer.typical_hour, 3), 0, 23))
            if "fast_approval" in drop:
                approval_latency_ms = int(np.random.uniform(2500, 45000))
            if "first_time" in drop:
                # Force a repeat payee instead of first-time
                if payer.payees_seen:
                    payee_id = rng.choice(list(payer.payees_seen))
                    is_first_time_payee = 0.0
                else:
                    is_first_time_payee = 0.0
        elif scam_subpattern == "patient":
            # Patient scammer: collect + first_time + high_amount + odd_hour
            # but NORMAL approval latency (3-8 seconds, looks human).
            # Defeats the "fast_approval" rule entirely.
            direction = "collect"
            amount = float(np.exp(np.random.normal(8.5, 0.6)))
            hour = rng.choice([0, 1, 2, 3, 4, 5, 22, 23, 12, 13])
            approval_latency_ms = int(np.random.uniform(3000, 8000))  # looks normal
            is_first_time_payee = 1.0
        elif scam_subpattern == "hard_negative":
            # Legitimate high-value first-time payment that RESEMBLES a scam:
            # high amount + first-time payee + (sometimes collect direction
            # for refund flows) + odd hour (e.g., landlord sending lease
            # deposit at 11pm). The "scam" label is 0 — these are real.
            # This is the hardest case: a true negative that looks like a scam.
            is_scam = 0.0  # critical: this is NOT a scam, just looks like one
            direction = rng.choices(["send", "qr", "collect"], weights=[0.5, 0.3, 0.2])[0]
            amount = float(np.exp(np.random.normal(8.3, 0.5)))  # high but plausible
            hour = rng.choice([22, 23, 0, 1, 12, 13])  # odd hours plausible for legit payments
            approval_latency_ms = int(np.random.uniform(2500, 30000))  # normal latency
            is_first_time_payee = 1.0  # legit first-time (new landlord/vendor)
        else:
            # Normal legitimate transaction
            direction = rng.choices(["send", "qr", "collect"], weights=[0.7, 0.2, 0.1])[0]
            amount = float(np.clip(np.random.normal(payer.typical_amount, 0.6 * payer.typical_amount), 10, 50000))
            hour = int(np.clip(np.random.normal(payer.typical_hour, 3), 0, 23))
            approval_latency_ms = int(np.random.uniform(2500, 45000))

        timestamp = start_time + timedelta(
            days=i // 200,
            hours=int(hour),
            minutes=rng.randint(0, 59),
            seconds=rng.randint(0, 59),
        )
        is_out_of_hours = 1.0 if hour < 8 or hour >= 21 else 0.0

        # Behavioral features (visible to Stage-1 intent-risk model)
        # Approval speed z-score will be computed across the dataset after generation
        payer_avg_amount = payer.typical_amount
        amount_vs_typical_ratio = amount / max(payer_avg_amount, 1.0)
        # Number of payments this payer has made to this payee (always 0 if first-time)
        prior_txn_count_to_payee = 0 if is_first_time_payee else rng.randint(1, 12)

        # Feature dict for the true success functions
        amount_z = float(np.log1p(amount) - np.log1p(payer_avg_amount))  # relative log-amount
        features_for_success = {
            "amount_z": amount_z,
            "is_out_of_hours": is_out_of_hours,
            "is_first_time_payee": is_first_time_payee,
            "is_high_risk_merchant": is_high_risk_merchant,
        }

        # --- CONFOUNDING: routing policy correlates with difficulty ---
        # Operator leans toward Gateway A for "easy" txns (in-hours, repeat, small)
        # and toward Gateway B for "hard" txns (out-of-hours, first-time, large).
        difficulty_score = (
            0.4 * is_out_of_hours
            + 0.4 * is_first_time_payee
            + 0.2 * min(amount_z, 1.0)
        )
        # Higher difficulty => less likely to default to A
        p_choose_a = gateway_a_default_rate * (1.0 - 0.7 * difficulty_score)
        gateway_chosen = "A" if rng.random() < p_choose_a else "B"

        # Ground-truth success probability for the CHOSEN gateway (sample from it)
        p_a = true_success_prob_a(features_for_success)
        p_b = true_success_prob_b(features_for_success)
        p_success_true = p_a if gateway_chosen == "A" else p_b
        outcome = 1 if rng.random() < p_success_true else 0

        # Counterfactual: what would have happened had we routed to the OTHER gateway?
        p_other = p_b if gateway_chosen == "A" else p_a
        counterfactual_outcome_other = 1 if rng.random() < p_other else 0

        # Latency / failure mode if failed
        if outcome == 0:
            failure_reason = rng.choices(
                ["timeout", "declined", "network_error", "bank_down"],
                weights=[0.4, 0.35, 0.15, 0.10],
            )[0]
            gateway_latency_ms = int(np.random.uniform(8000, 30000))
        else:
            failure_reason = "none"
            gateway_latency_ms = int(np.random.uniform(300, 2500))

        rows.append({
            # Realistic transaction ID — short UUID-like format (no sequential
            # numbers, no "txn_000019" patterns that look like a demo seed)
            "txn_id": f"txn_{uuid.uuid4().hex[:12]}",
            "timestamp": timestamp.isoformat(),
            "payer_id": payer.payer_id,
            "payee_id": payee_id,
            "amount": round(amount, 2),
            "direction": direction,
            "hour_of_day": hour,
            "is_out_of_hours": is_out_of_hours,
            "is_first_time_payee": is_first_time_payee,
            "is_high_risk_merchant": is_high_risk_merchant,
            "prior_txn_count_to_payee": prior_txn_count_to_payee,
            "payer_typical_amount": round(payer_avg_amount, 2),
            "amount_vs_typical_ratio": round(amount_vs_typical_ratio, 3),
            "approval_latency_ms": approval_latency_ms,
            "amount_z": round(amount_z, 4),
            # Routing + outcomes (ground truth; the model only sees gateway_chosen + outcome)
            "gateway_chosen": gateway_chosen,
            "outcome": outcome,
            "p_success_a_true": round(p_a, 4),
            "p_success_b_true": round(p_b, 4),
            "counterfactual_outcome_other": counterfactual_outcome_other,
            "gateway_latency_ms": gateway_latency_ms,
            "failure_reason": failure_reason,
            # Stage-1 target
            "is_scam": int(is_scam),
            # Difficulty is implicit; we don't expose it as a feature to the model
            "difficulty_score": round(difficulty_score, 4),
        })

    df = pd.DataFrame(rows)

    # Z-score approval latency within payer. Use population std (ddof=0) so
    # single-transaction payers get z=0 instead of NaN.
    df["approval_latency_z"] = (
        df.groupby("payer_id")["approval_latency_ms"]
          .transform(lambda s: (s - s.mean()) / (s.std(ddof=0) + 1e-6))
    )
    # Speed indicator: <0 means faster than payer's average
    df["is_suspiciously_fast_approval"] = (df["approval_latency_z"] < -1.2).astype(int)

    return df


def generate_and_save(
    n: int = NUM_TXNS_DEFAULT,
    seed: int = 7,
    difficulty_mode: str = "easy",
) -> Dict[str, Any]:
    """Generate `n` transactions with the given difficulty_mode and write to
    `data/transactions_<mode>.csv` (plus a `summary_<mode>.json`).

    For backward compat, mode="easy" also writes the unsuffixed
    `transactions.csv` so existing code that loads the default still works.
    """
    df = generate_transactions(n=n, seed=seed, difficulty_mode=difficulty_mode)

    # Mode-specific path so all three modes can coexist for comparison
    csv_path_mode = DATA_DIR / f"transactions_{difficulty_mode}.csv"
    df.to_csv(csv_path_mode, index=False)
    try:
        df.to_parquet(DATA_DIR / f"transactions_{difficulty_mode}.parquet", index=False)
    except Exception:
        pass  # parquet optional

    # For backward compat, easy mode also writes the unsuffixed path
    if difficulty_mode == "easy":
        (DATA_DIR / "transactions.csv").write_text(csv_path_mode.read_text())

    # Summary stats so the demo can talk about confounding explicitly
    summary = {
        "difficulty_mode": difficulty_mode,
        "n_transactions": len(df),
        "scam_rate": float(df["is_scam"].mean()),
        "gateway_a_share": float((df["gateway_chosen"] == "A").mean()),
        "gateway_b_share": float((df["gateway_chosen"] == "B").mean()),
        "naive_success_rate_a": float(df[df.gateway_chosen == "A"]["outcome"].mean()),
        "naive_success_rate_b": float(df[df.gateway_chosen == "B"]["outcome"].mean()),
        "true_avg_p_success_a": float(df["p_success_a_true"].mean()),
        "true_avg_p_success_b": float(df["p_success_b_true"].mean()),
        "confounding_strength": {
            "out_of_hours_in_B_vs_A": float(
                df[df.gateway_chosen == "B"]["is_out_of_hours"].mean()
                - df[df.gateway_chosen == "A"]["is_out_of_hours"].mean()
            ),
            "first_time_in_B_vs_A": float(
                df[df.gateway_chosen == "B"]["is_first_time_payee"].mean()
                - df[df.gateway_chosen == "A"]["is_first_time_payee"].mean()
            ),
            "amount_z_in_B_vs_A": float(
                df[df.gateway_chosen == "B"]["amount_z"].mean()
                - df[df.gateway_chosen == "A"]["amount_z"].mean()
            ),
        },
        # Distribution of scam subpatterns (only meaningful in hard/mixed modes)
        "is_collect_rate": float((df["direction"] == "collect").mean()),
        "is_first_time_rate": float(df["is_first_time_payee"].mean()),
        "is_out_of_hours_rate": float(df["is_out_of_hours"].mean()),
        "is_suspiciously_fast_rate": float(df["is_suspiciously_fast_approval"].mean()),
        "amount_vs_typical_median": float(df["amount_vs_typical_ratio"].median()),
    }
    (DATA_DIR / f"summary_{difficulty_mode}.json").write_text(json.dumps(summary, indent=2))
    # Also write the unsuffixed summary.json for the easy mode (backward compat)
    if difficulty_mode == "easy":
        (DATA_DIR / "summary.json").write_text(json.dumps(summary, indent=2))
    print(f"\n=== Mode: {difficulty_mode} ===")
    print(json.dumps(summary, indent=2))
    return summary


if __name__ == "__main__":
    import sys
    mode = sys.argv[1] if len(sys.argv) > 1 else "easy"
    if mode == "all":
        # Generate all three modes for the before/after comparison report
        for m in ["easy", "hard", "mixed"]:
            generate_and_save(difficulty_mode=m)
    else:
        generate_and_save(difficulty_mode=mode)
