"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, CheckCircle2, XCircle, ShieldAlert, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { fmtPct, timeAgo } from "@/lib/dashboard";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface ReviewItem {
  txnId: string;
  timestamp: string;
  payerId: string;
  payeeId: string;
  amount: number;
  direction: string;
  stage1Verdict: "pass" | "friction" | "hard_block";
  scamRiskScore: number;
  stage2Recommended: "A" | "B";
  finalAction: string;
  feedbackSource: string | null;
}

/**
 * Review Queue — lists transactions awaiting human-labeled feedback.
 *
 * Each row has 2 actions:
 *   - "Mark success" → logs feedback {outcome:1, source:"human_labeled"}
 *   - "Mark failure" → logs feedback {outcome:0, source:"human_labeled", failure_reason:"timeout"}
 *
 * Also lets the reviewer mark a transaction as a confirmed scam or not-a-scam.
 *
 * This is the FIX for the circular feedback loop: instead of letting the
 * dashboard auto-log the model's own prediction as the "outcome", an analyst
 * must review each row and tell us the real outcome.
 */
export function ReviewQueue({ onReviewed }: { onReviewed?: () => void }) {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [verdictFilter, setVerdictFilter] = useState<"all" | "pass" | "friction" | "hard_block">("friction");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = verdictFilter === "all" ? "" : `?verdict=${verdictFilter}`;
      const res = await fetch(`/api/review-queue${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.transactions || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [verdictFilter]);

  useEffect(() => { load(); }, [load]);

  async function submitReview(
    txnId: string,
    outcome: 1 | 0,
    isScam: 0 | 1 | null,
    gatewayUsed: "A" | "B",
  ) {
    setSubmitting(txnId);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          txn_id: txnId,
          gateway_actually_used: gatewayUsed,
          outcome,
          failure_reason: outcome === 0 ? "timeout" : "none",
          source: "human_labeled",
          is_scam: isScam,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "unknown" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      toast.success(`Marked ${txnId.slice(0, 20)}… as ${outcome === 1 ? "success" : "failure"}`, {
        description: isScam !== null
          ? `Fraud label: ${isScam === 1 ? "confirmed scam" : "not a scam"}`
          : "Logged as human_labeled (safe to retrain on)",
      });
      // Remove from list immediately, refresh
      setItems((prev) => prev.filter((i) => i.txnId !== txnId));
      onReviewed?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Review failed", { description: msg });
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-600" />
              Review Queue
              <Badge variant="outline" className="text-[10px] font-mono ml-1">
                {items.length} pending
              </Badge>
            </CardTitle>
            <CardDescription className="text-xs leading-relaxed max-w-2xl">
              Transactions awaiting human-labeled feedback. Each review logs
              the real outcome with <code className="text-[10px]">source: human_labeled</code> —
              the only feedback type <code className="text-[10px]">/retrain</code> will
              accept. This breaks the circular feedback loop where the model
              was previously retrained on its own predictions.
            </CardDescription>
          </div>
          <Select
            value={verdictFilter}
            onValueChange={(v: typeof verdictFilter) => setVerdictFilter(v)}
          >
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <Filter className="h-3 w-3 mr-1.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="friction">Stage 1: Friction</SelectItem>
              <SelectItem value="hard_block">Stage 1: Blocked</SelectItem>
              <SelectItem value="pass">Stage 1: Passed</SelectItem>
              <SelectItem value="all">All verdicts</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading review queue…
          </div>
        ) : error ? (
          <div className="p-4 text-xs text-rose-600">Failed to load: {error}</div>
        ) : items.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
            No transactions pending review. New decisions will appear here
            automatically.
          </div>
        ) : (
          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow className="hover:bg-transparent border-b">
                  <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Transaction
                  </TableHead>
                  <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right">
                    Amount
                  </TableHead>
                  <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Stage 1
                  </TableHead>
                  <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right">
                    Risk
                  </TableHead>
                  <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Recommended
                  </TableHead>
                  <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Was it fraud?
                  </TableHead>
                  <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right">
                    Outcome
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((t, i) => (
                  <TableRow key={t.txnId} className={cn("text-sm border-b last:border-0", i % 2 === 1 && "bg-muted/20")}>
                    <TableCell className="py-2.5">
                      <div className="font-mono text-[11px] text-foreground truncate max-w-[180px]">
                        {t.txnId}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {timeAgo(t.timestamp)} · {t.payerId} → {t.payeeId}
                      </div>
                    </TableCell>
                    <TableCell className="py-2.5 text-[12px] tabular-nums text-right font-medium">
                      ₹{t.amount.toLocaleString("en-IN")}
                    </TableCell>
                    <TableCell className="py-2.5">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] py-0 px-1.5 h-4 font-medium",
                          t.stage1Verdict === "pass" && "bg-emerald-50 text-emerald-700 border-emerald-200",
                          t.stage1Verdict === "friction" && "bg-amber-50 text-amber-700 border-amber-200",
                          t.stage1Verdict === "hard_block" && "bg-rose-50 text-rose-700 border-rose-200",
                        )}
                      >
                        {t.stage1Verdict === "pass" ? "Pass" : t.stage1Verdict === "friction" ? "Friction" : "Blocked"}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-2.5 text-[12px] tabular-nums text-right font-mono">
                      <span className={cn(
                        t.scamRiskScore >= 0.85 ? "text-rose-600"
                          : t.scamRiskScore >= 0.5 ? "text-amber-600"
                          : "text-muted-foreground"
                      )}>
                        {fmtPct(t.scamRiskScore, 1)}
                      </span>
                    </TableCell>
                    <TableCell className="py-2.5">
                      <span className="font-mono text-[12px] font-medium">
                        G{t.stage2Recommended}
                      </span>
                    </TableCell>
                    <TableCell className="py-2.5">
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] px-2 text-rose-700 border-rose-200 hover:bg-rose-50"
                          disabled={submitting === t.txnId}
                          onClick={() => submitReview(t.txnId, 0, 1, t.stage2Recommended)}
                        >
                          Yes, scam
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] px-2 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                          disabled={submitting === t.txnId}
                          onClick={() => submitReview(t.txnId, 1, 0, t.stage2Recommended)}
                        >
                          No, legit
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[10px] px-2 text-emerald-700 hover:bg-emerald-50"
                          disabled={submitting === t.txnId}
                          onClick={() => submitReview(t.txnId, 1, null, t.stage2Recommended)}
                          title="Mark as successful (no fraud label)"
                        >
                          <CheckCircle2 className="h-3 w-3 mr-0.5" />
                          Success
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[10px] px-2 text-rose-700 hover:bg-rose-50"
                          disabled={submitting === t.txnId}
                          onClick={() => submitReview(t.txnId, 0, null, t.stage2Recommended)}
                          title="Mark as failed (no fraud label)"
                        >
                          <XCircle className="h-3 w-3 mr-0.5" />
                          Failure
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
