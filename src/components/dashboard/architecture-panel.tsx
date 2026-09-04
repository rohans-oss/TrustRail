"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, GitBranch, Database, Layers, AlertTriangle } from "lucide-react";

/**
 * The "why this project is defensible" panel.
 * Explains the two-stage pipeline and why the causal estimator is the
 * actual gap in the crowded "smart routing" category.
 */
export function ArchitecturePanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Layers className="h-4 w-4" />
          Pipeline & Methodology
        </CardTitle>
        <CardDescription>
          One pipeline, two guards: a pre-approval scam check and a counterfactual
          gateway router that corrects for selection bias.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Stage 1 */}
        <div className="rounded-md border p-3 space-y-1.5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldAlert className="h-4 w-4 text-amber-600" />
            Stage 1 · Intent Risk (pre-approval)
            <Badge variant="outline" className="text-[10px]">Logistic regression</Badge>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Targets India/UPI-shaped social-engineering scams where the victim
            approves a fake &quot;collect request&quot; themselves. The transaction
            looks 100% legitimate to every existing signal (real device, real account,
            user-approved) because the fraud happened in the conversation, not the
            transaction. We model the pattern of the lead-up — first-time payee +
            high amount + collect direction + suspiciously fast approval + odd hour —
            and intervene with a friction step before approval.
          </p>
          <div className="flex flex-wrap gap-1 pt-1">
            <Badge variant="outline" className="text-[10px]">5 behavioral rules</Badge>
            <Badge variant="outline" className="text-[10px]">Human-readable reasons</Badge>
            <Badge variant="outline" className="text-[10px]">AUC &gt; 0.999 on synthetic data</Badge>
          </div>
        </div>

        {/* Stage 2 */}
        <div className="rounded-md border p-3 space-y-1.5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <GitBranch className="h-4 w-4 text-sky-600" />
            Stage 2 · Causal Routing
            <Badge variant="outline" className="text-[10px]">Doubly-Robust + 5-fold cross-fit</Badge>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Every &quot;smart routing&quot; product trains a classifier on historical
            outcomes and routes to the predicted winner. That has a hidden bug:
            routing decisions were never random. Gateway A got picked more often for
            easy transactions, so a naive model learns &quot;A looks great&quot; partly
            because of selection bias, not because A is actually better for a given
            transaction. Our router estimates the actual counterfactual success
            probability had this specific transaction gone to each gateway, using
            a doubly-robust estimator with cross-fitting.
          </p>
          <div className="flex flex-wrap gap-1 pt-1">
            <Badge variant="outline" className="text-[10px]">Propensity model</Badge>
            <Badge variant="outline" className="text-[10px]">Per-treatment outcome models</Badge>
            <Badge variant="outline" className="text-[10px]">DR pseudo-outcomes</Badge>
            <Badge variant="outline" className="text-[10px]">5-fold cross-fitting (Chernozhukov 2018)</Badge>
            <Badge variant="outline" className="text-[10px]">EconML DRLearner for ATE</Badge>
          </div>
        </div>

        {/* Confounding warning */}
        <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3 space-y-1.5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 text-rose-600" />
            The hidden bug in every &quot;correlational&quot; router
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Naive routing uses a biased estimator: it confuses &quot;which gateway
            succeeded most historically&quot; with &quot;which gateway would succeed
            for this transaction.&quot; In production, the operator&apos;s routing
            policy correlates with transaction difficulty (default to A for easy,
            overflow to B for hard) — that confounding silently mis-estimates the
            true causal effect of routing here vs there.
          </p>
        </div>

        {/* Stack */}
        <div className="rounded-md border p-3 space-y-1.5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Database className="h-4 w-4 text-muted-foreground" />
            Stack
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-muted-foreground uppercase tracking-wider text-[10px]">ML service</div>
              <div>Python · FastAPI · scikit-learn · EconML DRLearner</div>
            </div>
            <div>
              <div className="text-muted-foreground uppercase tracking-wider text-[10px]">Dashboard</div>
              <div>Next.js 16 · TypeScript · Prisma · shadcn/ui</div>
            </div>
            <div>
              <div className="text-muted-foreground uppercase tracking-wider text-[10px]">Persistence</div>
              <div>SQLite (Prisma) · JSONL decision log · joblib model artifacts</div>
            </div>
            <div>
              <div className="text-muted-foreground uppercase tracking-wider text-[10px]">Method</div>
              <div>DR-learner (Kennedy 2020) + 5-fold cross-fitting (Chernozhukov 2018)</div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
