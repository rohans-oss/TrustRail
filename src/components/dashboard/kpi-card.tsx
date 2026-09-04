"use client";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import { useState } from "react";

interface KpiCardProps {
  label: string;
  value: string;
  sublabel?: string;
  delta?: { value: string; positive: boolean };
  tone?: "default" | "good" | "warn" | "bad";
  onClick?: () => void;
  active?: boolean;
  detailHint?: string;
}

/**
 * Interactive KPI card — Stripe Dashboard style.
 *
 * Behaviors:
 * - Hover: card lifts (shadow + border color shift) + cursor pointer
 * - Active: accent line gets thicker + card border darkens
 * - Click: triggers onClick (parent opens detail panel)
 * - Detail hint appears on hover (small "Click to drill down →" text)
 */
export function KpiCard({ label, value, sublabel, delta, tone = "default", onClick, active, detailHint }: KpiCardProps) {
  const [hovered, setHovered] = useState(false);
  const clickable = !!onClick;

  const accentLineCls = {
    default: "bg-slate-300",
    good: "bg-emerald-500",
    warn: "bg-amber-500",
    bad: "bg-rose-500",
  }[tone];

  return (
    <Card
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={clickable ? onClick : undefined}
      className={cn(
        "overflow-hidden relative pb-3 transition-all duration-150",
        clickable && "cursor-pointer",
        clickable && hovered && "shadow-md -translate-y-0.5 border-slate-300",
        clickable && active && "ring-2 ring-slate-900 ring-offset-1 border-slate-900 shadow-md",
        !clickable && "hover:shadow-sm"
      )}
      style={clickable && hovered ? { transform: "translateY(-2px)" } : undefined}
    >
      {/* Top accent line — thickens on hover/active */}
      <div
        className={cn(
          "transition-all duration-150",
          accentLineCls,
          clickable && hovered && "h-1",
          clickable && active && "h-1.5",
          !clickable || (!hovered && !active) ? "h-0.5" : ""
        )}
      />
      <div className="px-4 pt-3 pb-1">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
          {clickable && (
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 text-muted-foreground transition-all",
                hovered && "translate-x-0.5 text-slate-700",
                active && "text-slate-900"
              )}
            />
          )}
        </div>
        <div className="flex items-baseline gap-2 mt-1.5">
          <div className="text-2xl font-semibold tabular-nums tracking-tight">
            {value}
          </div>
          {delta && (
            <div className={cn(
              "text-[11px] font-medium tabular-nums",
              delta.positive ? "text-emerald-600" : "text-rose-600"
            )}>
              {delta.positive ? "↑" : "↓"} {delta.value}
            </div>
          )}
        </div>
        {sublabel && (
          <div className="text-[11px] text-muted-foreground mt-1 leading-tight">
            {sublabel}
          </div>
        )}
        {/* Hover hint — appears when card is clickable + hovered */}
        {clickable && detailHint && (
          <div
            className={cn(
              "text-[10px] text-slate-500 mt-2 transition-opacity duration-150",
              hovered ? "opacity-100" : "opacity-0"
            )}
          >
            {detailHint}
          </div>
        )}
      </div>
    </Card>
  );
}
