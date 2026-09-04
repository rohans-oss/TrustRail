"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface Endpoint {
  method: "GET" | "POST";
  path: string;
  service: "python" | "nextjs";
  description: string;
  request: string;
  response: string;
}

const ENDPOINTS: Endpoint[] = [
  {
    method: "GET", path: "/health", service: "python",
    description: "Liveness + model load status",
    request: "—",
    response: "{status, models_loaded, n_training_txns}",
  },
  {
    method: "POST", path: "/transaction", service: "python",
    description: "Run a single transaction through both stages",
    request: "{payer_id, payee_id, amount, direction, hour_of_day, ...}",
    response: "{txn_id, stage1_verdict, stage2_recommended_gateway, ...}",
  },
  {
    method: "GET", path: "/stats", service: "python",
    description: "Headline metrics for dashboard",
    request: "—",
    response: "{data_summary, intent_model, naive_router, causal_router}",
  },
  {
    method: "GET", path: "/transactions/recent", service: "python",
    description: "Recent decisions from in-memory log",
    request: "?limit=N",
    response: "{transactions: [...]}",
  },
  {
    method: "GET", path: "/transaction/{txn_id}", service: "python",
    description: "Full decision detail + ground truth",
    request: "path: txn_id",
    response: "{raw_features, ground_truth, stage1, stage2}",
  },
  {
    method: "POST", path: "/feedback", service: "python",
    description: "Log actual outcome of a routed transaction",
    request: "{txn_id, gateway_actually_used, outcome, failure_reason}",
    response: "{status, txn_id}",
  },
  {
    method: "POST", path: "/simulate/batch", service: "python",
    description: "Run N synthetic transactions for demo",
    request: "{n, scam_rate?, seed?}",
    response: "{n, responses: [...]}",
  },
  {
    method: "POST", path: "/retrain", service: "python",
    description: "Retrain all 3 models on feedback-extended data",
    request: "—",
    response: "{status, n_training_rows, intent_meta, causal_meta}",
  },
  {
    method: "POST", path: "/api/transaction", service: "nextjs",
    description: "Submit transaction; proxy + persist to Prisma",
    request: "Same as Python /transaction",
    response: "Same + persisted row in SQLite",
  },
  {
    method: "GET", path: "/api/stats", service: "nextjs",
    description: "Proxy to Python /stats",
    request: "—",
    response: "Same as Python /stats",
  },
  {
    method: "GET", path: "/api/transactions/recent", service: "nextjs",
    description: "Pull from Prisma SQLite for live feed",
    request: "?limit=N",
    response: "{transactions: [...]}",
  },
  {
    method: "POST", path: "/api/simulate", service: "nextjs",
    description: "Batch simulator; persists each decision",
    request: "{n, scam_rate?, seed?}",
    response: "{n, responses: [...]}",
  },
  {
    method: "POST", path: "/api/feedback", service: "nextjs",
    description: "Proxy to Python /feedback (Phase 7)",
    request: "{txn_id, gateway_actually_used, outcome}",
    response: "{status, txn_id}",
  },
  {
    method: "POST", path: "/api/retrain", service: "nextjs",
    description: "Proxy to Python /retrain (Phase 7)",
    request: "—",
    response: "{status, n_training_rows, ...}",
  },
];

export function ApiReferenceTable() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">API Reference</CardTitle>
        <CardDescription className="text-xs">
          14 endpoints across two services · Python ML (port 8001) and Next.js
          proxy (port 3000) · No external API keys required
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow className="hover:bg-transparent border-b">
                <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground w-[80px]">
                  Method
                </TableHead>
                <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Path
                </TableHead>
                <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground w-[100px]">
                  Service
                </TableHead>
                <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Description
                </TableHead>
                <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Response shape
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ENDPOINTS.map((e, i) => (
                <TableRow
                  key={`${e.method}-${e.path}`}
                  className={cn("text-sm border-b last:border-0", i % 2 === 1 && "bg-muted/20")}
                >
                  <TableCell className="py-2.5">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] font-mono font-semibold py-0 px-1.5 h-4",
                        e.method === "GET"
                          ? "bg-sky-50 text-sky-700 border-sky-200"
                          : "bg-emerald-50 text-emerald-700 border-emerald-200"
                      )}
                    >
                      {e.method}
                    </Badge>
                  </TableCell>
                  <TableCell className="py-2.5 font-mono text-[12px] text-foreground whitespace-nowrap">
                    {e.path}
                  </TableCell>
                  <TableCell className="py-2.5">
                    <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4 font-medium">
                      {e.service === "python" ? "Python :8001" : "Next.js :3000"}
                    </Badge>
                  </TableCell>
                  <TableCell className="py-2.5 text-[12px] text-muted-foreground">
                    {e.description}
                  </TableCell>
                  <TableCell className="py-2.5 font-mono text-[11px] text-muted-foreground">
                    {e.response}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
