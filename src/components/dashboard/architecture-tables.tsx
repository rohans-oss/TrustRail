"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ShieldAlert, GitBranch, Database, Layers } from "lucide-react";

const PIPELINE_ROWS = [
  {
    stage: "Stage 1",
    name: "Intent Risk (pre-approval)",
    icon: "shield",
    color: "amber",
    method: "Logistic regression · 9 behavioral features",
    target: "Social-engineering UPI collect-request scams where the victim approves the fraud themselves",
    intervention: "Hard block (≥85%) · Friction step (≥50%) · Pass (<50%)",
    metrics: "AUC 0.9994 · 100% recall · 84.7% precision",
  },
  {
    stage: "Stage 2",
    name: "Causal Routing (post-approval)",
    icon: "branch",
    color: "sky",
    method: "DR-learner + 5-fold cross-fit + EconML DRLearner",
    target: "Estimate counterfactual P(success) per gateway, corrected for selection bias",
    intervention: "Route to gateway with highest counterfactual P(success)",
    metrics: "Cross-fit ATE −9.78pp (true −10.5pp) · 17% MSE reduction",
  },
];

const STACK_ROWS = [
  { layer: "ML service", tech: "Python 3.12 · FastAPI", role: "Holds trained models, performs inference" },
  { layer: "ML libraries", tech: "scikit-learn 1.9 · EconML 0.17", role: "DR-learner, propensity models, classifiers" },
  { layer: "Dashboard", tech: "Next.js 16 · TypeScript 5", role: "Single-route dashboard + simulator" },
  { layer: "UI components", tech: "shadcn/ui · Tailwind CSS 4", role: "Consistent component library" },
  { layer: "Database", tech: "SQLite · Prisma ORM", role: "Stores every decision + feedback outcomes" },
  { layer: "Persistence", tech: "JSONL · joblib", role: "Decision log + serialized model artifacts" },
  { layer: "Causal method", tech: "DR-learner (Kennedy 2020)", role: "Doubly-robust counterfactual estimation" },
  { layer: "Cross-fitting", tech: "5-fold (Chernozhukov 2018)", role: "Avoids overfitting in nuisance models" },
];

export function ArchitectureTables() {
  return (
    <div className="space-y-4">
      {/* Pipeline table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Layers className="h-4 w-4" />
            Pipeline Stages
          </CardTitle>
          <CardDescription className="text-xs">
            One pipeline, two guards. Stage 1 stops the payer from being tricked;
            Stage 2 picks the smartest path for the money once it&apos;s genuinely
            a real payment.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow className="hover:bg-transparent border-b">
                  <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground w-[80px]">
                    Stage
                  </TableHead>
                  <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Name
                  </TableHead>
                  <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Method
                  </TableHead>
                  <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Target
                  </TableHead>
                  <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Intervention
                  </TableHead>
                  <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Metrics
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {PIPELINE_ROWS.map((r, i) => (
                  <TableRow key={r.stage} className={cn("text-sm border-b last:border-0", i % 2 === 1 && "bg-muted/20")}>
                    <TableCell className="py-3">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] font-semibold py-0 px-1.5 h-4",
                          r.color === "amber" && "bg-amber-50 text-amber-700 border-amber-200",
                          r.color === "sky" && "bg-sky-50 text-sky-700 border-sky-200"
                        )}
                      >
                        {r.stage}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-3 text-[13px] font-medium whitespace-nowrap">
                      {r.name}
                    </TableCell>
                    <TableCell className="py-3 text-[12px] font-mono text-muted-foreground">
                      {r.method}
                    </TableCell>
                    <TableCell className="py-3 text-[12px] text-muted-foreground leading-snug">
                      {r.target}
                    </TableCell>
                    <TableCell className="py-3 text-[12px] text-muted-foreground leading-snug">
                      {r.intervention}
                    </TableCell>
                    <TableCell className="py-3 text-[12px] font-mono">
                      {r.metrics}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Stack table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="h-4 w-4" />
            Technology Stack
          </CardTitle>
          <CardDescription className="text-xs">
            8 layers · all open-source · no external API keys required
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow className="hover:bg-transparent border-b">
                  <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground w-[180px]">
                    Layer
                  </TableHead>
                  <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Technology
                  </TableHead>
                  <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Role
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {STACK_ROWS.map((r, i) => (
                  <TableRow key={r.layer} className={cn("text-sm border-b last:border-0", i % 2 === 1 && "bg-muted/20")}>
                    <TableCell className="py-2.5 text-[13px] font-medium">
                      {r.layer}
                    </TableCell>
                    <TableCell className="py-2.5 text-[12px] font-mono text-foreground">
                      {r.tech}
                    </TableCell>
                    <TableCell className="py-2.5 text-[12px] text-muted-foreground">
                      {r.role}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Methodology callout — neutral slate, not alarming red */}
      <Card className="border-slate-200 bg-slate-50/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2 text-slate-900">
            <Layers className="h-4 w-4" />
            The methodology gap we close
          </CardTitle>
          <CardDescription className="text-xs text-slate-600">
            Naive routing uses a biased estimator. It confuses &quot;which
            gateway succeeded most historically&quot; with &quot;which gateway
            would succeed for this transaction.&quot;
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[12px]">
            <div className="rounded-md bg-white border border-slate-200 p-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
                Confounding source
              </div>
              <div className="text-slate-800 leading-relaxed">
                Operator&apos;s routing policy correlates with transaction
                difficulty (default A for easy, overflow B for hard).
              </div>
            </div>
            <div className="rounded-md bg-white border border-slate-200 p-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
                Silent effect
              </div>
              <div className="text-slate-800 leading-relaxed">
                Confounding silently mis-estimates the true causal effect of
                routing here vs there. Naive ATE is biased.
              </div>
            </div>
            <div className="rounded-md bg-white border border-emerald-200 p-3 bg-emerald-50/40">
              <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold mb-1">
                Our correction
              </div>
              <div className="text-slate-800 leading-relaxed">
                Doubly-robust estimator + 5-fold cross-fitting corrects for
                the bias if either propensity or outcome model is correctly
                specified.
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
