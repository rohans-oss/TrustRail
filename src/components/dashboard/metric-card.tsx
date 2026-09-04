"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { fmtNum, fmtPct, fmtSignedPct } from "@/lib/dashboard";

interface MetricCardProps {
  label: string;
  value: string;
  sublabel?: string;
  tone?: "default" | "good" | "warn" | "bad";
}

export function MetricCard({ label, value, sublabel, tone = "default" }: MetricCardProps) {
  const toneCls = {
    default: "border-border",
    good: "border-emerald-500/30 bg-emerald-500/5",
    warn: "border-amber-500/30 bg-amber-500/5",
    bad: "border-rose-500/30 bg-rose-500/5",
  }[tone];

  return (
    <Card className={cn("overflow-hidden", toneCls)}>
      <CardHeader className="pb-2">
        <CardDescription className="text-xs uppercase tracking-wider">
          {label}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {sublabel && (
          <div className="text-xs text-muted-foreground mt-1">{sublabel}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface BiasComparisonProps {
  title: string;
  description?: string;
  naiveValue: number;
  causalValue: number;
  trueValue?: number;
  format?: "pct" | "pp" | "raw";
  lowerIsBetter?: boolean;
}

export function BiasComparisonCard({
  title,
  description,
  naiveValue,
  causalValue,
  trueValue,
  format = "pct",
  lowerIsBetter = false,
}: BiasComparisonProps) {
  const fmt = (x: number) => {
    if (format === "pct") return fmtPct(x);
    if (format === "pp") return fmtSignedPct(x);
    return fmtNum(x);
  };

  let causalCloser = false;
  if (trueValue !== undefined) {
    causalCloser = Math.abs(causalValue - trueValue) < Math.abs(naiveValue - trueValue);
  } else if (lowerIsBetter) {
    causalCloser = Math.abs(causalValue) < Math.abs(naiveValue);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Naive</div>
            <div className="font-mono text-sm tabular-nums">{fmt(naiveValue)}</div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Causal</div>
            <div className={cn("font-mono text-sm tabular-nums", causalCloser && "text-emerald-600 font-semibold")}>
              {fmt(causalValue)}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">
              {trueValue !== undefined ? "True" : "Target"}
            </div>
            <div className="font-mono text-sm tabular-nums text-muted-foreground">
              {trueValue !== undefined ? fmt(trueValue) : "—"}
            </div>
          </div>
        </div>
        {causalCloser && (
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/30">
            Causal estimator closer to truth
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}
