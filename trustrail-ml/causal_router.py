"""
TrustRail — Phase 3: CAUSAL router (the heart of the project).

Implements a Doubly-Robust (DR) counterfactual outcome estimator by hand, using
EconML's DRLearner for the headline ATE/CATE diagnostics. The DR pseudo-outcome
approach is what gives clean per-transaction counterfactual estimates.

DR-learner algorithm (textbook Kennedy 2020 / Chernozhukov 2018):
  1. Train propensity e(X) = P(T=B|X)   [treatment assignment model]
  2. Train mu_A(X) = E[Y|X, T=A]         [outcome model on treated-with-A rows]
     Train mu_B(X) = E[Y|X, T=B]         [outcome model on treated-with-B rows]
  3. Compute DR pseudo-outcomes per row:
       psi_A(X) = mu_A(X) + (T==A) * (Y - mu_A(X)) / (1 - e(X))    # debiased E[Y(A)|X]
       psi_B(X) = mu_B(X) + (T==B) * (Y - mu_B(X)) / e(X)          # debiased E[Y(B)|X]
     For rows where T=A: psi_B = mu_B(X)   (no correction possible)
     For rows where T=B: psi_A = mu_A(X)
  4. Train final models: final_A(X) -> psi_A, final_B(X) -> psi_B
  5. Per-transaction counterfactuals:
       P(success | A) = final_A.predict(X)
       P(success | B) = final_B.predict(X)

Doubly-robust property: the estimator is consistent if EITHER the propensity OR
the outcome model is correctly specified. That's the whole point — it's much
harder for the bias to leak through.

We also use EconML's DRLearner to compute the headline ATE and per-transaction
CATE for the dashboard, so the demo can cite "DRLearner" by name.
"""
from __future__ import annotations

import json
import time
import joblib
from pathlib import Path
from typing import Dict, Any, Tuple, List

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor, GradientBoostingClassifier, RandomForestRegressor
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.impute import SimpleImputer
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import KFold

# EconML is the dependency that makes this project defensible.
from econml.dr import DRLearner

ARTIFACTS_DIR = Path(__file__).resolve().parent / "artifacts"
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR = Path(__file__).resolve().parent / "data"

CONFOUNDER_FEATURES = [
    "amount",
    "amount_z",
    "amount_vs_typical_ratio",
    "is_out_of_hours",
    "is_first_time_payee",
    "is_high_risk_merchant",
    "prior_txn_count_to_payee",
    "hour_of_day",
    "approval_latency_ms",
    "approval_latency_z",
]

GATEWAYS = ["A", "B"]
GATEWAY_TO_T = {"A": 0, "B": 1}
T_TO_GATEWAY = {0: "A", 1: "B"}


def _propensity_pipeline():
    return Pipeline([
        ("impute", SimpleImputer(strategy="constant", fill_value=0.0)),
        ("scale", StandardScaler()),
        ("clf", LogisticRegression(max_iter=2000, class_weight="balanced", C=1.0)),
    ])


class CausalRouter:
    """
    Doubly-robust counterfactual gateway success estimator.

    Pipeline:
      - Propensity model e(X) = P(T=B | X)
      - Two outcome models mu_A(X), mu_B(X) trained on T=A / T=B rows respectively
      - DR pseudo-outcomes psi_A, psi_B per row
      - Two final models final_A(X) -> psi_A, final_B(X) -> psi_B
      - EconML DRLearner trained in parallel for ATE / per-transaction CATE / propensity_auc diagnostics
    """

    def __init__(self):
        self.dr: DRLearner | None = None
        self.propensity_clf = None
        self.outcome_A = None
        self.outcome_B = None
        self.final_A = None
        self.final_B = None
        self.features = CONFOUNDER_FEATURES
        self.training_meta: Dict[str, Any] = {}

    def fit(self, df: pd.DataFrame) -> Dict[str, Any]:
        df = df.copy()
        df[self.features] = df[self.features].fillna(0.0)
        X = df[self.features].values.astype(float)
        T = df["gateway_chosen"].map(GATEWAY_TO_T).values.astype(int)
        Y = df["outcome"].values.astype(float)
        n = len(df)

        # ----------------------------------------------------------------
        # CROSS-FITTED nuisance models (Chernozhukov 2018).
        # Split into K folds. For each fold k, fit propensity + outcome
        # models on the OTHER K-1 folds and predict on fold k. This avoids
        # the overfitting bias that comes from fitting nuisance + final
        # models on the same rows.
        # ----------------------------------------------------------------
        K = 5
        kf = KFold(n_splits=K, shuffle=True, random_state=42)
        e_oof = np.zeros(n)        # out-of-fold propensity P(T=B|X)
        mu_A_oof = np.zeros(n)    # out-of-fold E[Y|X,T=A]
        mu_B_oof = np.zeros(n)    # out-of-fold E[Y|X,T=B]

        # We also keep FULL-DATA models for inference on NEW transactions
        # (the dashboard's simulator will pass brand-new transactions).
        self.propensity_clf = _propensity_pipeline()
        self.propensity_clf.fit(X, T)
        self.outcome_A = GradientBoostingRegressor(
            n_estimators=200, max_depth=3, learning_rate=0.05, random_state=42
        )
        self.outcome_B = GradientBoostingRegressor(
            n_estimators=200, max_depth=3, learning_rate=0.05, random_state=43
        )
        mask_A = (T == 0)
        mask_B = (T == 1)
        self.outcome_A.fit(X[mask_A], Y[mask_A])
        self.outcome_B.fit(X[mask_B], Y[mask_B])

        # Cross-fit: predict on held-out fold using a fresh nuisance model
        # trained only on the other folds. This produces out-of-fold
        # predictions that are unbiased even when the nuisance models overfit.
        for tr_idx, te_idx in kf.split(X):
            X_tr, X_te = X[tr_idx], X[te_idx]
            T_tr, Y_tr = T[tr_idx], Y[tr_idx]
            mask_A_tr = (T_tr == 0)
            mask_B_tr = (T_tr == 1)

            prop_k = _propensity_pipeline()
            prop_k.fit(X_tr, T_tr)
            e_oof[te_idx] = prop_k.predict_proba(X_te)[:, 1]

            mu_A_k = GradientBoostingRegressor(
                n_estimators=200, max_depth=3, learning_rate=0.05, random_state=42
            )
            mu_B_k = GradientBoostingRegressor(
                n_estimators=200, max_depth=3, learning_rate=0.05, random_state=43
            )
            mu_A_k.fit(X_tr[mask_A_tr], Y_tr[mask_A_tr])
            mu_B_k.fit(X_tr[mask_B_tr], Y_tr[mask_B_tr])
            mu_A_oof[te_idx] = mu_A_k.predict(X_te)
            mu_B_oof[te_idx] = mu_B_k.predict(X_te)

        e_oof = np.clip(e_oof, 0.05, 0.95)

        # ----------------------------------------------------------------
        # DR pseudo-outcomes (using cross-fit nuisance predictions)
        # ----------------------------------------------------------------
        psi_A = np.where(
            mask_A,
            mu_A_oof + (Y - mu_A_oof) / (1.0 - e_oof),
            mu_A_oof,
        )
        psi_B = np.where(
            mask_B,
            mu_B_oof + (Y - mu_B_oof) / e_oof,
            mu_B_oof,
        )
        psi_A = np.clip(psi_A, 0.0, 1.0)
        psi_B = np.clip(psi_B, 0.0, 1.0)

        # ----------------------------------------------------------------
        # Final regression models learn the smoothed counterfactual surface.
        # Trained on the FULL dataset using cross-fit pseudo-outcomes.
        # ----------------------------------------------------------------
        self.final_A = GradientBoostingRegressor(
            n_estimators=300, max_depth=3, learning_rate=0.03, random_state=44
        )
        self.final_B = GradientBoostingRegressor(
            n_estimators=300, max_depth=3, learning_rate=0.03, random_state=45
        )
        self.final_A.fit(X, psi_A)
        self.final_B.fit(X, psi_B)

        # ----------------------------------------------------------------
        # EconML DRLearner for the dashboard diagnostics (ATE, CATE).
        # ----------------------------------------------------------------
        t0 = time.time()
        self.dr = DRLearner(
            model_propensity=_propensity_pipeline(),
            model_regression=RandomForestRegressor(
                n_estimators=200, max_depth=6, random_state=42, n_jobs=-1
            ),
            model_final=GradientBoostingRegressor(
                n_estimators=200, max_depth=3, learning_rate=0.05, random_state=42
            ),
            random_state=42,
        )
        self.dr.fit(Y, T, X=X)
        fit_seconds = time.time() - t0

        e_full = self.propensity_clf.predict_proba(X)[:, 1]
        prop_mean = float(e_full.mean())
        prop_std = float(e_full.std())
        prop_auc = float(_auc(T, e_full))
        ate = float(self.dr.ate(X))
        cate = self.dr.effect(X, T0=0, T1=1).ravel()
        cate_for_hard = float(cate[(X[:, 3] == 1.0) | (X[:, 4] == 1.0)].mean())
        cate_for_easy = float(cate[(X[:, 3] == 0.0) & (X[:, 4] == 0.0)].mean())

        # Also report the cross-fit ATE (more theoretically sound)
        cf_ate = float(psi_B.mean() - psi_A.mean())

        self.training_meta = {
            "features": self.features,
            "n_train": int(len(X)),
            "n_folds_cross_fit": K,
            "fit_seconds": round(fit_seconds, 2),
            "propensity_mean": prop_mean,
            "propensity_std": prop_std,
            "propensity_auc": prop_auc,
            "ate_b_vs_a_drllearner": ate,
            "ate_b_vs_a_crossfit": cf_ate,
            "ate_b_vs_a_ci": None,
            "cate_mean_for_hard_txns": cate_for_hard,
            "cate_mean_for_easy_txns": cate_for_easy,
            "method": "DR-learner with 5-fold cross-fitting (Chernozhukov 2018) + EconML DRLearner for diagnostics",
        }
        return self.training_meta

    # -------------------------------------------------------------------
    # Counterfactual inference
    # -------------------------------------------------------------------

    def counterfactual_success(self, df: pd.DataFrame) -> pd.DataFrame:
        if self.final_A is None or self.final_B is None:
            raise RuntimeError("CausalRouter is not trained. Call .fit() first.")
        df = df.copy()
        df[self.features] = df[self.features].fillna(0.0)
        X = df[self.features].values.astype(float)

        p_a = self.final_A.predict(X)
        p_b = self.final_B.predict(X)
        p_a = np.clip(p_a, 0.0, 1.0)
        p_b = np.clip(p_b, 0.0, 1.0)

        out = pd.DataFrame(index=df.index)
        out["p_success_a_causal"] = p_a
        out["p_success_b_causal"] = p_b
        out["uplift_b_over_a_causal"] = p_b - p_a
        out["recommended_gateway_causal"] = np.where(p_b > p_a, "B", "A")
        return out

    # -------------------------------------------------------------------
    # Persistence
    # -------------------------------------------------------------------

    def save(self, path: Path | None = None):
        path = path or ARTIFACTS_DIR / "causal_router.joblib"
        joblib.dump({
            "dr": self.dr,
            "propensity": self.propensity_clf,
            "outcome_A": self.outcome_A,
            "outcome_B": self.outcome_B,
            "final_A": self.final_A,
            "final_B": self.final_B,
            "meta": self.training_meta,
        }, path)
        return path

    @classmethod
    def load(cls, path: Path | None = None) -> "CausalRouter":
        path = path or ARTIFACTS_DIR / "causal_router.joblib"
        bundle = joblib.load(path)
        obj = cls()
        obj.dr = bundle["dr"]
        obj.propensity_clf = bundle["propensity"]
        obj.outcome_A = bundle["outcome_A"]
        obj.outcome_B = bundle["outcome_B"]
        obj.final_A = bundle["final_A"]
        obj.final_B = bundle["final_B"]
        obj.training_meta = bundle["meta"]
        return obj


def _auc(y_true, y_score) -> float:
    if len(np.unique(y_true)) < 2:
        return float("nan")
    return float(roc_auc_score(y_true, y_score))


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------

def evaluate_causal_vs_naive_vs_truth(
    df: pd.DataFrame,
    causal: CausalRouter,
    naive_predict: pd.DataFrame,
) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    cf = causal.counterfactual_success(df)

    out = df[["txn_id", "gateway_chosen", "outcome",
              "p_success_a_true", "p_success_b_true"]].copy()
    out["p_success_a_naive"] = naive_predict["p_success_a_naive"].values
    out["p_success_b_naive"] = naive_predict["p_success_b_naive"].values
    out["p_success_a_causal"] = cf["p_success_a_causal"].values
    out["p_success_b_causal"] = cf["p_success_b_causal"].values

    out["recommended_naive"] = np.where(
        out["p_success_a_naive"] >= out["p_success_b_naive"], "A", "B"
    )
    out["recommended_causal"] = np.where(
        out["p_success_b_causal"] > out["p_success_a_causal"], "B", "A"
    )
    out["recommended_oracle"] = np.where(
        out["p_success_a_true"] >= out["p_success_b_true"], "A", "B"
    )

    out["bias_a_naive"] = out["p_success_a_naive"] - out["p_success_a_true"]
    out["bias_a_causal"] = out["p_success_a_causal"] - out["p_success_a_true"]
    out["bias_b_naive"] = out["p_success_b_naive"] - out["p_success_b_true"]
    out["bias_b_causal"] = out["p_success_b_causal"] - out["p_success_b_true"]
    out["abs_bias_uplift_naive"] = np.abs(
        (out["p_success_a_naive"] - out["p_success_b_naive"])
        - (out["p_success_a_true"] - out["p_success_b_true"])
    )
    out["abs_bias_uplift_causal"] = np.abs(
        (out["p_success_a_causal"] - out["p_success_b_causal"])
        - (out["p_success_a_true"] - out["p_success_b_true"])
    )

    disagree = out[out["recommended_naive"] != out["recommended_causal"]].copy()
    n_disagree = int(len(disagree))
    if n_disagree > 0:
        causal_correct = float(
            (disagree["recommended_causal"] == disagree["recommended_oracle"]).mean()
        )
        naive_correct = float(
            (disagree["recommended_naive"] == disagree["recommended_oracle"]).mean()
        )
        expected_success_naive_on_disagree = float(np.where(
            disagree["recommended_naive"] == "A",
            disagree["p_success_a_true"],
            disagree["p_success_b_true"],
        ).mean())
        expected_success_causal_on_disagree = float(np.where(
            disagree["recommended_causal"] == "A",
            disagree["p_success_a_true"],
            disagree["p_success_b_true"],
        ).mean())
    else:
        causal_correct = naive_correct = float("nan")
        expected_success_naive_on_disagree = expected_success_causal_on_disagree = float("nan")

    expected_success_naive_all = float(np.where(
        out["recommended_naive"] == "A",
        out["p_success_a_true"],
        out["p_success_b_true"],
    ).mean())
    expected_success_causal_all = float(np.where(
        out["recommended_causal"] == "A",
        out["p_success_a_true"],
        out["p_success_b_true"],
    ).mean())
    expected_success_oracle_all = float(np.where(
        out["recommended_oracle"] == "A",
        out["p_success_a_true"],
        out["p_success_b_true"],
    ).mean())

    summary = {
        "n_total": int(len(out)),
        "n_disagree_naive_vs_causal": n_disagree,
        "pct_disagree_naive_vs_causal": float(n_disagree / len(out)),
        "on_disagreements": {
            "causal_matches_oracle_pct": causal_correct,
            "naive_matches_oracle_pct": naive_correct,
            "expected_success_naive": expected_success_naive_on_disagree,
            "expected_success_causal": expected_success_causal_on_disagree,
            "uplift_gain_from_causal": expected_success_causal_on_disagree - expected_success_naive_on_disagree,
        },
        "overall_expected_success": {
            "naive_router": expected_success_naive_all,
            "causal_router": expected_success_causal_all,
            "oracle_router": expected_success_oracle_all,
            "gap_naive_vs_oracle": expected_success_oracle_all - expected_success_naive_all,
            "gap_causal_vs_oracle": expected_success_oracle_all - expected_success_causal_all,
            "lift_causal_over_naive": expected_success_causal_all - expected_success_naive_all,
        },
        "mean_abs_bias_uplift": {
            "naive": float(out["abs_bias_uplift_naive"].mean()),
            "causal": float(out["abs_bias_uplift_causal"].mean()),
        },
        # The headline causal-correction metric: signed bias of per-gateway
        # success-probability estimates. Naive overestimates both, but ESPECIALLY
        # the gateway that got selected-for-harder transactions (B).
        "mean_signed_bias_per_gateway": {
            "p_a_naive": float(out["bias_a_naive"].mean()),
            "p_a_causal": float(out["bias_a_causal"].mean()),
            "p_b_naive": float(out["bias_b_naive"].mean()),
            "p_b_causal": float(out["bias_b_causal"].mean()),
        },
        # The uplift estimate (p_a - p_b) is what routing decisions depend on.
        # Naive uplift is biased; causal uplift is closer to true.
        "uplift_estimate_mean": {
            "naive": float((out["p_success_a_naive"] - out["p_success_b_naive"]).mean()),
            "causal": float((out["p_success_a_causal"] - out["p_success_b_causal"]).mean()),
            "true": float((out["p_success_a_true"] - out["p_success_b_true"]).mean()),
        },
        # MSE of uplift estimate (lower is better)
        "uplift_mse": {
            "naive": float((((out["p_success_a_naive"] - out["p_success_b_naive"])
                            - (out["p_success_a_true"] - out["p_success_b_true"])) ** 2).mean()),
            "causal": float((((out["p_success_a_causal"] - out["p_success_b_causal"])
                            - (out["p_success_a_true"] - out["p_success_b_true"])) ** 2).mean()),
        },
        # Pearson correlation between estimated and true uplift (higher is better)
        "uplift_corr_with_truth": {
            "naive": float(np.corrcoef(
                out["p_success_a_naive"] - out["p_success_b_naive"],
                out["p_success_a_true"] - out["p_success_b_true"],
            )[0, 1]),
            "causal": float(np.corrcoef(
                out["p_success_a_causal"] - out["p_success_b_causal"],
                out["p_success_a_true"] - out["p_success_b_true"],
            )[0, 1]),
        },
    }
    return out, summary


def train_and_save():
    from naive_router import NaiveRouter

    df = pd.read_csv(DATA_DIR / "transactions.csv")

    print("Training causal router (DR-learner)...")
    causal = CausalRouter()
    meta = causal.fit(df)
    causal.save()
    print(json.dumps(meta, indent=2))

    naive = NaiveRouter(model_type="gbdt")
    naive.fit(df)
    naive.save()
    naive_pred = naive.predict_proba_per_gateway(df)

    print("\nEvaluating naive vs causal vs oracle...")
    cmp, summary = evaluate_causal_vs_naive_vs_truth(df, causal, naive_pred)
    cmp.to_csv(DATA_DIR / "router_comparison.csv", index=False)
    (ARTIFACTS_DIR / "causal_summary.json").write_text(json.dumps({
        "training_meta": meta, "evaluation": summary
    }, indent=2))
    print(json.dumps(summary, indent=2))
    return causal, summary


if __name__ == "__main__":
    train_and_save()
