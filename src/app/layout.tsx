import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

// Inter — the de facto SaaS dashboard font (Stripe, Vercel, Linear, Notion).
// Designed specifically for screen readability at small sizes.
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

// JetBrains Mono — for code, transaction IDs, numeric data tables.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "TrustRail — Causal Payment Routing + Intent Risk",
  description: "Two-stage payment intelligence: pre-approval scam detection + counterfactual gateway routing using doubly-robust causal estimation.",
  keywords: ["TrustRail", "causal inference", "EconML", "DRLearner", "payment routing", "fraud detection", "UPI", "Next.js"],
  authors: [{ name: "TrustRail" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "TrustRail",
    description: "Causal payment routing + intent risk in one pipeline.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased bg-background text-foreground`}
        style={{ fontFamily: "var(--font-sans), system-ui, -apple-system, sans-serif" }}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
