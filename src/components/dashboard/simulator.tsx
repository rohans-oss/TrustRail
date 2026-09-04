"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Loader2, Send, Sparkles, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { DecisionResponse } from "@/lib/dashboard";

interface SimulatorProps {
  onDecision?: (d: DecisionResponse) => void;
}

const PRESETS = {
  normal: {
    label: "Normal send",
    description: "Repeat payee, in-hours, modest amount",
    values: {
      payer_id: "payer_8f3a2b",
      payee_id: "payee_9c4d1e",
      amount: 450,
      direction: "send" as const,
      hour_of_day: 14,
      approval_latency_ms: 8000,
      is_first_time_payee: false,
      is_high_risk_merchant: false,
    },
  },
  refund_scam: {
    label: "Refund scam",
    description: "Collect + first-time + high amount + odd hour",
    values: {
      payer_id: "payer_8f3a2b",
      payee_id: "payee_7a2b9c",
      amount: 9500,
      direction: "collect" as const,
      hour_of_day: 23,
      approval_latency_ms: 1100,
      is_first_time_payee: true,
      is_high_risk_merchant: false,
    },
  },
  hard_routing: {
    label: "Hard routing",
    description: "First-time + out-of-hours + high value",
    values: {
      payer_id: "payer_2d8e1f",
      payee_id: "payee_4f9a3b",
      amount: 5500,
      direction: "send" as const,
      hour_of_day: 3,
      approval_latency_ms: 12000,
      is_first_time_payee: true,
      is_high_risk_merchant: false,
    },
  },
};

type PresetKey = keyof typeof PRESETS;

export function Simulator({ onDecision }: SimulatorProps) {
  const [preset, setPreset] = useState<PresetKey>("normal");
  const [payerId, setPayerId] = useState(PRESETS.normal.values.payer_id);
  const [payeeId, setPayeeId] = useState(PRESETS.normal.values.payee_id);
  const [amount, setAmount] = useState(PRESETS.normal.values.amount);
  const [direction, setDirection] = useState<"send" | "qr" | "collect">(PRESETS.normal.values.direction);
  const [hour, setHour] = useState(PRESETS.normal.values.hour_of_day);
  const [latency, setLatency] = useState(PRESETS.normal.values.approval_latency_ms);
  const [firstTime, setFirstTime] = useState(PRESETS.normal.values.is_first_time_payee);
  const [highRisk, setHighRisk] = useState(PRESETS.normal.values.is_high_risk_merchant);
  const [loading, setLoading] = useState(false);

  function applyPreset(key: PresetKey) {
    setPreset(key);
    const p = PRESETS[key].values;
    setPayerId(p.payer_id);
    setPayeeId(p.payee_id);
    setAmount(p.amount);
    setDirection(p.direction);
    setHour(p.hour_of_day);
    setLatency(p.approval_latency_ms);
    setFirstTime(p.is_first_time_payee);
    setHighRisk(p.is_high_risk_merchant);
  }

  async function submit() {
    setLoading(true);
    try {
      const res = await fetch("/api/transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payer_id: payerId,
          payee_id: payeeId,
          amount,
          direction,
          hour_of_day: hour,
          approval_latency_ms: latency,
          is_first_time_payee: firstTime ? 1 : 0,
          is_high_risk_merchant: highRisk ? 1 : 0,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "unknown" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const decision: DecisionResponse = await res.json();
      onDecision?.(decision);
      toast.success(`Decision: ${decision.final_action.replace(/_/g, " ")}`, {
        description: `Risk ${(decision.scam_risk_score * 100).toFixed(2)}% · Gateway ${decision.stage2_recommended_gateway} · ${decision.processing_ms.toFixed(0)}ms`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Transaction failed", { description: msg });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Send className="h-4 w-4" />
          Transaction Simulator
        </CardTitle>
        <CardDescription className="text-xs leading-relaxed">
          Run a test transaction through both pipeline stages. Adjust the
          knobs to see how each stage responds.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Presets */}
        <div className="space-y-2">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Quick presets
          </Label>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(PRESETS) as PresetKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => applyPreset(key)}
                className={cn(
                  "rounded-md border px-2.5 py-2 text-left transition-colors",
                  preset === key
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-border bg-white hover:bg-muted/40"
                )}
              >
                <div className="text-[12px] font-medium leading-tight">
                  {PRESETS[key].label}
                </div>
                <div className={cn(
                  "text-[10px] mt-0.5 leading-tight",
                  preset === key ? "text-slate-300" : "text-muted-foreground"
                )}>
                  {PRESETS[key].description}
                </div>
              </button>
            ))}
          </div>
        </div>

          <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="payer" className="text-[12px] font-medium">Payer ID</Label>
            <Input id="payer" value={payerId} onChange={(e) => setPayerId(e.target.value)} className="h-9 font-mono text-[12px]" placeholder="e.g. payer_8f3a2b" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="payee" className="text-[12px] font-medium">Payee ID</Label>
            <Input id="payee" value={payeeId} onChange={(e) => setPayeeId(e.target.value)} className="h-9 font-mono text-[12px]" placeholder="e.g. payee_9c4d1e" />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-[12px] font-medium">Amount</Label>
            <span className="text-[12px] font-mono tabular-nums">₹{amount.toLocaleString("en-IN")}</span>
          </div>
          <Slider value={[amount]} min={50} max={15000} step={50} onValueChange={(v) => setAmount(v[0])} />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>₹50</span>
            <span>₹15,000</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-[12px] font-medium">Direction</Label>
            <Select value={direction} onValueChange={(v: "send" | "qr" | "collect") => setDirection(v)}>
              <SelectTrigger className="h-9 text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="send">Send (payer → payee)</SelectItem>
                <SelectItem value="qr">QR scan</SelectItem>
                <SelectItem value="collect">Collect request (payee → payer)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-[12px] font-medium">Hour of day</Label>
              <span className="text-[12px] font-mono tabular-nums">{hour.toString().padStart(2, "0")}:00</span>
            </div>
            <Slider value={[hour]} min={0} max={23} step={1} onValueChange={(v) => setHour(v[0])} />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-[12px] font-medium">Approval latency</Label>
            <span className="text-[12px] font-mono tabular-nums">{latency}ms</span>
          </div>
          <Slider value={[latency]} min={200} max={45000} step={100} onValueChange={(v) => setLatency(v[0])} />
          {latency < 2000 && (
            <div className="flex items-center gap-1.5 text-[10px] text-amber-600 mt-0.5">
              <AlertTriangle className="h-3 w-3" />
              Suspiciously fast — too quick to read the request.
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex items-center justify-between rounded-md border px-3 py-2 cursor-pointer hover:bg-muted/40">
            <span className="text-[12px] font-medium">First-time payee</span>
            <Switch checked={firstTime} onCheckedChange={setFirstTime} />
          </label>
          <label className="flex items-center justify-between rounded-md border px-3 py-2 cursor-pointer hover:bg-muted/40">
            <span className="text-[12px] font-medium">High-risk merchant</span>
            <Switch checked={highRisk} onCheckedChange={setHighRisk} />
          </label>
        </div>

        <Button onClick={submit} disabled={loading} className="w-full h-10 text-[13px] font-medium">
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
          {loading ? "Processing..." : "Run through pipeline"}
        </Button>
      </CardContent>
    </Card>
  );
}
