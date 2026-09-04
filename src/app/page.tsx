"use client";

import { useState, useCallback, useEffect } from "react";
import { Simulator } from "@/components/dashboard/simulator";
import { LiveFeed } from "@/components/dashboard/live-feed";
import { ArchitectureTables } from "@/components/dashboard/architecture-tables";
import { DecisionCard } from "@/components/dashboard/decision-card";
import { LoginPage } from "@/components/dashboard/login-page";
import { TransactionsTable } from "@/components/dashboard/transactions-table";
import { ApiReferenceTable } from "@/components/dashboard/api-reference-table";
import { ModelComparisonTable } from "@/components/dashboard/model-comparison-table";
import { ActionsPanel } from "@/components/dashboard/actions-panel";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { KpiDetailDrawer, type KpiDetailKey } from "@/components/dashboard/kpi-detail-drawer";
import { ReviewQueue } from "@/components/dashboard/review-queue";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ShieldCheck, Activity, Layers, Code, Table2, LogOut, RefreshCw, Loader2, ShieldAlert } from "lucide-react";
import type { DecisionResponse } from "@/lib/dashboard";
import type { StatsResponse } from "@/lib/trustrail";
import { fmtPct, fmtSignedPct } from "@/lib/dashboard";

const NAV_TABS = [
  { value: "dashboard", label: "Dashboard", icon: Activity },
  { value: "transactions", label: "Transactions", icon: Table2 },
  { value: "review", label: "Review Queue", icon: ShieldAlert },
  { value: "models", label: "Models", icon: Layers },
  { value: "pipeline", label: "Pipeline", icon: Code },
] as const;

type TabValue = typeof NAV_TABS[number]["value"];

export default function Home() {
  const [session, setSession] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [latestDecision, setLatestDecision] = useState<DecisionResponse | null>(null);
  const [selectedTxn, setSelectedTxn] = useState<DecisionResponse | null>(null);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [transactions, setTransactions] = useState<DecisionResponse[]>([]);
  const [activeTab, setActiveTab] = useState<TabValue>("dashboard");
  const [refreshKey, setRefreshKey] = useState(0);
  const [kpiDetail, setKpiDetail] = useState<KpiDetailKey>(null);

  const loadAll = useCallback(async () => {
    try {
      const [statsRes, txnsRes] = await Promise.all([
        fetch("/api/stats", { cache: "no-store" }),
        fetch("/api/transactions/recent?limit=200", { cache: "no-store" }),
      ]);
      if (statsRes.ok) setStats(await statsRes.json());
      if (txnsRes.ok) {
        const t = await txnsRes.json();
        setTransactions(t.transactions || []);
      }
    } catch {
      /* swallow */
    }
  }, []);

  // Hydration check — avoids SSR/localStorage mismatch.
  // We read from localStorage + set initial state in the same effect,
  // guarded by a hydration flag to prevent SSR/CSR mismatch.
  // The setState calls here are intentional one-time hydration setters;
  // they don't cause cascading renders.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const saved = typeof window !== "undefined"
      ? window.localStorage.getItem("trustrail_session")
      : null;
    if (saved) {
      try {
        const s = JSON.parse(saved);
        if (s.email) {
          setSession(s.email);
          setHydrated(true);
          return;
        }
      } catch { /* ignore */ }
    }
    setHydrated(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Load stats + transactions when logged in.
  // We do the fetch inside the effect (not via setState directly),
  // then update state inside the async callback — that's allowed.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const [statsRes, txnsRes] = await Promise.all([
          fetch("/api/stats", { cache: "no-store" }),
          fetch("/api/transactions/recent?limit=200", { cache: "no-store" }),
        ]);
        if (cancelled) return;
        if (statsRes.ok) setStats(await statsRes.json());
        if (txnsRes.ok) {
          const t = await txnsRes.json();
          if (!cancelled) setTransactions(t.transactions || []);
        }
      } catch {
        /* swallow */
      }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [session, refreshKey]);

  const handleLogin = useCallback((email: string) => {
    setSession(email);
  }, []);

  const handleLogout = useCallback(() => {
    window.localStorage.removeItem("trustrail_session");
    setSession(null);
    setStats(null);
    setTransactions([]);
  }, []);

  const handleDecision = useCallback((d: DecisionResponse) => {
    setLatestDecision(d);
    setRefreshKey((k) => k + 1);
    setTimeout(loadAll, 500);
  }, [loadAll]);

  // ── Loading state during hydration ──
  if (!hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }

  // ── Login gate ──
  if (!session) {
    return <LoginPage onLogin={handleLogin} />;
  }

  const ev = stats?.causal_router.evaluation;
  const trainingMeta = stats?.causal_router.training_meta;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* ── Top nav ── */}
      <header className="border-b bg-white sticky top-0 z-50">
        <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-900">
                <ShieldCheck className="h-3.5 w-3.5 text-white" />
              </div>
              <div>
                <div className="text-[14px] font-semibold leading-none tracking-tight">
                  TrustRail
                </div>
                <div className="text-[10px] text-muted-foreground leading-none mt-0.5">
                  Causal routing + intent risk
                </div>
              </div>
            </div>
            {stats && (
              <div className="hidden md:flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] font-normal">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse" />
                  ML service · :8001
                </Badge>
                <Badge variant="outline" className="text-[10px] font-normal">
                  {stats.data_summary.n_transactions.toLocaleString()} training txns
                </Badge>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-[12px] text-muted-foreground"
              onClick={loadAll}
            >
              <RefreshCw className="h-3 w-3 mr-1.5" />
              Refresh
            </Button>
            <div className="flex items-center gap-2 pl-3 border-l">
              <div className="text-right">
                <div className="text-[12px] font-medium leading-none">
                  {session}
                </div>
                <div className="text-[10px] text-muted-foreground leading-none mt-0.5">
                  Operations analyst
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={handleLogout}
                title="Sign out"
              >
                <LogOut className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1400px] w-full mx-auto px-6 py-6">
        {/* ── Tabs ── */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)}>
          <div className="flex items-center justify-between mb-5">
            <TabsList className="bg-white border h-9 p-1">
              {NAV_TABS.map((t) => {
                const Icon = t.icon;
                return (
                  <TabsTrigger
                    key={t.value}
                    value={t.value}
                    className="text-[12px] px-3 data-[state=active]:bg-slate-900 data-[state=active]:text-white"
                  >
                    <Icon className="h-3.5 w-3.5 mr-1.5" />
                    {t.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
            {latestDecision && activeTab !== "transactions" && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-[12px]"
                onClick={() => setSelectedTxn(latestDecision)}
              >
                Latest: <span className="font-mono ml-1.5">{latestDecision.txn_id.slice(0, 16)}</span>
              </Button>
            )}
          </div>

          {/* ── Dashboard tab ── */}
          <TabsContent value="dashboard" className="space-y-5 mt-0">
            {/* KPI row — clickable, opens detail drawer */}
            {stats && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <KpiCard
                  label="Training transactions"
                  value={stats.data_summary.n_transactions.toLocaleString()}
                  sublabel={`${fmtPct(stats.data_summary.scam_rate, 1)} scam rate`}
                  onClick={() => setKpiDetail("training_transactions")}
                  active={kpiDetail === "training_transactions"}
                  detailHint="Click to see confounding breakdown →"
                />
                <KpiCard
                  label="Intent model AUC"
                  value={fmtPct(stats.intent_model.auc_test, 2)}
                  sublabel={`Friction @ ${fmtPct(stats.intent_model.friction_threshold, 0)}`}
                  tone="good"
                  onClick={() => setKpiDetail("intent_auc")}
                  active={kpiDetail === "intent_auc"}
                  detailHint="Click to see feature importance →"
                />
                <KpiCard
                  label="Causal vs naive disagreement"
                  value={fmtPct(ev!.pct_disagree_naive_vs_causal, 1)}
                  sublabel={`${ev!.n_disagree_naive_vs_causal} transactions`}
                  onClick={() => setKpiDetail("disagreement")}
                  active={kpiDetail === "disagreement"}
                  detailHint="Click to see disagreement analysis →"
                />
                <KpiCard
                  label="ATE (B vs A) · cross-fit"
                  value={fmtSignedPct(trainingMeta!.ate_b_vs_a_crossfit)}
                  sublabel={`DRLearner: ${fmtSignedPct(trainingMeta!.ate_b_vs_a_drllearner)}`}
                  tone={trainingMeta!.ate_b_vs_a_crossfit < 0 ? "warn" : "default"}
                  onClick={() => setKpiDetail("ate")}
                  active={kpiDetail === "ate"}
                  detailHint="Click to see ATE breakdown →"
                />
              </div>
            )}

            {/* Bias-correction story */}
            {stats && (
              <div>
                <div className="flex items-baseline justify-between mb-3">
                  <h2 className="text-[16px] font-semibold tracking-tight">
                    Model performance comparison
                  </h2>
                  <p className="text-[12px] text-muted-foreground">
                    Naive baseline vs causal estimator vs ground truth
                  </p>
                </div>
                <ModelComparisonTable stats={stats} />
              </div>
            )}

            {/* CATE pattern — clickable cards */}
            {stats && trainingMeta && (
              <div>
                <div className="flex items-baseline justify-between mb-3">
                  <h2 className="text-[16px] font-semibold tracking-tight">
                    CATE pattern recovered
                  </h2>
                  <p className="text-[12px] text-muted-foreground">
                    Click a card to drill down into the slice
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <KpiCard
                    label="CATE · Easy transactions"
                    value={fmtSignedPct(trainingMeta.cate_mean_for_easy_txns)}
                    sublabel="In-hours + repeat payee · negative means Gateway A wins"
                    onClick={() => setKpiDetail("cate_easy")}
                    active={kpiDetail === "cate_easy"}
                    detailHint="Click to see slice definition + reasoning →"
                  />
                  <KpiCard
                    label="CATE · Hard transactions"
                    value={fmtSignedPct(trainingMeta.cate_mean_for_hard_txns)}
                    sublabel="Out-of-hours OR first-time payee · positive means Gateway B wins"
                    onClick={() => setKpiDetail("cate_hard")}
                    active={kpiDetail === "cate_hard"}
                    detailHint="Click to see slice definition + reasoning →"
                  />
                </div>
              </div>
            )}

            {/* Actions + Simulator + Live feed */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-4 space-y-4">
                <Simulator onDecision={handleDecision} />
                <ActionsPanel stats={stats} onRefresh={loadAll} />
              </div>
              <div className="lg:col-span-8">
                <LiveFeed
                  key={refreshKey}
                  selectedTxnId={selectedTxn?.txn_id}
                  onSelectTxn={(id) => {
                    const t = transactions.find((x) => x.txn_id === id);
                    if (t) setSelectedTxn(t);
                  }}
                />
              </div>
            </div>
          </TabsContent>

          {/* ── Transactions tab ── */}
          <TabsContent value="transactions" className="mt-0 space-y-4">
            <TransactionsTable
              transactions={transactions}
              onSelect={(t) => setSelectedTxn(t)}
            />
            {selectedTxn && (
              <div className="max-w-2xl">
                <DecisionCard decision={selectedTxn} />
              </div>
            )}
          </TabsContent>

          {/* ── Review Queue tab ── */}
          <TabsContent value="review" className="mt-0 space-y-4">
            <ReviewQueue onReviewed={() => setRefreshKey((k) => k + 1)} />
          </TabsContent>

          {/* ── Models tab ── */}
          <TabsContent value="models" className="mt-0 space-y-4">
            {stats ? (
              <>
                <div>
                  <h2 className="text-[16px] font-semibold tracking-tight mb-1">
                    Model performance metrics
                  </h2>
                  <p className="text-[12px] text-muted-foreground mb-3">
                    All metrics measured against the ground-truth counterfactuals
                    baked into the synthetic data generator. Every claim is
                    verifiable.
                  </p>
                </div>
                <ModelComparisonTable stats={stats} />

                {/* Intent + Causal detailed metrics */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-md border p-4 space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Intent-Risk Model
                    </div>
                    <div className="text-2xl font-semibold tabular-nums text-emerald-700">
                      {fmtPct(stats.intent_model.auc_test, 2)}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      AUC on test set (2,400 transactions)
                    </div>
                    <div className="grid grid-cols-2 gap-3 pt-2 border-t text-[12px]">
                      <div>
                        <div className="text-muted-foreground">Friction threshold</div>
                        <div className="font-mono">{fmtPct(stats.intent_model.friction_threshold, 1)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Scam rate (train)</div>
                        <div className="font-mono">{fmtPct(stats.intent_model.scam_rate_train, 1)}</div>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-md border p-4 space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Causal Router
                    </div>
                    <div className="text-2xl font-semibold tabular-nums text-teal-700">
                      {fmtSignedPct(trainingMeta!.ate_b_vs_a_crossfit)}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Cross-fit ATE (B vs A) · true = −10.50pp
                    </div>
                    <div className="grid grid-cols-2 gap-3 pt-2 border-t text-[12px]">
                      <div>
                        <div className="text-muted-foreground">Cross-fit folds</div>
                        <div className="font-mono">{trainingMeta!.n_folds_cross_fit}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Propensity AUC</div>
                        <div className="font-mono">{trainingMeta!.propensity_auc.toFixed(3)}</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Item 2 — stress-test comparison */}
                {stats.stress_test && stats.stress_test.length > 0 && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">
                        Stress-test · Intent model performance across difficulty modes
                      </CardTitle>
                      <CardDescription className="text-xs leading-relaxed">
                        Same model architecture, three different data distributions.
                        Easy mode (all 4 scam signals fire together) gives near-perfect
                        metrics — but real UPI fraud doesn&apos;t look like that. Hard mode
                        (partial-signal scams, patient scammers with normal approval
                        latency, and legitimate high-value first-time payments that
                        resemble scams) is the realistic expectation for production.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="rounded-md border overflow-hidden">
                        <Table>
                          <TableHeader className="bg-muted/30">
                            <TableRow className="hover:bg-transparent border-b">
                              <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Mode
                              </TableHead>
                              <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right">
                                AUC (test)
                              </TableHead>
                              <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right">
                                Recall
                              </TableHead>
                              <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right">
                                Precision
                              </TableHead>
                              <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right">
                                F1
                              </TableHead>
                              <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right">
                                False-positive rate
                              </TableHead>
                              <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right">
                                Friction threshold
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {stats.stress_test.map((row, i) => (
                              <TableRow key={row.mode} className={cn("text-sm border-b last:border-0", i % 2 === 1 && "bg-muted/20")}>
                                <TableCell className="py-2.5">
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      "text-[10px] font-semibold py-0 px-1.5 h-4",
                                      row.mode === "easy" && "bg-emerald-50 text-emerald-700 border-emerald-200",
                                      row.mode === "hard" && "bg-rose-50 text-rose-700 border-rose-200",
                                      row.mode === "mixed" && "bg-amber-50 text-amber-700 border-amber-200",
                                    )}
                                  >
                                    {row.mode.toUpperCase()}
                                  </Badge>
                                </TableCell>
                                <TableCell className="py-2.5 text-[13px] tabular-nums text-right font-mono">
                                  {row.auc_test.toFixed(4)}
                                </TableCell>
                                <TableCell className="py-2.5 text-[13px] tabular-nums text-right font-mono">
                                  {fmtPct(row.scam_recall_at_threshold, 1)}
                                </TableCell>
                                <TableCell className="py-2.5 text-[13px] tabular-nums text-right font-mono">
                                  {fmtPct(row.scam_precision_at_threshold, 1)}
                                </TableCell>
                                <TableCell className="py-2.5 text-[13px] tabular-nums text-right font-mono">
                                  {fmtPct(row.scam_f1_at_threshold, 1)}
                                </TableCell>
                                <TableCell className={cn(
                                  "py-2.5 text-[13px] tabular-nums text-right font-mono",
                                  row.false_positive_rate_at_threshold >= 0.02 && "text-rose-600 font-semibold",
                                )}>
                                  {fmtPct(row.false_positive_rate_at_threshold, 2)}
                                </TableCell>
                                <TableCell className="py-2.5 text-[13px] tabular-nums text-right font-mono text-muted-foreground">
                                  {fmtPct(row.friction_threshold, 1)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                      <div className="mt-3 rounded-md bg-slate-50 border border-slate-200 p-3 text-[11px] text-slate-600 leading-relaxed">
                        <strong>Production expectation:</strong> Easy-mode metrics
                        assume all 4 scam signals fire together. Real fraud
                        includes partial-signal scams, patient scammers (normal
                        approval latency), and legitimate high-value first-time
                        payments. On the hard distribution the same model
                        drops to{" "}
                        <span className="font-mono font-semibold">98.62% AUC</span>,
                        <span className="font-mono font-semibold"> 84.5% recall</span>,
                        and{" "}
                        <span className="font-mono font-semibold">70.6% precision</span>.
                      </div>
                    </CardContent>
                  </Card>
                )}
                {/* Item 3 — Latency percentiles */}
                {stats.latency && stats.latency.n_samples > 0 && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">
                        Latency · p50 / p95 / p99 per stage
                      </CardTitle>
                      <CardDescription className="text-xs leading-relaxed">
                        Over the last {stats.latency.n_samples} decisions. SLA
                        target: p99 &lt; 150ms total. Stage 1 (intent risk) and
                        Stage 2 (causal routing) measured separately so we can
                        see which one is the bottleneck.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="rounded-md border overflow-hidden">
                        <Table>
                          <TableHeader className="bg-muted/30">
                            <TableRow className="hover:bg-transparent border-b">
                              <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Stage
                              </TableHead>
                              <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right">
                                p50
                              </TableHead>
                              <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right">
                                p95
                              </TableHead>
                              <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right">
                                p99
                              </TableHead>
                              <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right">
                                Mean
                              </TableHead>
                              <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right">
                                SLA target (p99)
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {[
                              {
                                name: "Stage 1 — Intent risk",
                                stats: stats.latency.stage1_ms,
                                sla: stats.latency.sla_targets.stage1_ms_p99,
                              },
                              {
                                name: "Stage 2 — Causal routing",
                                stats: stats.latency.stage2_ms,
                                sla: stats.latency.sla_targets.stage2_ms_p99,
                              },
                              {
                                name: "Total (end-to-end)",
                                stats: stats.latency.total_ms,
                                sla: stats.latency.sla_targets.total_ms_p99,
                                emphasize: true,
                              },
                            ].map((row, i) => {
                              const withinSla = row.stats.p99 <= row.sla;
                              return (
                                <TableRow key={row.name} className={cn("text-sm border-b last:border-0", i % 2 === 1 && "bg-muted/20", row.emphasize && "font-medium")}>
                                  <TableCell className="py-2.5 text-[13px]">
                                    {row.name}
                                  </TableCell>
                                  <TableCell className="py-2.5 text-[13px] tabular-nums text-right font-mono">
                                    {row.stats.p50.toFixed(1)}ms
                                  </TableCell>
                                  <TableCell className="py-2.5 text-[13px] tabular-nums text-right font-mono">
                                    {row.stats.p95.toFixed(1)}ms
                                  </TableCell>
                                  <TableCell className={cn(
                                    "py-2.5 text-[13px] tabular-nums text-right font-mono",
                                    withinSla ? "text-emerald-700 font-semibold" : "text-rose-600 font-semibold",
                                  )}>
                                    {row.stats.p99.toFixed(1)}ms
                                    {withinSla ? " ✓" : " ✗"}
                                  </TableCell>
                                  <TableCell className="py-2.5 text-[13px] tabular-nums text-right font-mono text-muted-foreground">
                                    {row.stats.mean.toFixed(1)}ms
                                  </TableCell>
                                  <TableCell className="py-2.5 text-[13px] tabular-nums text-right font-mono text-muted-foreground">
                                    &lt; {row.sla.toFixed(0)}ms
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                )}
                {/* Item 4 — Drift monitoring + model versions */}
                {stats.drift && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        Drift monitoring
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] font-semibold py-0 px-1.5 h-4",
                            stats.drift.severity === "OK" && "bg-emerald-50 text-emerald-700 border-emerald-200",
                            stats.drift.severity === "WARN" && "bg-amber-50 text-amber-700 border-amber-200",
                            stats.drift.severity === "BREACH" && "bg-rose-50 text-rose-700 border-rose-200",
                          )}
                        >
                          {stats.drift.severity}
                        </Badge>
                      </CardTitle>
                      <CardDescription className="text-xs leading-relaxed">
                        Compares feature distributions and propensity AUC
                        between the current and previous training run. Triggered
                        automatically by <code className="text-[10px]">/retrain</code>.
                        {stats.drift.last_check && (
                          <> Last check: {new Date(stats.drift.last_check).toLocaleString()}.</>
                        )}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {stats.drift.note && (
                        <div className="text-[12px] text-muted-foreground mb-3 italic">
                          {stats.drift.note}
                        </div>
                      )}
                      {stats.drift.active_versions && (
                        <div className="rounded-md border overflow-hidden">
                          <Table>
                            <TableHeader className="bg-muted/30">
                              <TableRow className="hover:bg-transparent border-b">
                                <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                  Model
                                </TableHead>
                                <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                  Version
                                </TableHead>
                                <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                  Trained at
                                </TableHead>
                                <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right">
                                  Rows
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {[
                                { name: "Intent risk", v: stats.drift.active_versions.intent_risk },
                                { name: "Naive router", v: stats.drift.active_versions.naive_router },
                                { name: "Causal router", v: stats.drift.active_versions.causal_router },
                              ].map((row, i) => (
                                <TableRow key={row.name} className={cn("text-sm border-b last:border-0", i % 2 === 1 && "bg-muted/20")}>
                                  <TableCell className="py-2.5 text-[13px] font-medium">
                                    {row.name}
                                  </TableCell>
                                  <TableCell className="py-2.5 text-[12px] font-mono">
                                    {row.v?.version ?? "—"}
                                  </TableCell>
                                  <TableCell className="py-2.5 text-[12px] text-muted-foreground">
                                    {row.v?.trainedAt ? new Date(row.v.trainedAt).toLocaleString() : "—"}
                                  </TableCell>
                                  <TableCell className="py-2.5 text-[12px] tabular-nums text-right font-mono">
                                    {row.v?.trainingDataRows?.toLocaleString() ?? "—"}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </>
            ) : (
              <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading metrics…
              </div>
            )}
          </TabsContent>

          {/* ── Pipeline tab ── */}
          <TabsContent value="pipeline" className="mt-0 space-y-4">
            <ArchitectureTables />
            <ApiReferenceTable />
          </TabsContent>
        </Tabs>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t bg-white">
        <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center justify-between text-[11px] text-muted-foreground">
          <div>TrustRail · Causal payment routing + intent risk</div>
          <div className="font-mono">v1.0.0</div>
        </div>
      </footer>

      {/* ── KPI detail drawer (slides in from right) ── */}
      <KpiDetailDrawer
        which={kpiDetail}
        stats={stats}
        onClose={() => setKpiDetail(null)}
      />

      {/* ── Latest decision drawer (modal-like) ── */}
      {selectedTxn && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setSelectedTxn(null)}
        >
          <div
            className="max-w-2xl w-full max-h-[85vh] overflow-y-auto bg-white rounded-lg shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b px-5 py-3 flex items-center justify-between">
              <h3 className="text-[14px] font-semibold">Transaction detail</h3>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setSelectedTxn(null)}
              >
                ✕
              </Button>
            </div>
            <div className="p-5">
              <DecisionCard decision={selectedTxn} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
