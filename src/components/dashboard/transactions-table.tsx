"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Search, Filter, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DecisionResponse } from "@/lib/dashboard";
import { ACTION_LABELS, fmtPct, timeAgo } from "@/lib/dashboard";

interface TransactionsTableProps {
  transactions: DecisionResponse[];
  onSelect?: (txn: DecisionResponse) => void;
}

const PAGE_SIZE = 15;

/**
 * Professional data table for transactions — inspired by Stripe Dashboard.
 * Features: search, filter by verdict, sortable columns, pagination,
 * monospace IDs, right-aligned numeric columns, zebra stripes, sticky header.
 */
export function TransactionsTable({ transactions, onSelect }: TransactionsTableProps) {
  const [search, setSearch] = useState("");
  const [verdictFilter, setVerdictFilter] = useState<"all" | "pass" | "friction" | "hard_block">("all");
  const [actionFilter, setActionFilter] = useState<"all" | "route" | "friction" | "block">("all");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    let rows = transactions;
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((t) =>
        t.txn_id.toLowerCase().includes(q) ||
        (t.payer_id || "").toLowerCase().includes(q) ||
        (t.payee_id || "").toLowerCase().includes(q)
      );
    }
    if (verdictFilter !== "all") {
      rows = rows.filter((t) => t.stage1_verdict === verdictFilter);
    }
    if (actionFilter !== "all") {
      rows = rows.filter((t) => {
        const a = ACTION_LABELS[t.final_action]?.tone;
        return a === actionFilter;
      });
    }
    return rows;
  }, [transactions, search, verdictFilter, actionFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const resetPage = () => setPage(0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="text-base">Transactions</CardTitle>
            <CardDescription className="text-xs">
              {filtered.length} of {transactions.length} transactions ·
              paginated {PAGE_SIZE} per page
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" className="h-8 text-xs">
            <Download className="h-3 w-3 mr-1.5" /> Export CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); resetPage(); }}
              placeholder="Search by txn ID, payer, or payee..."
              className="pl-9 h-9 text-sm"
            />
          </div>
          <Select
            value={verdictFilter}
            onValueChange={(v: typeof verdictFilter) => { setVerdictFilter(v); resetPage(); }}
          >
            <SelectTrigger className="h-9 w-[140px] text-xs">
              <Filter className="h-3 w-3 mr-1.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All verdicts</SelectItem>
              <SelectItem value="pass">Stage 1: Pass</SelectItem>
              <SelectItem value="friction">Stage 1: Friction</SelectItem>
              <SelectItem value="hard_block">Stage 1: Blocked</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={actionFilter}
            onValueChange={(v: typeof actionFilter) => { setActionFilter(v); resetPage(); }}
          >
            <SelectTrigger className="h-9 w-[140px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actions</SelectItem>
              <SelectItem value="route">Routed</SelectItem>
              <SelectItem value="friction">Friction review</SelectItem>
              <SelectItem value="block">Hard blocked</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow className="hover:bg-transparent border-b">
                <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Transaction
                </TableHead>
                <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  When
                </TableHead>
                <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right">
                  Amount
                </TableHead>
                <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Direction
                </TableHead>
                <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right">
                  Risk
                </TableHead>
                <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Stage 1
                </TableHead>
                <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Stage 2
                </TableHead>
                <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Final Action
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-12">
                    No transactions match your filters.
                  </TableCell>
                </TableRow>
              ) : (
                pageRows.map((t, i) => {
                  const action = ACTION_LABELS[t.final_action] || { label: t.final_action, tone: "pass" };
                  return (
                    <TableRow
                      key={t.txn_id}
                      onClick={() => onSelect?.(t)}
                      className={cn(
                        "cursor-pointer text-sm border-b last:border-0 transition-colors",
                        i % 2 === 1 && "bg-muted/20",
                        "hover:bg-teal-50/40"
                      )}
                    >
                      <TableCell className="py-2.5">
                        <div className="font-mono text-[12px] text-foreground">
                          {t.txn_id}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {t.payer_id || "—"} → {t.payee_id || "—"}
                        </div>
                      </TableCell>
                      <TableCell className="py-2.5 text-[12px] text-muted-foreground whitespace-nowrap">
                        {timeAgo(t.timestamp)}
                      </TableCell>
                      <TableCell className="py-2.5 text-[13px] tabular-nums text-right font-medium">
                        {t.amount !== undefined ? `₹${t.amount.toLocaleString("en-IN")}` : "—"}
                      </TableCell>
                      <TableCell className="py-2.5">
                        <Badge variant="outline" className="text-[10px] font-mono py-0 px-1.5 h-4">
                          {(t.direction || "—").toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className={cn(
                        "py-2.5 text-[12px] tabular-nums text-right font-medium",
                        t.scam_risk_score >= 0.85 ? "text-rose-600"
                          : t.scam_risk_score >= 0.5 ? "text-amber-600"
                          : "text-muted-foreground"
                      )}>
                        {fmtPct(t.scam_risk_score, 1)}
                      </TableCell>
                      <TableCell className="py-2.5">
                        <Stage1Badge verdict={t.stage1_verdict} />
                      </TableCell>
                      <TableCell className="py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[12px] font-medium">
                            G{t.stage2_recommended_gateway}
                          </span>
                          {t.stage2_recommended_gateway !== t.stage2_naive_recommendation && (
                            <Badge variant="outline" className="text-[9px] py-0 px-1 h-3.5 bg-amber-50 text-amber-700 border-amber-200">
                              flip
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-2.5">
                        <ActionBadge tone={action.tone} label={action.label} />
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between text-xs">
          <div className="text-muted-foreground">
            Page {safePage + 1} of {totalPages} · {filtered.length} total
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setPage(Math.max(0, safePage - 1))}
              disabled={safePage === 0}
            >
              <ChevronLeft className="h-3 w-3" />
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))}
              disabled={safePage === totalPages - 1}
            >
              Next
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Stage1Badge({ verdict }: { verdict: string }) {
  const map: Record<string, string> = {
    pass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    friction: "bg-amber-50 text-amber-700 border-amber-200",
    hard_block: "bg-rose-50 text-rose-700 border-rose-200",
  };
  const labels: Record<string, string> = {
    pass: "Pass", friction: "Friction", hard_block: "Blocked",
  };
  return (
    <Badge variant="outline" className={cn("text-[10px] py-0 px-1.5 h-4 font-medium", map[verdict])}>
      {labels[verdict] || verdict}
    </Badge>
  );
}

function ActionBadge({ tone, label }: { tone: string; label: string }) {
  const map: Record<string, string> = {
    route: "bg-sky-50 text-sky-700 border-sky-200",
    friction: "bg-amber-50 text-amber-700 border-amber-200",
    block: "bg-rose-50 text-rose-700 border-rose-200",
    pass: "bg-emerald-50 text-emerald-700 border-emerald-200",
  };
  return (
    <Badge variant="outline" className={cn("text-[10px] py-0 px-1.5 h-4 font-medium", map[tone])}>
      {label}
    </Badge>
  );
}
