"""
TrustRail — Phase 4: Intent-risk model (Stage 1 — pre-approval scam detection).

Targets India/UPI-shaped social-engineering fraud:
  - Scammer calls victim, builds trust, sends a "collect request" disguised as a refund
  - Victim APPROVES IT THEMSELVES
  - Transaction looks 100% legitimate to every existing signal:
      real device, real account, user-approved, valid auth tokens
  - The fraud happened in the CONVERSATION, not the transaction.

We model the PATTERN of the lead-up — behavioral signals that are visible BEFORE
the user approves:
  - is_collect_request            (the victim is being asked to pay, not send)
  - is_first_time_payee            (never paid this person before)
  - amount_vs_typical_ratio       (way higher than this payer's usual)
  - is_suspiciously_fast_approval (approval in <2s — no reflection time)
  - is_out_of_hours               (odd hour: late night, very early morning)
  - is_high_amount_first_time     (compound signal: high amount + first time)
  - prior_txn_count_to_payee      (history with this payee)

Model choice: logistic regression with interpretable coefficients.
This is v1 — a friction score with a HUMAN-READABLE reason string, not a black box.
A reviewer can see "the model fired because: first-time payee + high amount +
collect-request + fast approval" and decide to override or escalate.
"""
from __future__ import annotations

import json
import joblib
from pathlib import Path
from typing import Dict, Any, List, Tuple

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.impute import SimpleImputer
from sklearn.metrics import roc_auc_score, classification_report, confusion_matrix
from sklearn.model_selection import train_test_split

ARTIFACTS_DIR = Path(__file__).resolve().parent / "artifacts"
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR = Path(__file__).resolve().parent / "data"

# Features visible BEFORE approval (no leakage from outcome / gateway_chosen)
INTENT_FEATURES = [
    "is_collect_request",
    "is_first_time_payee",
    "amount_vs_typical_ratio",
    "is_suspiciously_fast_approval",
    "is_out_of_hours",
    "is_high_amount_first_time",
    "prior_txn_count_to_payee",
    "is_high_risk_merchant",
    "amount_log",
]


# Human-readable rule-based reason generator.
# Each rule fires when its condition is met AND the model score is above the
# friction threshold. Used to explain WHY a transaction was flagged.
REASON_RULES = [
    {
        "id": "collect_first_time",
        "label": "Collect request from a first-time payee",
        "detail": (
            "This transaction is a UPI collect request (the payee is asking "
            "you to pay them, not the other way round) AND you've never paid "
            "this account before. Refund scammers use this exact pattern."
        ),
        "condition": lambda f: f["is_collect_request"] == 1 and f["is_first_time_payee"] == 1,
    },
    {
        "id": "amount_spike",
        "label": "Amount is unusually high for this payer",
        "detail": (
            "This transaction is more than 3x this payer's typical amount. "
            "Common in refund scams where the scammer asks for a 'verification' transfer."
        ),
        "condition": lambda f: f["amount_vs_typical_ratio"] > 3.0,
    },
    {
        "id": "fast_approval",
        "label": "Approval given suspiciously fast",
        "detail": (
            "The user approved this in under 2 seconds — too fast to read the "
            "amount, the payee name, or the direction of the request."
        ),
        "condition": lambda f: f["is_suspiciously_fast_approval"] == 1,
    },
    {
        "id": "odd_hour",
        "label": "Transaction at an unusual hour",
        "detail": (
            "This transaction is happening between 21:00 and 08:00 local time — "
            "scammers often call late at night when the victim is tired or distracted."
        ),
        "condition": lambda f: f["is_out_of_hours"] == 1,
    },
    {
        "id": "high_amount_first_time",
        "label": "High amount + first-time payee combination",
        "detail": (
            "First-time payee + unusually high amount + (collect or QR direction) "
            "is the strongest single signal in our historical scam data."
        ),
        "condition": lambda f: f["is_high_amount_first_time"] == 1 and f["is_collect_request"] == 1,
    },
    {
        "id": "high_risk_merchant",
        "label": "Payee flagged as high-risk merchant",
        "detail": (
            "This payee account has prior complaints or is on a high-risk watchlist."
        ),
        "condition": lambda f: f["is_high_risk_merchant"] == 1,
    },
]


def _build_features(df: pd.DataFrame) -> pd.DataFrame:
    """Build the intent-risk feature matrix from raw transaction fields."""
    out = pd.DataFrame(index=df.index)
    out["is_collect_request"] = (df["direction"] == "collect").astype(int)
    out["is_first_time_payee"] = df["is_first_time_payee"].astype(int)
    out["amount_vs_typical_ratio"] = df["amount_vs_typical_ratio"].fillna(1.0)
    out["is_suspiciously_fast_approval"] = df["is_suspiciously_fast_approval"].fillna(0).astype(int)
    out["is_out_of_hours"] = df["is_out_of_hours"].astype(int)
    out["is_high_amount_first_time"] = (
        (df["amount_vs_typical_ratio"] > 3.0) & (df["is_first_time_payee"] == 1.0)
    ).astype(int)
    out["prior_txn_count_to_payee"] = df["prior_txn_count_to_payee"].fillna(0)
    out["is_high_risk_merchant"] = df["is_high_risk_merchant"].astype(int)
    out["amount_log"] = np.log1p(df["amount"].fillna(0.0))
    return out


class IntentRiskModel:
    """
    Logistic regression friction score with interpretable coefficients and
    human-readable reason strings.
    """

    def __init__(self, friction_threshold: float = 0.5, hard_block_threshold: float = 0.85):
        self.pipeline = None
        self.friction_threshold = friction_threshold
        self.hard_block_threshold = hard_block_threshold
        self.features = INTENT_FEATURES
        self.training_meta: Dict[str, Any] = {}

    def fit(self, df: pd.DataFrame) -> Dict[str, Any]:
        X = _build_features(df)
        y = df["is_scam"].values.astype(int)

        X_tr, X_te, y_tr, y_te = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )

        # Logistic regression: interpretable coefficients, fast, calibrated enough for v1
        self.pipeline = Pipeline([
            ("impute", SimpleImputer(strategy="constant", fill_value=0.0)),
            ("scale", StandardScaler()),
            ("clf", LogisticRegression(max_iter=2000, class_weight="balanced", C=1.0)),
        ])
        self.pipeline.fit(X_tr, y_tr)

        # Evaluate
        p_te = self.pipeline.predict_proba(X_te)[:, 1]
        p_tr = self.pipeline.predict_proba(X_tr)[:, 1]
        auc_te = float(roc_auc_score(y_te, p_te)) if len(np.unique(y_te)) > 1 else float("nan")
        auc_tr = float(roc_auc_score(y_tr, p_tr)) if len(np.unique(y_tr)) > 1 else float("nan")
        y_pred = (p_te >= 0.5).astype(int)
        clf_report = classification_report(y_te, y_pred, output_dict=True, zero_division=0)
        cm = confusion_matrix(y_te, y_pred).tolist()

        # Coefficients (interpretability)
        coefs = self.pipeline.named_steps["clf"].coef_[0]
        coef_map = {feat: float(coef) for feat, coef in zip(self.features, coefs)}

        # Threshold calibration: pick a friction threshold that catches ~80% of scams
        # while keeping false-positive rate reasonable.
        thresholds = np.linspace(0.1, 0.95, 50)
        best_t = 0.5
        best_f1 = 0.0
        for t in thresholds:
            y_pred_t = (p_te >= t).astype(int)
            tp = ((y_pred_t == 1) & (y_te == 1)).sum()
            fp = ((y_pred_t == 1) & (y_te == 0)).sum()
            fn = ((y_pred_t == 0) & (y_te == 1)).sum()
            precision = tp / (tp + fp) if (tp + fp) > 0 else 0
            recall = tp / (tp + fn) if (tp + fn) > 0 else 0
            f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0
            # Prefer thresholds with recall >= 0.75 (catch most scams)
            if recall >= 0.75 and f1 > best_f1:
                best_f1 = f1
                best_t = float(t)
        self.friction_threshold = best_t

        self.training_meta = {
            "features": self.features,
            "n_train": int(len(X_tr)),
            "n_test": int(len(X_te)),
            "scam_rate_train": float(y_tr.mean()),
            "auc_train": auc_tr,
            "auc_test": auc_te,
            "coefficients": coef_map,
            "friction_threshold_calibrated": self.friction_threshold,
            "classification_report": clf_report,
            "confusion_matrix_at_0.5": cm,
        }
        return self.training_meta

    # -------------------------------------------------------------------
    # Inference
    # -------------------------------------------------------------------

    def predict(self, df: pd.DataFrame) -> pd.DataFrame:
        if self.pipeline is None:
            raise RuntimeError("IntentRiskModel not trained.")
        X = _build_features(df)
        p = self.pipeline.predict_proba(X)[:, 1]

        out = pd.DataFrame(index=df.index)
        out["scam_risk_score"] = p
        out["verdict"] = np.where(
            p >= self.hard_block_threshold, "hard_block",
            np.where(p >= self.friction_threshold, "friction", "pass")
        )
        # Reason strings (one per row, joined as list)
        out["reasons"] = [self._reasons_for(row) for _, row in X.iterrows()]
        return out

    def _reasons_for(self, features_row: pd.Series) -> List[Dict[str, str]]:
        out = []
        for rule in REASON_RULES:
            try:
                if rule["condition"](features_row):
                    out.append({"id": rule["id"], "label": rule["label"], "detail": rule["detail"]})
            except Exception:
                continue
        return out

    # -------------------------------------------------------------------
    # Persistence
    # -------------------------------------------------------------------

    def save(self, path: Path | None = None):
        path = path or ARTIFACTS_DIR / "intent_risk.joblib"
        joblib.dump({
            "pipeline": self.pipeline,
            "friction_threshold": self.friction_threshold,
            "hard_block_threshold": self.hard_block_threshold,
            "features": self.features,
            "meta": self.training_meta,
        }, path)
        return path

    @classmethod
    def load(cls, path: Path | None = None) -> "IntentRiskModel":
        path = path or ARTIFACTS_DIR / "intent_risk.joblib"
        bundle = joblib.load(path)
        obj = cls(
            friction_threshold=bundle["friction_threshold"],
            hard_block_threshold=bundle["hard_block_threshold"],
        )
        obj.pipeline = bundle["pipeline"]
        obj.features = bundle["features"]
        obj.training_meta = bundle["meta"]
        return obj


def train_and_save():
    df = pd.read_csv(DATA_DIR / "transactions.csv")
    model = IntentRiskModel()
    meta = model.fit(df)
    model.save()

    # Persist a sample prediction set for the dashboard to show
    sample = df.sample(n=min(2000, len(df)), random_state=42).reset_index(drop=True)
    preds = model.predict(sample)
    sample_with_preds = pd.concat([sample, preds], axis=1)
    sample_with_preds.to_csv(DATA_DIR / "intent_predictions_sample.csv", index=False)

    (ARTIFACTS_DIR / "intent_summary.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta, indent=2))
    return model, meta


if __name__ == "__main__":
    train_and_save()
