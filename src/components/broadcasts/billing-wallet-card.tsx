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
  Edit2,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { MetaBillingDetails } from "@/types";
import { toast } from "sonner";

interface BillingWalletCardProps {
  onFundsUpdated?: () => void;
}

export function BillingWalletCard({ onFundsUpdated }: BillingWalletCardProps = {}) {
  const [metaBilling, setMetaBilling] = useState<MetaBillingDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showRatesModal, setShowRatesModal] = useState(false);
  const [showUsageModal, setShowUsageModal] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncInput, setSyncInput] = useState<string>("82.43");
  const [syncing, setSyncing] = useState(false);

  async function loadBilling(isManual = false) {
    if (isManual) setRefreshing(true);
    try {
      const res = await fetch("/api/billing/funds");
      if (!res.ok) throw new Error("Failed to load billing");
      const data = await res.json();
      if (data.metaBilling) {
        setMetaBilling(data.metaBilling);
        setSyncInput(data.metaBilling.currentBalance?.toString() || "82.43");
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

  async function handleSyncBalance() {
    const bal = parseFloat(syncInput);
    if (isNaN(bal) || bal < 0) {
      toast.error("Please enter a valid balance.");
      return;
    }
    setSyncing(true);
    try {
      const res = await fetch("/api/billing/funds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_balance: bal }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to update balance");
      }
      toast.success(`Meta Balance updated to ₹${bal.toFixed(2)}!`);
      setShowSyncModal(false);
      await loadBilling();
      onFundsUpdated?.();
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message || "Failed to update balance");
    } finally {
      setSyncing(false);
    }
  }

  const metaBillingUrl =
    metaBilling?.whatsappManagerUrl || "https://business.facebook.com/billing_hub";
  const currentBalance = metaBilling?.currentBalance ?? 82.43;
  const isLowBalance = currentBalance < 100;

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
                Meta WhatsApp Billing &amp; Balance
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
                  Account: <strong className="text-foreground">{metaBilling.wabaName}</strong> (Payment Account: 2101170583827889)
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
      <div className={`rounded-xl border p-3.5 text-xs ${isLowBalance ? "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"}`}>
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-foreground">
              {isLowBalance ? "⚠️ Low Balance Alert: Current Meta Balance is ₹" + currentBalance.toFixed(2) : "Meta WhatsApp Billing Active"}
            </p>
            <p className="text-muted-foreground leading-relaxed">
              WhatsApp messaging charges are billed directly by <strong>Meta</strong> from your Meta Business Account prepaid balance. If your balance is low or runs out, broadcasts will fail with payment errors (such as <code>131056</code> / <code>131042</code>). Please <strong>go to your Meta Business Manager to add funds</strong> whenever balance is low.
            </p>
          </div>
        </div>
      </div>

      {/* Live Meta Account Stats Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Current Balance */}
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-1 relative">
          <div className="flex items-center justify-between text-muted-foreground text-xs">
            <span className="font-medium text-foreground">Current Balance</span>
            <button
              type="button"
              onClick={() => setShowSyncModal(true)}
              className="text-primary hover:underline inline-flex items-center gap-0.5 text-[11px]"
              title="Update balance from Meta"
            >
              <Edit2 className="h-3 w-3" /> Sync
            </button>
          </div>
          <div className="text-2xl font-extrabold text-primary">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              `₹${currentBalance.toFixed(2)}`
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">Remaining in Meta account</p>
        </div>

        {/* 30-Day Meta Spend (Clearly labeled as total expenditure) */}
        <div className="rounded-xl border border-border bg-card/60 p-3 space-y-1">
          <div className="flex items-center justify-between text-muted-foreground text-xs">
            <span>Total Spend (30d)</span>
            <TrendingUp className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="text-xl font-bold text-foreground">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              `₹${(metaBilling?.totalCost30d ?? 0).toFixed(2)}`
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">Total charged by Meta</p>
        </div>

        {/* 30-Day Message Volume */}
        <div className="rounded-xl border border-border bg-card/60 p-3 space-y-1">
          <div className="flex items-center justify-between text-muted-foreground text-xs">
            <span>Conversations (30d)</span>
            <Receipt className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="text-xl font-bold text-foreground">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              (metaBilling?.totalVolume30d ?? 0).toLocaleString()
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">Delivered paid sessions</p>
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
          <p className="text-[11px] text-muted-foreground">High account quality</p>
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

      {/* Modal: Sync / Update Balance */}
      <Dialog open={showSyncModal} onOpenChange={setShowSyncModal}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-primary" />
              Update Current Meta Balance
            </DialogTitle>
            <DialogDescription>
              After topping up funds in Meta Business Manager, update your current balance here to keep broadcast calculations and alerts accurate.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-sm">
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">
                Current Meta Balance (INR ₹)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-muted-foreground font-semibold">₹</span>
                <Input
                  type="number"
                  step="0.01"
                  value={syncInput}
                  onChange={(e) => setSyncInput(e.target.value)}
                  className="pl-7"
                  placeholder="82.43"
                />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              You can check your exact current balance anytime at{" "}
              <a
                href={metaBillingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-0.5"
              >
                Meta Billing Hub <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSyncModal(false)}
              disabled={syncing}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSyncBalance}
              disabled={syncing || !syncInput}
              className="gap-1.5"
            >
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save Balance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
