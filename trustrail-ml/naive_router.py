"""
TrustRail — Phase 2: NAIVE baseline router.

This is intentionally the WRONG model. It's what most "smart routing" products do:
train a classifier on (features -> gateway -> outcome) using historical data,
route to the predicted winner.

Bug: routing decisions were never random. Gateway A got picked more often for
easy transactions historically (it's the default), so the naive model learns
"Gateway A looks great" partly because of SELECTION BIAS, not because A is
actually better for a given transaction.

We expose this bias explicitly by reporting:
  - naive predicted P(success | A) vs P(success | B)
  - vs the GROUND-TRUTH counterfactual P(success | A) and P(success | B)
    (which we know because we generated the data with known success functions)

Trains two separate classifiers (one per gateway) since we only observe outcomes
for the gateway that was actually chosen (this is the standard "two-model" / T-learner
baseline in causal inference literature).
"""
from __future__ import annotations

import json
import joblib
from pathlib import Path
from typing import Dict, Any, List, Tuple

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score, log_loss
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline

ARTIFACTS_DIR = Path(__file__).resolve().parent / "artifacts"
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR = Path(__file__).resolve().parent / "data"

# Features visible to a production router (no ground truth leakage)
ROUTER_FEATURES = [
    "amount",
    "amount_vs_typical_ratio",
    "amount_z",
    "is_out_of_hours",
    "is_first_time_payee",
    "is_high_risk_merchant",
    "prior_txn_count_to_payee",
    "hour_of_day",
    "approval_latency_ms",
]


class NaiveRouter:
    """
    Two independent classifiers: P(success | features, gateway=A) and
    P(success | features, gateway=B). Trained only on the rows where each
    gateway was actually used (selection on observables = biased estimate).
    """

    def __init__(self, model_type: str = "gbdt"):
        self.model_type = model_type
        self.models: Dict[str, Any] = {}
        self.scaler = None
        self.features = ROUTER_FEATURES
        self.training_meta: Dict[str, Any] = {}

    def _new_model(self):
        if self.model_type == "logistic":
            return Pipeline([
                ("scaler", StandardScaler()),
                ("clf", LogisticRegression(max_iter=1000, class_weight="balanced")),
            ])
        return GradientBoostingClassifier(
            n_estimators=200, max_depth=3, learning_rate=0.05, random_state=42
        )

    def fit(self, df: pd.DataFrame) -> Dict[str, Any]:
        df = df.copy()
        df[self.features] = df[self.features].fillna(0.0)
        X_full = df[self.features].values
        metrics = {}
        for gw in ["A", "B"]:
            sub = df[df["gateway_chosen"] == gw]
            X = sub[self.features].values
            y = sub["outcome"].values

            if len(sub) < 50 or y.sum() < 5:
                # Fallback: not enough data, use logistic on the whole dataset
                self.models[gw] = self._new_model()
                self.models[gw].fit(X_full, df["outcome"].values)
                metrics[gw] = {"n_train": int(len(sub)), "fallback": True}
                continue

            X_tr, X_te, y_tr, y_te = train_test_split(
                X, y, test_size=0.2, random_state=42, stratify=y
            )
            m = self._new_model()
            m.fit(X_tr, y_tr)
            self.models[gw] = m

            p_te = m.predict_proba(X_te)[:, 1]
            try:
                auc = roc_auc_score(y_te, p_te)
            except Exception:
                auc = float("nan")
            ll = log_loss(y_te, p_te, labels=[0, 1]) if len(np.unique(y_te)) > 1 else float("nan")
            metrics[gw] = {
                "n_train": int(len(X_tr)),
                "n_test": int(len(X_te)),
                "auc": float(auc),
                "log_loss": float(ll),
                "fallback": False,
            }

        self.training_meta = {"model_type": self.model_type, "features": self.features, "metrics": metrics}
        return metrics

    def predict_proba_per_gateway(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        For each transaction, predict P(success | A) and P(success | B)
        using the two independent classifiers. Returns a DataFrame with
        columns: p_success_a_naive, p_success_b_naive, recommended_gateway_naive.
        """
        df = df.copy()
        df[self.features] = df[self.features].fillna(0.0)
        X = df[self.features].values
        out = pd.DataFrame(index=df.index)
        out["p_success_a_naive"] = self.models["A"].predict_proba(X)[:, 1]
        out["p_success_b_naive"] = self.models["B"].predict_proba(X)[:, 1]
        out["recommended_gateway_naive"] = np.where(
            out["p_success_a_naive"] >= out["p_success_b_naive"], "A", "B"
        )
        out["naive_uplift_a_over_b"] = out["p_success_a_naive"] - out["p_success_b_naive"]
        return out

    def save(self, path: Path | None = None):
        path = path or ARTIFACTS_DIR / "naive_router.joblib"
        joblib.dump({"models": self.models, "meta": self.training_meta}, path)
        return path

    @classmethod
    def load(cls, path: Path | None = None) -> "NaiveRouter":
        path = path or ARTIFACTS_DIR / "naive_router.joblib"
        bundle = joblib.load(path)
        obj = cls(model_type=bundle["meta"]["model_type"])
        obj.models = bundle["models"]
        obj.training_meta = bundle["meta"]
        return obj


def evaluate_naive_vs_truth(df: pd.DataFrame, router: NaiveRouter) -> Dict[str, Any]:
    """
    The whole point of Phase 2 vs Phase 3: how biased is the naive estimate
    relative to the ground-truth counterfactuals we baked into the data?
    """
    preds = router.predict_proba_per_gateway(df)
    out = df[["txn_id", "gateway_chosen", "outcome",
             "p_success_a_true", "p_success_b_true"]].copy()
    out["p_success_a_naive"] = preds["p_success_a_naive"].values
    out["p_success_b_naive"] = preds["p_success_b_naive"].values
    out["recommended_naive"] = preds["recommended_gateway_naive"].values

    # Optimal routing (oracle): route to gateway with higher TRUE p(success)
    out["recommended_oracle"] = np.where(
        out["p_success_a_true"] >= out["p_success_b_true"], "A", "B"
    )

    # How often does the naive router agree with the oracle?
    agree_with_oracle = float((out["recommended_naive"] == out["recommended_oracle"]).mean())

    # What's the bias in the per-transaction estimate?
    bias_a = float((out["p_success_a_naive"] - out["p_success_a_true"]).mean())
    bias_b = float((out["p_success_b_naive"] - out["p_success_b_true"]).mean())

    # Counterfactual uplift the naive model would compute vs. the true uplift
    out["naive_uplift"] = out["p_success_a_naive"] - out["p_success_b_naive"]
    out["true_uplift"] = out["p_success_a_true"] - out["p_success_b_true"]

    # On disagreements: when naive says A but truth says B (or vice versa),
    # what's the loss in expected success?
    disagreements = out[out["recommended_naive"] != out["recommended_oracle"]]
    expected_success_naive = float(np.where(
        disagreements["recommended_naive"] == "A",
        disagreements["p_success_a_true"],
        disagreements["p_success_b_true"],
    ).mean())
    expected_success_oracle = float(np.where(
        disagreements["recommended_oracle"] == "A",
        disagreements["p_success_a_true"],
        disagreements["p_success_b_true"],
    ).mean())

    summary = {
        "n_txns": int(len(out)),
        "n_disagreements_with_oracle": int(len(disagreements)),
        "pct_disagree_with_oracle": float(len(disagreements) / len(out)),
        "pct_agree_with_oracle": agree_with_oracle,
        "bias_in_p_a_estimate": bias_a,   # naive over/underestimates A
        "bias_in_p_b_estimate": bias_b,
        "expected_success_on_disagreements_naive": expected_success_naive,
        "expected_success_on_disagreements_oracle": expected_success_oracle,
        "uplift_loss_on_disagreements": expected_success_oracle - expected_success_naive,
    }
    return summary


def train_and_save():
    df = pd.read_csv(DATA_DIR / "transactions.csv")
    router = NaiveRouter(model_type="gbdt")
    metrics = router.fit(df)
    router.save()
    summary = evaluate_naive_vs_truth(df, router)
    (ARTIFACTS_DIR / "naive_summary.json").write_text(json.dumps({
        "training_metrics": metrics, "bias_evaluation": summary
    }, indent=2))
    print(json.dumps({"training_metrics": metrics, "bias_evaluation": summary}, indent=2))
    return router, summary


if __name__ == "__main__":
    train_and_save()
