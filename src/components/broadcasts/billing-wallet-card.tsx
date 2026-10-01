"use client";

import { useEffect, useState } from "react";
import {
  Wallet,
  AlertTriangle,
  CheckCircle2,
  ArrowUpRight,
  Loader2,
  Receipt,
  HelpCircle,
  ExternalLink,
  ShieldCheck,
  TrendingUp,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { MetaBillingDetails } from "@/types";

interface BillingWalletCardProps {
  onFundsUpdated?: () => void;
}

export function BillingWalletCard({ onFundsUpdated }: BillingWalletCardProps = {}) {
  const [metaBilling, setMetaBilling] = useState<MetaBillingDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showRatesModal, setShowRatesModal] = useState(false);
  const [showUsageModal, setShowUsageModal] = useState(false);

  async function loadBilling(isManual = false) {
    if (isManual) setRefreshing(true);
    try {
      const res = await fetch("/api/billing/funds");
      if (!res.ok) throw new Error("Failed to load billing");
      const data = await res.json();
      if (data.metaBilling) {
        setMetaBilling(data.metaBilling);
      }
    } catch (err) {
      console.warn("[BillingWalletCard] load error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadBilling();
  }, []);

  const metaBillingUrl =
    metaBilling?.whatsappManagerUrl || "https://business.facebook.com/billing_hub";

  return (
    <div className="rounded-2xl border border-border/80 bg-gradient-to-br from-card via-card/90 to-background p-5 shadow-sm space-y-4">
      {/* Top Bar: Title & Meta Status */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Wallet className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-foreground text-base">
                Meta WhatsApp Billing &amp; Usage
              </h3>
              {metaBilling?.connected && (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  <ShieldCheck className="h-3 w-3" /> Meta Connected
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {metaBilling?.wabaName ? (
                <>
                  Account: <strong className="text-foreground">{metaBilling.wabaName}</strong> (WABA ID: {metaBilling.wabaId})
                </>
              ) : (
                "Direct connection to your Meta WhatsApp Business Account"
              )}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => loadBilling(true)}
            disabled={refreshing}
            className="h-8 text-xs text-muted-foreground hover:text-foreground"
            title="Refresh Meta Billing"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowRatesModal(true)}
            className="h-8 text-xs border-border text-muted-foreground hover:text-foreground gap-1.5"
          >
            <HelpCircle className="h-3.5 w-3.5" />
            Rate Card
          </Button>

          {/* Primary CTA: Go to Meta Account to Add Funds */}
          <a
            href={metaBillingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-3.5 py-1.5 text-xs shadow-sm transition-colors"
          >
            <span>Go to Meta Account &amp; Add Funds</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      {/* Notice Banner: Low Fund / Meta Account Guidance */}
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-900 dark:text-amber-200">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-foreground">
              Official Meta Billing Notice
            </p>
            <p className="text-muted-foreground leading-relaxed">
              WhatsApp messaging charges are billed directly by <strong>Meta</strong> through your Meta Business Account. If your balance is low, prepaid credit is exhausted, or broadcasts fail with payment errors, please <strong>go to your Meta Business Account to add funds</strong> or update your payment card.
            </p>
          </div>
        </div>
      </div>

      {/* Live Meta Account Stats Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* 30-Day Meta Spend */}
        <div className="rounded-xl border border-border bg-card/60 p-3 space-y-1">
          <div className="flex items-center justify-between text-muted-foreground text-xs">
            <span>Meta Spend (30d)</span>
            <TrendingUp className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="text-xl font-bold text-foreground">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              `₹${(metaBilling?.totalCost30d ?? 0).toFixed(2)}`
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">Actual Meta API charges</p>
        </div>

        {/* 30-Day Message Volume */}
        <div className="rounded-xl border border-border bg-card/60 p-3 space-y-1">
          <div className="flex items-center justify-between text-muted-foreground text-xs">
            <span>Volume (30d)</span>
            <Receipt className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="text-xl font-bold text-foreground">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              (metaBilling?.totalVolume30d ?? 0).toLocaleString()
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">Paid conversation sessions</p>
        </div>

        {/* Quality Rating */}
        <div className="rounded-xl border border-border bg-card/60 p-3 space-y-1">
          <div className="flex items-center justify-between text-muted-foreground text-xs">
            <span>Quality Rating</span>
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          </div>
          <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 capitalize">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              metaBilling?.qualityRating?.toLowerCase() || "Green"
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">Account health status</p>
        </div>

        {/* Account Currency & Review Status */}
        <div className="rounded-xl border border-border bg-card/60 p-3 space-y-1">
          <div className="flex items-center justify-between text-muted-foreground text-xs">
            <span>Currency &amp; Review</span>
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="text-xl font-bold text-foreground">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              `${metaBilling?.currency || "INR"} · ${metaBilling?.accountReviewStatus || "APPROVED"}`
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">Meta Business Account</p>
        </div>
      </div>

      {/* Footer Info: Meta Links & Daily Spend Explorer */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowUsageModal(true)}
            className="text-primary hover:underline font-medium inline-flex items-center gap-1"
          >
            <TrendingUp className="h-3 w-3" /> View Daily Meta Spend Breakdown
          </button>
        </div>

        <div className="flex items-center gap-4">
          <a
            href="https://business.facebook.com/billing_hub"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground inline-flex items-center gap-1 transition-colors"
          >
            Meta Billing Hub <ExternalLink className="h-3 w-3" />
          </a>
          <a
            href={metaBillingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground inline-flex items-center gap-1 transition-colors"
          >
            WhatsApp Manager <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      {/* Modal: Official Meta Rate Card */}
      <Dialog open={showRatesModal} onOpenChange={setShowRatesModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-primary" />
              Meta WhatsApp Conversation Rates
            </DialogTitle>
            <DialogDescription>
              Standard Meta conversation pricing per message for India (INR). Charged per 24-hour conversation window or template send.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-sm">
            <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
              <div className="flex items-center justify-between p-3 bg-muted/30">
                <div>
                  <p className="font-semibold text-foreground">Marketing Template</p>
                  <p className="text-xs text-muted-foreground">Offers, product launches, newsletters</p>
                </div>
                <span className="font-mono font-bold text-foreground">₹0.88 / msg</span>
              </div>

              <div className="flex items-center justify-between p-3">
                <div>
                  <p className="font-semibold text-foreground">Utility Template</p>
                  <p className="text-xs text-muted-foreground">Order updates, reminders, account alerts</p>
                </div>
                <span className="font-mono font-bold text-foreground">₹0.15 / msg</span>
              </div>

              <div className="flex items-center justify-between p-3 bg-muted/30">
                <div>
                  <p className="font-semibold text-foreground">Authentication (OTP)</p>
                  <p className="text-xs text-muted-foreground">One-time passwords, verification codes</p>
                </div>
                <span className="font-mono font-bold text-foreground">₹0.15 / msg</span>
              </div>

              <div className="flex items-center justify-between p-3">
                <div>
                  <p className="font-semibold text-foreground">Service Conversations</p>
                  <p className="text-xs text-muted-foreground">Customer-initiated inbound support</p>
                </div>
                <span className="font-mono font-bold text-foreground">₹0.30 / 24h</span>
              </div>
            </div>

            <div className="rounded-lg border border-border/80 bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">💡 How Meta Billing Works</p>
              <p>
                Meta deducts charges from your Meta Business Account prepaid balance or charges your linked credit card. If you broadcast a marketing template to 1,000 users, Meta will charge approximately <strong>₹880.00</strong>.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal: Daily Meta Spend Breakdown */}
      <Dialog open={showUsageModal} onOpenChange={setShowUsageModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              Meta Graph API Spend History (Last 30 Days)
            </DialogTitle>
            <DialogDescription>
              Live messaging volume and cost data points reported directly by Meta Pricing Analytics for {metaBilling?.wabaName || "your account"}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 max-h-80 overflow-y-auto">
            {metaBilling?.recentDataPoints && metaBilling.recentDataPoints.length > 0 ? (
              <div className="divide-y divide-border rounded-xl border border-border overflow-hidden text-xs">
                <div className="grid grid-cols-3 bg-muted/50 p-2.5 font-medium text-muted-foreground">
                  <span>Date</span>
                  <span className="text-center">Volume</span>
                  <span className="text-right">Meta Cost</span>
                </div>
                {metaBilling.recentDataPoints.map((dp, idx) => (
                  <div key={idx} className="grid grid-cols-3 p-2.5 items-center">
                    <span className="text-foreground">
                      {new Date(dp.start * 1000).toLocaleDateString([], {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                    <span className="text-center text-muted-foreground font-mono">
                      {dp.volume.toLocaleString()} msgs
                    </span>
                    <span className="text-right font-semibold text-foreground font-mono">
                      ₹{dp.cost.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-xs text-muted-foreground">
                No recent paid usage recorded by Meta for this billing window.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
