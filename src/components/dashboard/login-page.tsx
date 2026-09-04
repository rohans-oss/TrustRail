"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck, Loader2, ArrowRight, Lock, Mail } from "lucide-react";

interface LoginPageProps {
  onLogin: (email: string) => void;
}

/**
 * Compact single-viewport login — fits in 100vh with no scroll.
 * Centered card on a dark gradient background (Vercel/Linear style).
 */
export function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = typeof window !== "undefined"
      ? window.localStorage.getItem("trustrail_session")
      : null;
    if (saved) {
      try {
        const s = JSON.parse(saved);
        if (s.email && s.loggedInAt) onLogin(s.email);
      } catch {
        /* ignore */
      }
    }
  }, [onLogin]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email || !email.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!password || password.length < 4) {
      setError("Password must be at least 4 characters.");
      return;
    }
    setLoading(true);
    setTimeout(() => {
      const session = { email, loggedInAt: new Date().toISOString() };
      window.localStorage.setItem("trustrail_session", JSON.stringify(session));
      onLogin(email);
      setLoading(false);
    }, 600);
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-950 relative overflow-hidden p-6">
      {/* Background decorations */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `
            linear-gradient(to right, white 1px, transparent 1px),
            linear-gradient(to bottom, white 1px, transparent 1px)
          `,
          backgroundSize: "48px 48px",
        }}
      />
      {/* Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-teal-500/10 blur-[120px] pointer-events-none" />

      {/* Centered card — fits in viewport */}
      <div className="relative z-10 w-full max-w-[400px]">
        {/* Brand header */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-teal-400 to-teal-600 shadow-lg shadow-teal-500/20 mb-4">
            <ShieldCheck className="h-5 w-5 text-white" />
          </div>
          <h1 className="text-[20px] font-semibold tracking-tight text-white">
            TrustRail
          </h1>
          <p className="text-[12px] text-slate-400 mt-1">
            Causal payment routing + intent risk
          </p>
        </div>

        {/* Login card */}
        <div className="bg-white rounded-xl shadow-2xl border border-slate-200/10 p-7">
          <div className="space-y-1.5 mb-5">
            <h2 className="text-[18px] font-semibold tracking-tight text-slate-900">
              Sign in
            </h2>
            <p className="text-[12px] text-slate-500">
              Access the operations dashboard
            </p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-[12px] font-medium text-slate-700">
                Work email
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9 h-10 text-[13px] bg-slate-50 border-slate-200"
                  placeholder="you@company.com"
                  autoComplete="email"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-[12px] font-medium text-slate-700">
                  Password
                </Label>
                <button
                  type="button"
                  className="text-[11px] text-teal-700 hover:text-teal-800 hover:underline"
                  onClick={() => setError("Contact your administrator to reset your password.")}
                >
                  Forgot?
                </button>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9 h-10 text-[13px] bg-slate-50 border-slate-200"
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </div>
            </div>

            {error && (
              <div className="text-[11px] text-rose-600 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-10 text-[13px] font-medium bg-slate-900 hover:bg-slate-800"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <ArrowRight className="h-4 w-4 mr-2" />
              )}
              {loading ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-[11px] text-slate-500 text-center mt-6">
          © 2026 TrustRail · All rights reserved
        </p>
      </div>
    </div>
  );
}
