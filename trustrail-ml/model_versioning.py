"""
TrustRail — Item 4: Model versioning + drift monitoring.

Provides:
  - compute_data_hash(df)  → SHA-256 of the training DataFrame (CSV bytes)
  - record_model_artifact(...) → writes a row to the Prisma ModelArtifact table
    (sets the previous active version to inactive)
  - get_active_version(model_name) → returns the current active artifact's metadata
  - list_artifact_history(model_name) → returns version history

Drift monitoring:
  - compute_drift_metrics(current_df, previous_df) → KS-test p-values for numeric
    features + PSI for stability + chi-squared for categorical features
  - check_propensity_auc_drift(current, previous) → significant drop means routing
    policy has shifted (more or less confounding)
  - assess_drift_severity(metrics) → "OK" | "WARN" | "BREACH" based on thresholds

Persistence:
  Artifacts are stored in the same SQLite DB that Prisma manages
  (db/custom.db → ModelArtifact table). We use a lightweight sqlite3 connection
  directly to avoid pulling Prisma into the Python service — Prisma is a
  Next.js-side concern.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime

import numpy as np
import pandas as pd
from scipy import stats as scipy_stats

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = PROJECT_ROOT / "db" / "custom.db"
ARTIFACTS_DIR = Path(__file__).resolve().parent / "artifacts"


# ---------------------------------------------------------------------------
# Data hashing — used to detect that the training distribution changed
# between retrain runs.
# ---------------------------------------------------------------------------

def compute_data_hash(df: pd.DataFrame) -> str:
    """SHA-256 of the DataFrame's CSV representation.
    Captures every value; identical data → identical hash.
    """
    csv_bytes = df.to_csv(index=False).encode("utf-8")
    return hashlib.sha256(csv_bytes).hexdigest()


def compute_data_size_rows(df: pd.DataFrame) -> int:
    return int(len(df))


# ---------------------------------------------------------------------------
# ModelArtifact persistence (direct sqlite3 — Prisma is Next.js-side only)
# ---------------------------------------------------------------------------

def _get_db_conn() -> sqlite3.Connection:
    if not DB_PATH.exists():
        raise RuntimeError(f"Database not found at {DB_PATH}. Run `bun run db:push` first.")
    return sqlite3.connect(str(DB_PATH))


def record_model_artifact(
    model_name: str,
    version: str,
    metrics: Dict[str, Any],
    training_df: pd.DataFrame,
    path: str,
) -> Dict[str, Any]:
    """Insert a new ModelArtifact row and deactivate previous versions of the
    same model_name. Returns the inserted row's id + metadata.
    """
    data_hash = compute_data_hash(training_df)
    data_rows = compute_data_size_rows(training_df)
    metrics_json = json.dumps(metrics, default=str)
    trained_at = datetime.utcnow().isoformat()
    artifact_id = hashlib.sha256(f"{model_name}:{version}:{trained_at}".encode()).hexdigest()[:24]

    conn = _get_db_conn()
    try:
        cur = conn.cursor()
        # Deactivate previous active versions of this model
        cur.execute(
            'UPDATE "ModelArtifact" SET "isActive" = 0 WHERE "modelName" = ? AND "isActive" = 1',
            (model_name,),
        )
        # Insert the new active version
        cur.execute(
            '''INSERT INTO "ModelArtifact"
               ("id", "modelName", "version", "trainedAt", "metrics",
                "trainingDataHash", "trainingDataRows", "path", "isActive")
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)''',
            (artifact_id, model_name, version, trained_at, metrics_json,
             data_hash, data_rows, path),
        )
        conn.commit()
        return {
            "id": artifact_id,
            "modelName": model_name,
            "version": version,
            "trainedAt": trained_at,
            "trainingDataHash": data_hash,
            "trainingDataRows": data_rows,
            "path": path,
            "isActive": True,
        }
    finally:
        conn.close()


def get_active_version(model_name: str) -> Optional[Dict[str, Any]]:
    """Return the currently active ModelArtifact for the given model_name."""
    conn = _get_db_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            '''SELECT "id", "modelName", "version", "trainedAt", "metrics",
                      "trainingDataHash", "trainingDataRows", "path", "isActive"
               FROM "ModelArtifact"
               WHERE "modelName" = ? AND "isActive" = 1
               ORDER BY "trainedAt" DESC LIMIT 1''',
            (model_name,),
        )
        row = cur.fetchone()
        if not row:
            return None
        return {
            "id": row[0],
            "modelName": row[1],
            "version": row[2],
            "trainedAt": row[3],
            "metrics": json.loads(row[4]) if row[4] else {},
            "trainingDataHash": row[5],
            "trainingDataRows": row[6],
            "path": row[7],
            "isActive": bool(row[8]),
        }
    finally:
        conn.close()


def list_artifact_history(model_name: str, limit: int = 10) -> List[Dict[str, Any]]:
    """Return up to `limit` most recent ModelArtifact rows for the given model."""
    conn = _get_db_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            '''SELECT "id", "modelName", "version", "trainedAt",
                      "trainingDataHash", "trainingDataRows", "isActive"
               FROM "ModelArtifact"
               WHERE "modelName" = ?
               ORDER BY "trainedAt" DESC LIMIT ?''',
            (model_name, limit),
        )
        rows = cur.fetchall()
        return [
            {
                "id": r[0],
                "modelName": r[1],
                "version": r[2],
                "trainedAt": r[3],
                "trainingDataHash": r[4],
                "trainingDataRows": r[5],
                "isActive": bool(r[6]),
            }
            for r in rows
        ]
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Drift monitoring
# ---------------------------------------------------------------------------

NUMERIC_DRIFT_FEATURES = [
    "amount", "amount_z", "amount_vs_typical_ratio",
    "hour_of_day", "approval_latency_ms", "prior_txn_count_to_payee",
]
CATEGORICAL_DRIFT_FEATURES = [
    "direction", "is_first_time_payee", "is_out_of_hours",
    "is_high_risk_merchant",
]


def _psi(expected: np.ndarray, actual: np.ndarray, bins: int = 10) -> float:
    """Population Stability Index — measures how much a numeric distribution
    has shifted between two samples.

    PSI < 0.1   → no significant change
    PSI 0.1-0.25 → small shift, monitor
    PSI > 0.25  → significant shift, retrain recommended
    """
    # Bin on the union of both samples
    breakpoints = np.percentile(np.concatenate([expected, actual]),
                                np.linspace(0, 100, bins + 1))
    breakpoints[0] = -np.inf
    breakpoints[-1] = np.inf
    breakpoints = np.unique(breakpoints)

    expected_counts = np.histogram(expected, bins=breakpoints)[0].astype(float)
    actual_counts = np.histogram(actual, bins=breakpoints)[0].astype(float)

    # Avoid div-by-zero
    expected_pct = (expected_counts + 0.5) / (expected_counts.sum() + 0.5 * len(expected_counts))
    actual_pct = (actual_counts + 0.5) / (actual_counts.sum() + 0.5 * len(actual_counts))

    return float(np.sum((actual_pct - expected_pct) * np.log(actual_pct / expected_pct)))


def compute_drift_metrics(
    current_df: pd.DataFrame,
    previous_df: pd.DataFrame,
) -> Dict[str, Any]:
    """Compare feature distributions between two training runs.

    For each numeric feature: KS-test p-value + PSI.
    For each categorical feature: chi-squared test p-value.
    """
    metrics: Dict[str, Any] = {
        "numeric_features": {},
        "categorical_features": {},
        "summary": {},
    }

    for feat in NUMERIC_DRIFT_FEATURES:
        if feat not in current_df.columns or feat not in previous_df.columns:
            continue
        cur_vals = current_df[feat].dropna().astype(float).values
        prev_vals = previous_df[feat].dropna().astype(float).values
        if len(cur_vals) < 10 or len(prev_vals) < 10:
            continue
        try:
            ks_stat, ks_p = scipy_stats.ks_2samp(cur_vals, prev_vals)
        except Exception:
            ks_stat, ks_p = float("nan"), float("nan")
        psi = _psi(prev_vals, cur_vals)
        metrics["numeric_features"][feat] = {
            "ks_statistic": float(ks_stat),
            "ks_p_value": float(ks_p),
            "psi": psi,
            "current_mean": float(np.mean(cur_vals)),
            "previous_mean": float(np.mean(prev_vals)),
            "mean_delta": float(np.mean(cur_vals) - np.mean(prev_vals)),
        }

    for feat in CATEGORICAL_DRIFT_FEATURES:
        if feat not in current_df.columns or feat not in previous_df.columns:
            continue
        cur_vals = current_df[feat].dropna().astype(str)
        prev_vals = previous_df[feat].dropna().astype(str)
        if len(cur_vals) < 10 or len(prev_vals) < 10:
            continue
        # Build contingency table
        all_categories = sorted(set(cur_vals.unique()) | set(prev_vals.unique()))
        cur_counts = [int((cur_vals == c).sum()) for c in all_categories]
        prev_counts = [int((prev_vals == c).sum()) for c in all_categories]
        try:
            chi2, chi_p, _, _ = scipy_stats.chi2_contingency([prev_counts, cur_counts])
        except Exception:
            chi2, chi_p = float("nan"), float("nan")
        metrics["categorical_features"][feat] = {
            "chi2_statistic": float(chi2),
            "chi2_p_value": float(chi_p),
            "current_distribution": {c: cur_counts[i] for i, c in enumerate(all_categories)},
            "previous_distribution": {c: prev_counts[i] for i, c in enumerate(all_categories)},
        }

    # Summary: how many features drifted significantly?
    psi_threshold_warn = 0.10
    psi_threshold_breach = 0.25
    p_value_threshold = 0.05  # standard

    drifted_warn = []
    drifted_breach = []
    for feat, m in metrics["numeric_features"].items():
        if m["psi"] >= psi_threshold_breach:
            drifted_breach.append(feat)
        elif m["psi"] >= psi_threshold_warn or m["ks_p_value"] < p_value_threshold:
            drifted_warn.append(feat)
    for feat, m in metrics["categorical_features"].items():
        if m["chi2_p_value"] < p_value_threshold:
            drifted_warn.append(feat)

    metrics["summary"] = {
        "n_features_checked": (
            len(metrics["numeric_features"]) + len(metrics["categorical_features"])
        ),
        "n_warn": len(drifted_warn),
        "n_breach": len(drifted_breach),
        "drifted_warn_features": drifted_warn,
        "drifted_breach_features": drifted_breach,
        "severity": (
            "BREACH" if drifted_breach else
            "WARN" if drifted_warn else
            "OK"
        ),
    }
    return metrics


def check_propensity_auc_drift(
    current_auc: float,
    previous_auc: Optional[float],
) -> Dict[str, Any]:
    """Propensity AUC measures how predictable routing was from features —
    i.e. how much confounding there was. A big drop means the operator's
    routing policy has changed (less selection bias → easier for the model
    to learn true effects). A big increase means more confounding crept in.
    """
    if previous_auc is None:
        return {
            "current": current_auc,
            "previous": None,
            "delta": None,
            "severity": "OK",
            "note": "No previous propensity AUC available (first run).",
        }
    delta = current_auc - previous_auc
    abs_delta = abs(delta)
    if abs_delta >= 0.10:
        severity = "BREACH"
    elif abs_delta >= 0.05:
        severity = "WARN"
    else:
        severity = "OK"
    return {
        "current": current_auc,
        "previous": previous_auc,
        "delta": delta,
        "severity": severity,
        "note": (
            f"Propensity AUC moved {delta:+.4f}. "
            "Big drop = less confounding (good). Big rise = more confounding (bad)."
        ),
    }


def get_previous_training_data() -> Optional[pd.DataFrame]:
    """Load the previous training data hash from the most recent inactive
    causal_router artifact, then if the data file still exists, return the
    DataFrame for drift comparison. Returns None if no previous artifact or
    if the previous data file is gone.
    """
    # Look for the most recent inactive causal_router artifact (the one before retrain)
    conn = _get_db_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            '''SELECT "trainingDataHash", "trainedAt", "metrics"
               FROM "ModelArtifact"
               WHERE "modelName" = "causal_router" AND "isActive" = 0
               ORDER BY "trainedAt" DESC LIMIT 1''',
        )
        row = cur.fetchone()
    finally:
        conn.close()
    if not row:
        return None
    prev_hash, prev_trained_at, prev_metrics_json = row

    # We can't reconstruct the previous training DataFrame from a hash, but we
    # CAN look for the data file from before. Since we save mode-specific CSVs,
    # we can attempt to load any of them and check if its hash matches.
    for candidate in ["transactions_mixed.csv", "transactions.csv"]:
        path = Path(__file__).resolve().parent / "data" / candidate
        if path.exists():
            try:
                df = pd.read_csv(path)
                if compute_data_hash(df) == prev_hash:
                    return df
            except Exception:
                continue
    return None


# ---------------------------------------------------------------------------
# Convenience: snapshot the full drift assessment for /stats
# ---------------------------------------------------------------------------

def get_drift_status_snapshot() -> Dict[str, Any]:
    """Return the current drift status for /stats endpoint.

    Returns:
      - last_check: ISO timestamp
      - severity: "OK" | "WARN" | "BREACH"
      - propensity_auc: drift info between current and previous propensity AUC
      - feature_drift: numeric + categorical drift metrics if previous data exists
    """
    # Load the most recent drift report (if any) saved by /retrain
    drift_report_path = ARTIFACTS_DIR / "drift_report.json"
    if drift_report_path.exists():
        try:
            return json.loads(drift_report_path.read_text())
        except Exception:
            pass
    return {
        "last_check": None,
        "severity": "OK",
        "note": "No drift check has been run yet. Run /retrain to populate.",
    }


def save_drift_report(report: Dict[str, Any]) -> None:
    """Persist the drift report so /stats can read it without recomputing."""
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    path = ARTIFACTS_DIR / "drift_report.json"
    path.write_text(json.dumps(report, indent=2, default=str))


if __name__ == "__main__":
    # Quick smoke test
    print("Active causal_router artifact:")
    print(json.dumps(get_active_version("causal_router"), indent=2, default=str))
    print("\nArtifact history (causal_router):")
    print(json.dumps(list_artifact_history("causal_router"), indent=2, default=str))
    print("\nDrift status snapshot:")
    print(json.dumps(get_drift_status_snapshot(), indent=2, default=str))
