"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Play, RefreshCw, TrendingUp, TrendingDown } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fmtPct } from "@/lib/dashboard";
import type { StatsResponse } from "@/lib/trustrail";

interface ActionsPanelProps {
  stats: StatsResponse | null;
  onRefresh?: () => void;
}

/**
 * Phase 6/7 actions: batch simulator + feedback-driven retrain.
 * Both call the Python ML service through Next.js API routes.
 */
export function ActionsPanel({ stats, onRefresh }: ActionsPanelProps) {
  const [simLoading, setSimLoading] = useState(false);
  const [retrainLoading, setRetrainLoading] = useState(false);

  async function runBatch() {
    setSimLoading(true);
    try {
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ n: 20, scam_rate: 0.1 }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "unknown" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const blocked = data.responses.filter(
        (r: { final_action: string }) => r.final_action === "hard_block"
      ).length;
      const routed = data.responses.filter(
        (r: { final_action: string }) => r.final_action.startsWith("route_to_")
      ).length;
      toast.success(`Simulated ${data.n} transactions`, {
        description: `${blocked} blocked · ${routed} routed · check the live feed →`,
      });
      onRefresh?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Batch simulation failed", { description: msg });
    } finally {
      setSimLoading(false);
    }
  }

  async function retrain() {
    setRetrainLoading(true);
    try {
      // Item 1 (anti-circular-feedback-loop fix):
      // Previously this function logged 100 "feedback" rows where the outcome
      // was sampled from the model's OWN counterfactual estimate — that's
      // circular and /retrain now refuses to use such rows.
      //
      // New behavior: just call /retrain. The Python service will:
      //   - filter feedback.jsonl to only `human_labeled` / `observed_outcome`
      //   - return a friendly error if <50 usable rows exist
      //   - point the user to the Review Queue tab to log real labels
      const res = await fetch("/api/retrain", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = data.detail || data.error || `HTTP ${res.status}`;
        throw new Error(detail);
      }
      toast.success(`Retrained on ${data.n_training_rows} rows`, {
        description: `Feedback used: ${data.n_feedback_rows_used} · skipped: ${data.n_feedback_rows_skipped ?? 0} (circular) · new ATE: ${data.causal_meta?.ate_b_vs_a_crossfit?.toFixed(4) ?? "—"}`,
      });
      onRefresh?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // If the error mentions "USABLE feedback", surface a hint pointing to Review Queue
      const hint = msg.includes("USABLE") || msg.includes("Review Queue")
        ? " → Open the Review Queue tab to log real outcomes."
        : "";
      toast.error("Retrain blocked", { description: msg + hint });
    } finally {
      setRetrainLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pipeline actions</CardTitle>
        <CardDescription className="text-xs leading-relaxed">
          Run a batch of test transactions, then retrain on real feedback
          labels logged from the Review Queue. Retraining on auto-generated
          outcomes is blocked to prevent bias amplification.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={runBatch} disabled={simLoading} variant="outline" size="sm">
            {simLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Simulate batch (20)
          </Button>
          <Button onClick={retrain} disabled={retrainLoading} variant="outline" size="sm">
            {retrainLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Retrain from feedback
          </Button>
        </div>
        {stats && (
          <div className="grid grid-cols-3 gap-2 pt-2 border-t">
            <div className="text-center">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Recent decisions</div>
              <div className="font-mono text-sm tabular-nums">{stats.recent_decisions.n}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Blocked</div>
              <div className="font-mono text-sm tabular-nums text-rose-600">
                {stats.recent_decisions.n_hard_blocked}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Routed</div>
              <div className="font-mono text-sm tabular-nums text-sky-600">
                {stats.recent_decisions.n_routed}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
