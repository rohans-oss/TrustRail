"""
Stress-test the intent-risk model on easy/hard/mixed difficulty modes.

For each mode:
  1. Load transactions_<mode>.csv
  2. Train intent_risk model on it
  3. Capture AUC, scam recall, scam precision, friction threshold
  4. Write the comparison to artifacts/intent_difficulty_comparison.json

This produces the "before/after" report requested in Item 2.
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from intent_risk import IntentRiskModel

DATA_DIR = Path(__file__).resolve().parent / "data"
ARTIFACTS_DIR = Path(__file__).resolve().parent / "artifacts"
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

MODES = ["easy", "hard", "mixed"]


def evaluate_intent_on_mode(mode: str) -> dict:
    csv_path = DATA_DIR / f"transactions_{mode}.csv"
    if not csv_path.exists():
        return {"mode": mode, "error": f"{csv_path} not found — run data_generator.py {mode} first"}

    df = pd.read_csv(csv_path)
    model = IntentRiskModel()
    meta = model.fit(df)

    # Save each mode's model under a mode-specific path so they don't clobber
    model.save(ARTIFACTS_DIR / f"intent_risk_{mode}.joblib")

    # Compute extra recall/precision at the calibrated friction threshold
    from sklearn.metrics import confusion_matrix
    from intent_risk import _build_features
    X = _build_features(df)
    y = df["is_scam"].values.astype(int)
    p = model.pipeline.predict_proba(X)[:, 1]
    y_pred = (p >= model.friction_threshold).astype(int)
    cm = confusion_matrix(y, y_pred).tolist()
    tn, fp, fn, tp = cm[0][0], cm[0][1], cm[1][0], cm[1][1]
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0
    fp_rate = fp / (fp + tn) if (fp + tn) > 0 else 0.0  # false-positive rate on legit txns

    return {
        "mode": mode,
        "n_train": meta["n_train"],
        "n_test": meta["n_test"],
        "scam_rate_train": meta["scam_rate_train"],
        "auc_test": meta["auc_test"],
        "auc_train": meta["auc_train"],
        "friction_threshold": model.friction_threshold,
        "scam_recall_at_threshold": recall,
        "scam_precision_at_threshold": precision,
        "scam_f1_at_threshold": f1,
        "false_positive_rate_at_threshold": fp_rate,
        "confusion_matrix_at_threshold": {"tn": tn, "fp": fp, "fn": fn, "tp": tp},
    }


def main():
    results = []
    print("=" * 80)
    print("Intent-Risk Model — Difficulty Mode Comparison")
    print("=" * 80)
    for mode in MODES:
        print(f"\n--- {mode.upper()} mode ---")
        r = evaluate_intent_on_mode(mode)
        print(json.dumps(r, indent=2))
        results.append(r)

    out_path = ARTIFACTS_DIR / "intent_difficulty_comparison.json"
    out_path.write_text(json.dumps(results, indent=2))
    print(f"\nComparison saved to {out_path}")

    # Print a side-by-side table for at-a-glance reading
    print("\n" + "=" * 80)
    print("SIDE-BY-SIDE COMPARISON")
    print("=" * 80)
    print(f"{'Metric':<40} {'EASY':<15} {'HARD':<15} {'MIXED':<15}")
    print("-" * 80)
    for key in ["auc_train", "auc_test", "scam_recall_at_threshold",
                "scam_precision_at_threshold", "scam_f1_at_threshold",
                "false_positive_rate_at_threshold", "friction_threshold"]:
        vals = [next((r[key] for r in results if r.get(key) is not None), "—")
                for _ in MODES]
        # Re-pull correctly
        vals = []
        for r in results:
            v = r.get(key, "—")
            if isinstance(v, float):
                v = f"{v:.4f}"
            vals.append(str(v))
        print(f"{key:<40} {vals[0]:<15} {vals[1]:<15} {vals[2]:<15}")


if __name__ == "__main__":
    main()
