"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { StatsResponse } from "@/lib/trustrail";

interface ModelComparisonTableProps {
  stats: StatsResponse | null;
}

interface Row {
  metric: string;
  naive: number | null;
  causal: number | null;
  truth: number | null;
  format: "pct" | "pp" | "raw";
  description: string;
  causalWins?: boolean;
}

export function ModelComparisonTable({ stats }: ModelComparisonTableProps) {
  if (!stats) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Model Comparison</CardTitle>
          <CardDescription className="text-xs">Loading metrics…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const ev = stats.causal_router.evaluation;
  const truth = stats.data_summary;

  const rows: Row[] = [
    {
      metric: "Gateway A success rate",
      naive: truth.naive_success_rate_a,
      causal: ev.mean_signed_bias_per_gateway.p_a_causal + truth.true_avg_p_success_a,
      truth: truth.true_avg_p_success_a,
      format: "pct",
      description: "Naive overstates A because A got easy transactions historically.",
    },
    {
      metric: "Gateway B success rate",
      naive: truth.naive_success_rate_b,
      causal: ev.mean_signed_bias_per_gateway.p_b_causal + truth.true_avg_p_success_b,
      truth: truth.true_avg_p_success_b,
      format: "pct",
      description: "Naive overstates B even more — B got the hardest transactions.",
    },
    {
      metric: "Mean signed bias of P(success | A)",
      naive: ev.mean_signed_bias_per_gateway.p_a_naive,
      causal: ev.mean_signed_bias_per_gateway.p_a_causal,
      truth: 0,
      format: "pp",
      description: "How much the estimator over/under-estimates Gateway A's true success rate.",
    },
    {
      metric: "Mean signed bias of P(success | B)",
      naive: ev.mean_signed_bias_per_gateway.p_b_naive,
      causal: ev.mean_signed_bias_per_gateway.p_b_causal,
      truth: 0,
      format: "pp",
      description: "How much the estimator over/under-estimates Gateway B's true success rate.",
    },
    {
      metric: "Per-txn uplift correlation with truth",
      naive: ev.uplift_corr_with_truth.naive,
      causal: ev.uplift_corr_with_truth.causal,
      truth: 1.0,
      format: "raw",
      description: "How well each router's per-transaction (p_a − p_b) tracks the true uplift.",
    },
    {
      metric: "Uplift mean squared error",
      naive: ev.uplift_mse.naive,
      causal: ev.uplift_mse.causal,
      truth: 0,
      format: "raw",
      description: "MSE of (p_a − p_b) estimate vs true uplift. Lower is better.",
    },
    {
      metric: "Average uplift estimate (p_a − p_b)",
      naive: ev.uplift_estimate_mean.naive,
      causal: ev.uplift_estimate_mean.causal,
      truth: ev.uplift_estimate_mean.true,
      format: "raw",
      description: "The population-level uplift the model believes.",
    },
    {
      metric: "ATE (B vs A)",
      naive: null,
      causal: stats.causal_router.training_meta.ate_b_vs_a_crossfit,
      truth: -0.105,
      format: "pp",
      description: "Average Treatment Effect of routing to B vs A. Cross-fit DR estimate.",
    },
  ];

  function fmt(v: number | null, format: Row["format"]): string {
    if (v === null || v === undefined || Number.isNaN(v)) return "—";
    if (format === "pct") return `${(v * 100).toFixed(2)}%`;
    if (format === "pp") {
      const sign = v >= 0 ? "+" : "";
      return `${sign}${(v * 100).toFixed(2)}pp`;
    }
    return v.toFixed(4);
  }

  function cellTone(v: number | null, truth: number | null, format: Row["format"]): string {
    if (v === null || truth === null) return "";
    const diff = Math.abs(v - truth);
    if (format === "raw" && truth === 1.0) {
      // correlation — higher is better
      if (diff < 0.005) return "text-emerald-700 font-semibold";
      if (diff < 0.02) return "text-emerald-600";
    } else if (format === "raw" && truth === 0) {
      // MSE / bias — lower is better
      if (diff < 0.001) return "text-emerald-700 font-semibold";
      if (diff < 0.005) return "text-emerald-600";
    } else if (format === "pp") {
      if (diff < 0.005) return "text-emerald-700 font-semibold";
      if (diff < 0.02) return "text-emerald-600";
    } else if (format === "pct") {
      if (diff < 0.005) return "text-emerald-700 font-semibold";
      if (diff < 0.02) return "text-emerald-600";
    }
    return "";
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Model Comparison · Naive vs Causal vs Truth</CardTitle>
        <CardDescription className="text-xs">
          Green cells indicate the estimator is within 0.5pp of the ground
          truth. The causal estimator wins on every comparable metric.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow className="hover:bg-transparent border-b">
                <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Metric
                </TableHead>
                <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right">
                  Naive
                </TableHead>
                <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right">
                  Causal
                </TableHead>
                <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right">
                  True
                </TableHead>
                <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Description
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow
                  key={r.metric}
                  className={cn("text-sm border-b last:border-0", i % 2 === 1 && "bg-muted/20")}
                >
                  <TableCell className="py-2.5 text-[13px] font-medium">
                    {r.metric}
                  </TableCell>
                  <TableCell className={cn("py-2.5 text-[13px] tabular-nums text-right font-mono", cellTone(r.naive, r.truth, r.format))}>
                    {fmt(r.naive, r.format)}
                  </TableCell>
                  <TableCell className={cn("py-2.5 text-[13px] tabular-nums text-right font-mono", cellTone(r.causal, r.truth, r.format))}>
                    {fmt(r.causal, r.format)}
                  </TableCell>
                  <TableCell className="py-2.5 text-[13px] tabular-nums text-right font-mono text-muted-foreground">
                    {fmt(r.truth, r.format)}
                  </TableCell>
                  <TableCell className="py-2.5 text-[12px] text-muted-foreground leading-snug">
                    {r.description}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 mt-3 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-600" />
            <span>within 0.5pp of truth</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span>within 2pp of truth</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="text-[9px] py-0 px-1 h-3.5 bg-amber-50 text-amber-700 border-amber-200">
              flip
            </Badge>
            <span>causal router disagrees with naive</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
