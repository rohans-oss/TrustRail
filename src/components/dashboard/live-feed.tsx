"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Radio, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DecisionResponse } from "@/lib/dashboard";
import { ACTION_LABELS, fmtPct, timeAgo } from "@/lib/dashboard";
import { DecisionCard } from "./decision-card";

const POLL_INTERVAL_MS = 5000;
const PAGE_SIZE = 30;

interface LiveFeedProps {
  selectedTxnId?: string;
  onSelectTxn?: (id: string) => void;
}

export function LiveFeed({ selectedTxnId, onSelectTxn }: LiveFeedProps) {
  const [transactions, setTransactions] = useState<DecisionResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchRecent = useCallback(async () => {
    try {
      const res = await fetch(`/api/transactions/recent?limit=${PAGE_SIZE}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setTransactions(data.transactions || []);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecent();
    const id = setInterval(fetchRecent, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchRecent]);

  function toggleExpand(txnId: string) {
    setExpanded(expanded === txnId ? null : txnId);
    onSelectTxn?.(txnId);
  }

  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base flex items-center gap-2">
              <Radio className="h-4 w-4 text-emerald-500 animate-pulse" />
              Live Decisions
            </CardTitle>
            <CardDescription className="text-xs">
              Recent transactions through the pipeline · refreshes every {POLL_INTERVAL_MS / 1000}s
            </CardDescription>
          </div>
          <Badge variant="outline" className="font-mono text-xs">
            {transactions.length}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-1 p-0">
        {loading && transactions.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading decisions…
          </div>
        ) : error ? (
          <div className="p-4 text-xs text-rose-600">
            Failed to load: {error}
            <button onClick={fetchRecent} className="ml-2 underline">Retry</button>
          </div>
        ) : transactions.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            No transactions yet. Fire one from the simulator →
          </div>
        ) : (
          <ScrollArea className="h-[calc(100vh-360px)] min-h-[400px]">
            <div className="px-3 pb-3 space-y-1">
              {transactions.map((t) => {
                const isExpanded = expanded === t.txn_id;
                const isSelected = selectedTxnId === t.txn_id;
                const action = ACTION_LABELS[t.final_action] || { label: t.final_action, tone: "pass" };
                return (
                  <div key={t.txn_id}>
                    <button
                      onClick={() => toggleExpand(t.txn_id)}
                      className={cn(
                        "w-full text-left rounded-md border px-3 py-2 transition-colors hover:bg-muted/40",
                        isExpanded ? "border-slate-300 bg-muted/20" : "border-border bg-white",
                        isSelected && !isExpanded && "border-teal-400 bg-teal-50/40"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex items-center gap-2 text-[12px]">
                            <span className="font-mono truncate text-foreground">
                              {t.txn_id}
                            </span>
                            <span className="text-muted-foreground">·</span>
                            <span className="text-muted-foreground text-[11px]">
                              {timeAgo(t.timestamp)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            <span className="font-mono font-medium">G{t.stage2_recommended_gateway}</span>
                            <span>·</span>
                            <span>risk {fmtPct(t.scam_risk_score, 1)}</span>
                            {t.stage2_recommended_gateway !== t.stage2_naive_recommendation && (
                              <Badge variant="outline" className="text-[9px] py-0 px-1 h-3.5 bg-amber-50 text-amber-700 border-amber-200">
                                flip
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px] py-0 px-1.5 h-4 font-medium",
                              action.tone === "route" && "bg-sky-50 text-sky-700 border-sky-200",
                              action.tone === "friction" && "bg-amber-50 text-amber-700 border-amber-200",
                              action.tone === "block" && "bg-rose-50 text-rose-700 border-rose-200",
                            )}
                          >
                            {action.label}
                          </Badge>
                          {isExpanded ? (
                            <ChevronUp className="h-3 w-3 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-3 w-3 text-muted-foreground" />
                          )}
                        </div>
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="pt-2 pb-2 pl-2 pr-2">
                        <DecisionCard decision={t} compact />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
