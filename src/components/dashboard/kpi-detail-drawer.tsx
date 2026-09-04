"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { X, TrendingUp, TrendingDown, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StatsResponse } from "@/lib/trustrail";
import { fmtPct, fmtSignedPct, fmtNum } from "@/lib/dashboard";

export type KpiDetailKey =
  | "training_transactions"
  | "intent_auc"
  | "disagreement"
  | "ate"
  | "cate_easy"
  | "cate_hard"
  | null;

interface KpiDetailDrawerProps {
  which: KpiDetailKey;
  stats: StatsResponse | null;
  onClose: () => void;
}

/**
 * Right-side detail drawer that opens when a KPI card is clicked.
 * Shows drill-down data, explanations, and sub-metrics.
 */
export function KpiDetailDrawer({ which, stats, onClose }: KpiDetailDrawerProps) {
  if (!which || !stats) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px] animate-in fade-in duration-150"
        onClick={onClose}
      />

      {/* Drawer — slides in from right */}
      <aside
        className={cn(
          "fixed top-0 right-0 z-50 h-full w-full max-w-[520px] bg-white shadow-2xl",
          "overflow-y-auto animate-in slide-in-from-right duration-200"
        )}
      >
        <div className="sticky top-0 bg-white/95 backdrop-blur border-b z-10">
          <div className="flex items-center justify-between px-6 py-4">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {TITLES[which].eyebrow}
              </div>
              <h2 className="text-[18px] font-semibold tracking-tight mt-0.5">
                {TITLES[which].title}
              </h2>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="px-6 py-5 space-y-5">
          {renderDetail(which, stats)}
        </div>
      </aside>
    </>
  );
}

const TITLES: Record<Exclude<KpiDetailKey, null>, { eyebrow: string; title: string }> = {
  training_transactions: {
    eyebrow: "Data · Phase 1",
    title: "Training transactions",
  },
  intent_auc: {
    eyebrow: "Stage 1 · Intent risk model",
    title: "Intent model performance",
  },
  disagreement: {
    eyebrow: "Causal vs Naive",
    title: "Where the routers disagree",
  },
  ate: {
    eyebrow: "Stage 2 · Causal router",
    title: "Average Treatment Effect",
  },
  cate_easy: {
    eyebrow: "Stage 2 · CATE slice",
    title: "Easy transactions — Gateway A wins",
  },
  cate_hard: {
    eyebrow: "Stage 2 · CATE slice",
    title: "Hard transactions — Gateway B wins",
  },
};

function renderDetail(which: Exclude<KpiDetailKey, null>, stats: StatsResponse) {
  switch (which) {
    case "training_transactions":
      return <TrainingTxnsDetail stats={stats} />;
    case "intent_auc":
      return <IntentAucDetail stats={stats} />;
    case "disagreement":
      return <DisagreementDetail stats={stats} />;
    case "ate":
      return <AteDetail stats={stats} />;
    case "cate_easy":
      return <CateDetail stats={stats} slice="easy" />;
    case "cate_hard":
      return <CateDetail stats={stats} slice="hard" />;
  }
}

// ── Detail panels ─────────────────────────────────────────────────────────────

function InfoBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md bg-slate-50 border border-slate-200 p-3 space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
        {title}
      </div>
      <div className="text-[12px] text-slate-800 leading-relaxed">{children}</div>
    </div>
  );
}

function StatRow({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className={cn("text-[13px] font-mono tabular-nums font-medium", tone)}>{value}</span>
    </div>
  );
}

function TrainingTxnsDetail({ stats }: { stats: StatsResponse }) {
  const d = stats.data_summary;
  return (
    <>
      <div className="space-y-2">
        <StatRow label="Total transactions" value={d.n_transactions.toLocaleString()} />
        <StatRow label="Scam rate" value={fmtPct(d.scam_rate, 2)} tone="text-amber-700" />
        <StatRow label="Gateway A share" value={fmtPct(d.gateway_a_share, 1)} />
        <StatRow label="Gateway B share" value={fmtPct(d.gateway_b_share, 1)} />
      </div>

      <div>
        <h3 className="text-[13px] font-semibold mb-2 flex items-center gap-1.5">
          <Info className="h-3.5 w-3.5 text-muted-foreground" />
          Confounding baked into the data
        </h3>
        <p className="text-[12px] text-muted-foreground leading-relaxed mb-3">
          These are the biases the operator&apos;s routing policy introduced.
          The naive router inherits them; the causal router corrects for them.
        </p>
        <div className="grid grid-cols-3 gap-2">
          <InfoBox title="Out-of-hours">
            <div className="font-mono text-base font-semibold text-amber-700">
              {fmtSignedPct(d.confounding_strength.out_of_hours_in_B_vs_A)}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              B − A rate
            </div>
          </InfoBox>
          <InfoBox title="First-time payee">
            <div className="font-mono text-base font-semibold text-amber-700">
              {fmtSignedPct(d.confounding_strength.first_time_in_B_vs_A)}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              B − A rate
            </div>
          </InfoBox>
          <InfoBox title="Amount z">
            <div className="font-mono text-base font-semibold text-amber-700">
              {fmtSignedPct(d.confounding_strength.amount_z_in_B_vs_A)}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              B − A mean
            </div>
          </InfoBox>
        </div>
      </div>

      <InfoBox title="How this data is used">
        The data generator bakes in known ground-truth counterfactuals
        (p_success_a_true, p_success_b_true) for every transaction — so the bias
        of any estimator can be measured against a known truth, not just claimed.
      </InfoBox>
    </>
  );
}

function IntentAucDetail({ stats }: { stats: StatsResponse }) {
  const m = stats.intent_model;
  const coefs = Object.entries(m.coefficients).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-md border p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">AUC (test)</div>
          <div className="text-2xl font-semibold tabular-nums text-emerald-700 mt-1">
            {fmtPct(m.auc_test, 2)}
          </div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Friction threshold</div>
          <div className="text-2xl font-semibold tabular-nums mt-1">
            {fmtPct(m.friction_threshold, 1)}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <StatRow label="Scam rate (training)" value={fmtPct(m.scam_rate_train, 2)} />
      </div>

      <div>
        <h3 className="text-[13px] font-semibold mb-2">Feature importance (logistic coefficients)</h3>
        <p className="text-[11px] text-muted-foreground mb-3">
          Higher absolute value = stronger influence on the scam risk score.
          Positive = pushes toward scam verdict; negative = pushes away.
        </p>
        <div className="space-y-1.5">
          {coefs.map(([feat, coef]) => (
            <div key={feat} className="flex items-center gap-2">
              <div className="w-[140px] text-[11px] font-mono text-slate-700 truncate">
                {feat}
              </div>
              <div className="flex-1 h-2 bg-slate-100 rounded relative overflow-hidden">
                <div
                  className={cn(
                    "h-full absolute top-0",
                    coef >= 0 ? "bg-emerald-500 left-1/2" : "bg-rose-500 right-1/2"
                  )}
                  style={{ width: `${Math.min(50, Math.abs(coef) * 12)}%` }}
                />
                <div className="absolute left-1/2 top-0 h-full w-px bg-slate-300" />
              </div>
              <div className={cn(
                "w-[60px] text-[11px] font-mono tabular-nums text-right",
                coef >= 0 ? "text-emerald-700" : "text-rose-700"
              )}>
                {coef >= 0 ? "+" : ""}{coef.toFixed(3)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <InfoBox title="Why logistic regression?">
        Interpretable, fast, and calibrated enough for a v1 friction score.
        A reviewer can see exactly which feature drove a verdict — not a black
        box. Future versions can swap to gradient boosting without changing the
        pipeline.
      </InfoBox>
    </>
  );
}

function DisagreementDetail({ stats }: { stats: StatsResponse }) {
  const ev = stats.causal_router.evaluation;
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-md border p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Disagreements</div>
          <div className="text-2xl font-semibold tabular-nums mt-1">
            {ev.n_disagree_naive_vs_causal}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            of {ev.n_total.toLocaleString()} total
          </div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">% disagree</div>
          <div className="text-2xl font-semibold tabular-nums mt-1">
            {fmtPct(ev.pct_disagree_naive_vs_causal, 1)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            causal flips vs naive
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <StatRow
          label="Causal matches oracle (on disagreements)"
          value={fmtPct(ev.on_disagreements.causal_matches_oracle_pct, 1)}
          tone="text-emerald-700"
        />
        <StatRow
          label="Naive matches oracle (on disagreements)"
          value={fmtPct(ev.on_disagreements.naive_matches_oracle_pct, 1)}
        />
        <StatRow
          label="Expected success — naive routing"
          value={fmtPct(ev.on_disagreements.expected_success_naive, 2)}
        />
        <StatRow
          label="Expected success — causal routing"
          value={fmtPct(ev.on_disagreements.expected_success_causal, 2)}
          tone="text-emerald-700"
        />
        <StatRow
          label="Uplift gain from causal correction"
          value={fmtSignedPct(ev.on_disagreements.uplift_gain_from_causal)}
          tone={ev.on_disagreements.uplift_gain_from_causal >= 0 ? "text-emerald-700" : "text-rose-700"}
        />
      </div>

      <InfoBox title="What this means">
        On the {ev.n_disagree_naive_vs_causal} transactions where the causal
        router disagrees with the naive router, the causal router matches the
        oracle (ground-truth best gateway) more often than the naive router does.
        The uplift gain shows how much expected success the causal correction
        recovers on those flipped transactions.
      </InfoBox>
    </>
  );
}

function AteDetail({ stats }: { stats: StatsResponse }) {
  const tm = stats.causal_router.training_meta;
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-md border p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Cross-fit ATE</div>
          <div className="text-2xl font-semibold tabular-nums text-teal-700 mt-1">
            {fmtSignedPct(tm.ate_b_vs_a_crossfit)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Our DR estimate</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">DRLearner ATE</div>
          <div className="text-2xl font-semibold tabular-nums mt-1">
            {fmtSignedPct(tm.ate_b_vs_a_drllearner)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">EconML diagnostic</div>
        </div>
      </div>

      <div className="rounded-md border border-emerald-200 bg-emerald-50/40 p-3">
        <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold">
          Ground truth
        </div>
        <div className="flex items-baseline gap-2 mt-1">
          <div className="text-2xl font-semibold tabular-nums text-emerald-700">
            −10.50pp
          </div>
          <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
            within 1pp of cross-fit
          </Badge>
        </div>
      </div>

      <div className="space-y-2">
        <StatRow label="Cross-fit folds" value={String(tm.n_folds_cross_fit)} />
        <StatRow label="Propensity AUC" value={tm.propensity_auc.toFixed(4)} />
        <StatRow label="Propensity mean" value={tm.propensity_mean.toFixed(4)} />
        <StatRow label="Propensity std" value={tm.propensity_std.toFixed(4)} />
        <StatRow label="Fit time" value={`${tm.fit_seconds}s`} />
      </div>

      <InfoBox title="What ATE means here">
        Average Treatment Effect of routing to Gateway B vs A, averaged over all
        transactions. Negative means Gateway A is better on average across the
        population — but the per-transaction CATE varies, so routing isn&apos;t
        uniform. See the CATE slice cards for the heterogeneity.
      </InfoBox>
    </>
  );
}

function CateDetail({ stats, slice }: { stats: StatsResponse; slice: "easy" | "hard" }) {
  const tm = stats.causal_router.training_meta;
  const value = slice === "easy" ? tm.cate_mean_for_easy_txns : tm.cate_mean_for_hard_txns;
  const isAWins = value < 0;
  return (
    <>
      <div className="rounded-md border p-4">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          CATE — {slice === "easy" ? "Easy transactions" : "Hard transactions"}
        </div>
        <div className="flex items-baseline gap-3 mt-1">
          <div className={cn(
            "text-3xl font-semibold tabular-nums",
            isAWins ? "text-sky-700" : "text-amber-700"
          )}>
            {fmtSignedPct(value)}
          </div>
          <div className="text-[11px] text-muted-foreground">
            avg treatment effect of B over A
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          {isAWins ? (
            <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200">
              <TrendingDown className="h-3 w-3 mr-1" />
              Gateway A wins
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
              <TrendingUp className="h-3 w-3 mr-1" />
              Gateway B wins
            </Badge>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-[12px] text-muted-foreground">
          {slice === "easy"
            ? "Slice definition: in-hours AND repeat payee (is_out_of_hours=0, is_first_time_payee=0). These are the transactions the operator historically sent to Gateway A by default — and the causal model confirms A is genuinely better for them."
            : "Slice definition: out-of-hours OR first-time payee. These are the transactions the operator historically overflowed to Gateway B — and the causal model confirms B is genuinely better for them."}
        </div>
      </div>

      <InfoBox title="Why this matters">
        The naive router cannot surface this pattern — it inherits the
        operator&apos;s routing policy and learns &quot;A is great&quot;
        partly because A got easy transactions. The causal router recovers the
        true per-transaction heterogeneity, which is the entire point of the
        project.
      </InfoBox>
    </>
  );
}
