"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, ShieldCheck, ShieldAlert, GitBranch, Gauge } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DecisionResponse } from "@/lib/dashboard";
import { ACTION_LABELS, VERDICT_LABELS, fmtPct, fmtNum, timeAgo } from "@/lib/dashboard";

const verdictToneCls: Record<string, string> = {
  pass: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  friction: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  block: "bg-rose-500/10 text-rose-700 border-rose-500/30",
};

const actionToneCls: Record<string, string> = {
  route: "bg-sky-500/10 text-sky-700 border-sky-500/30",
  friction: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  block: "bg-rose-500/10 text-rose-700 border-rose-500/30",
  pass: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
};

interface DecisionCardProps {
  decision: DecisionResponse;
  compact?: boolean;
}

/**
 * The full per-transaction decision card — the "why" for every decision.
 * Shows Stage 1 verdict + reasons, then Stage 2 counterfactual probabilities
 * per gateway, with the naive estimator alongside for contrast.
 */
export function DecisionCard({ decision, compact = false }: DecisionCardProps) {
  const verdict = VERDICT_LABELS[decision.stage1_verdict];
  const action = ACTION_LABELS[decision.final_action];

  const cfA = decision.stage2_counterfactuals.find((c) => c.gateway === "A");
  const cfB = decision.stage2_counterfactuals.find((c) => c.gateway === "B");
  const causalAgree = decision.stage2_recommended_gateway === decision.stage2_naive_recommendation;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base flex items-center gap-2 font-mono">
              {decision.txn_id}
              {decision.processing_ms > 0 && (
                <span className="text-xs font-sans font-normal text-muted-foreground">
                  · Stage 1: {(decision.stage1_ms ?? 0).toFixed(0)}ms · Stage 2: {(decision.stage2_ms ?? 0).toFixed(0)}ms · Total: {decision.processing_ms.toFixed(0)}ms
                </span>
              )}
            </CardTitle>
            <CardDescription className="text-xs">
              {new Date(decision.timestamp).toLocaleString()} · {timeAgo(decision.timestamp)}
              {decision.payer_id && decision.payee_id && (
                <span className="ml-1">
                  · {decision.payer_id} → {decision.payee_id}
                  {decision.amount !== undefined && (
                    <span className="ml-1 font-mono">₹{decision.amount.toLocaleString("en-IN")}</span>
                  )}
                </span>
              )}
            </CardDescription>
          </div>
          <Badge variant="outline" className={cn("text-xs", actionToneCls[action.tone])}>
            {action.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Stage 1: Intent risk */}
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ShieldAlert className="h-4 w-4 text-muted-foreground" />
              Stage 1 · Intent Risk
            </div>
            <Badge variant="outline" className={cn("text-xs", verdictToneCls[verdict.tone])}>
              {verdict.label} · {fmtPct(decision.scam_risk_score, 2)}
            </Badge>
          </div>

          {decision.stage1_reasons.length === 0 ? (
            <p className="text-xs text-muted-foreground pl-6">
              No behavioral red flags. Cleared for routing.
            </p>
          ) : (
            <ul className="space-y-1.5 pl-6">
              {decision.stage1_reasons.map((r) => (
                <li key={r.id} className="text-xs space-y-0.5">
                  <div className="flex items-center gap-1.5 font-medium">
                    <AlertTriangle className="h-3 w-3 text-amber-500" />
                    {r.label}
                  </div>
                  {!compact && (
                    <div className="text-muted-foreground pl-4.5">{r.detail}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <Separator />

        {/* Stage 2: Causal routing */}
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <GitBranch className="h-4 w-4 text-muted-foreground" />
              Stage 2 · Causal Routing
            </div>
            <Badge variant="outline" className="text-xs">
              Recommend: <span className="font-mono ml-1">{decision.stage2_recommended_gateway}</span>
            </Badge>
          </div>

          {/* Counterfactual probabilities table */}
          <div className="grid grid-cols-2 gap-2 pl-6">
            {cfA && (
              <GatewayCounterfactualRow
                label="Gateway A"
                causal={cfA.p_success_causal}
                naive={cfA.p_success_naive}
                truth={cfA.p_success_true}
                highlighted={decision.stage2_recommended_gateway === "A"}
              />
            )}
            {cfB && (
              <GatewayCounterfactualRow
                label="Gateway B"
                causal={cfB.p_success_causal}
                naive={cfB.p_success_naive}
                truth={cfB.p_success_true}
                highlighted={decision.stage2_recommended_gateway === "B"}
              />
            )}
          </div>

          {/* Causal vs naive comparison */}
          <div className="pl-6 pt-1 space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Causal uplift (B over A)</span>
              <span className="font-mono tabular-nums">
                {fmtNum(decision.stage2_uplift_b_over_a, 4)}
                {decision.stage2_uplift_b_over_a > 0 ? " → B" : " → A"}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Naive router would pick</span>
              <span className={cn(
                "font-mono",
                causalAgree ? "text-muted-foreground" : "text-amber-600"
              )}>
                {decision.stage2_naive_recommendation}
                {!causalAgree && (
                  <span className="ml-1.5 text-[10px]">
                    (disagrees with causal)
                  </span>
                )}
              </span>
            </div>
          </div>
        </section>

        {!compact && (
          <>
            <Separator />
            <section className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Gauge className="h-4 w-4 text-muted-foreground" />
                Final Action
              </div>
              <p className="text-xs text-muted-foreground pl-6 leading-relaxed">
                {decision.final_action_reason}
              </p>
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface GatewayRowProps {
  label: string;
  causal: number;
  naive: number;
  truth: number | null | undefined;
  highlighted: boolean;
}

function GatewayCounterfactualRow({ label, causal, naive, truth, highlighted }: GatewayRowProps) {
  return (
    <div
      className={cn(
        "rounded-md border px-2.5 py-1.5 space-y-0.5",
        highlighted ? "border-sky-500/40 bg-sky-500/5" : "border-border"
      )}
    >
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{label}</span>
        {highlighted && (
          <ShieldCheck className="h-3 w-3 text-sky-600" />
        )}
      </div>
      <div className="grid grid-cols-2 gap-1 text-[10px]">
        <div>
          <div className="text-muted-foreground uppercase tracking-wider">Causal</div>
          <div className={cn("font-mono tabular-nums", highlighted && "text-sky-700 font-semibold")}>
            {fmtPct(causal)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground uppercase tracking-wider">Naive</div>
          <div className="font-mono tabular-nums text-muted-foreground">
            {fmtPct(naive)}
          </div>
        </div>
      </div>
      {truth !== null && truth !== undefined && (
        <div className="text-[10px] text-muted-foreground">
          Truth: <span className="font-mono">{fmtPct(truth)}</span>
        </div>
      )}
    </div>
  );
}
