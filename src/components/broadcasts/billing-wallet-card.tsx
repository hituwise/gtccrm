"use client";

import { useEffect, useState } from "react";
import {
  Wallet,
  Plus,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  ArrowDownLeft,
  Loader2,
  Receipt,
  HelpCircle,
} from "lucide-react";
import { toast } from "sonner";
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
import type { AccountWallet, BillingTransaction } from "@/types";

interface BillingWalletCardProps {
  onFundsUpdated?: () => void;
}

export function BillingWalletCard({ onFundsUpdated }: BillingWalletCardProps) {
  const [wallet, setWallet] = useState<AccountWallet | null>(null);
  const [transactions, setTransactions] = useState<BillingTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showRatesModal, setShowRatesModal] = useState(false);

  // Add Funds form state
  const [amount, setAmount] = useState<string>("1000");
  const [description, setDescription] = useState<string>("Messaging Funds Recharge");
  const [reference, setReference] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  async function loadBilling() {
    try {
      const res = await fetch("/api/billing/funds");
      if (!res.ok) throw new Error("Failed to load billing");
      const data = await res.json();
      setWallet(data.wallet);
      setTransactions(data.transactions || []);
    } catch (err) {
      console.warn("[BillingWalletCard] load error:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBilling();
  }, []);

  async function handleAddFunds() {
    const num = parseFloat(amount);
    if (isNaN(num) || num <= 0) {
      toast.error("Please enter a valid amount.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/billing/funds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: num,
          description: description.trim() || "Messaging Funds Top-up",
          reference: reference.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to add funds");
      }

      toast.success(`Successfully added ₹${num.toLocaleString()} to messaging funds!`, {
        description: `New Available Balance: ₹${Number(data.newBalance).toLocaleString()}`,
      });

      setShowAddModal(false);
      setReference("");
      await loadBilling();
      onFundsUpdated?.();
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message || "Could not add funds");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && !wallet) {
    return (
      <div className="mb-6 flex h-24 items-center justify-center rounded-xl border border-border bg-card/60 p-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const balance = Number(wallet?.balance ?? 0);
  const threshold = Number(wallet?.low_balance_threshold ?? 100);
  const isLow = balance < threshold;
  const marketingRate = Number(wallet?.marketing_rate ?? 0.88);
  const utilityRate = Number(wallet?.utility_rate ?? 0.15);

  const approxMarketingMsgs = Math.floor(balance / marketingRate);
  const approxUtilityMsgs = Math.floor(balance / utilityRate);

  return (
    <>
      <div className="mb-6 overflow-hidden rounded-xl border border-border bg-card shadow-xs transition-all">
        {/* Low Balance Warning Banner */}
        {isLow && (
          <div className="flex items-center justify-between gap-3 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-xs text-amber-800 dark:text-amber-300">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                <strong>Low Messaging Balance Warning:</strong> Your available balance is ₹
                {balance.toFixed(2)}. Top up funds now to ensure scheduled &amp; upcoming campaigns send smoothly.
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowAddModal(true)}
              className="h-7 border-amber-500/40 bg-background text-xs font-medium hover:bg-amber-500/10"
            >
              <Plus className="mr-1 size-3" /> Top Up
            </Button>
          </div>
        )}

        <div className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            {/* Balance & Status */}
            <div className="flex items-start gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Wallet className="size-6" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Available Messaging Balance
                  </p>
                  {isLow ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="size-3" /> Low Balance
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="size-3" /> Sufficient Funds
                    </span>
                  )}
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                    ₹{balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ({wallet?.currency ?? "INR"})
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Can send approx{" "}
                  <strong className="text-foreground">~{approxMarketingMsgs.toLocaleString()}</strong> marketing or{" "}
                  <strong className="text-foreground">~{approxUtilityMsgs.toLocaleString()}</strong> utility messages.
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2 sm:self-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowRatesModal(true)}
                className="gap-1.5 text-xs text-muted-foreground"
              >
                <HelpCircle className="size-3.5" />
                Pricing Rates
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowHistoryModal(true)}
                className="gap-1.5 text-xs text-muted-foreground"
              >
                <Receipt className="size-3.5" />
                History ({transactions.length})
              </Button>

              <Button
                size="sm"
                onClick={() => setShowAddModal(true)}
                className="gap-1.5 bg-primary text-xs text-primary-foreground shadow-sm hover:bg-primary/90"
              >
                <Plus className="size-3.5" />
                Add Funds
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Add Funds Dialog */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="size-5 text-primary" />
              Add WhatsApp Messaging Funds
            </DialogTitle>
            <DialogDescription>
              Record funds added to your WhatsApp messaging wallet to run broadcasts and scheduled campaigns.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground">
                Select Amount (INR)
              </label>
              <div className="grid grid-cols-4 gap-2 mb-2">
                {[500, 1000, 2500, 5000].map((preset) => (
                  <Button
                    key={preset}
                    type="button"
                    variant={amount === preset.toString() ? "default" : "outline"}
                    size="sm"
                    className="text-xs"
                    onClick={() => setAmount(preset.toString())}
                  >
                    ₹{preset}
                  </Button>
                ))}
              </div>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-sm font-semibold text-muted-foreground">
                  ₹
                </span>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Enter custom amount"
                  className="pl-7"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground">
                Payment Reference / Transaction ID (Optional)
              </label>
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="e.g. UPI-982103491, Bank Transfer Ref"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground">
                Note / Description
              </label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Monthly WhatsApp broadcast recharge"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAddModal(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleAddFunds}
              disabled={submitting || !amount || parseFloat(amount) <= 0}
              className="gap-1.5"
            >
              {submitting && <Loader2 className="size-3.5 animate-spin" />}
              Confirm &amp; Add Funds
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transaction History Dialog */}
      <Dialog open={showHistoryModal} onOpenChange={setShowHistoryModal}>
        <DialogContent className="sm:max-w-xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="size-5 text-primary" />
              Messaging Fund History
            </DialogTitle>
            <DialogDescription>
              Track funds added and broadcast campaign expenditures.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-2 py-2 pr-1">
            {transactions.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                No billing transactions recorded yet.
              </p>
            ) : (
              transactions.map((tx) => {
                const isCredit = tx.type === "credit";
                return (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between rounded-lg border border-border bg-card/60 p-3 text-xs"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
                          isCredit
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                        }`}
                      >
                        {isCredit ? (
                          <ArrowDownLeft className="size-4" />
                        ) : (
                          <ArrowUpRight className="size-4" />
                        )}
                      </div>
                      <div className="space-y-0.5">
                        <p className="font-medium text-foreground">{tx.description}</p>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span>{new Date(tx.created_at).toLocaleDateString()}</span>
                          {tx.reference && (
                            <>
                              <span>•</span>
                              <span>Ref: {tx.reference}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <p
                        className={`font-semibold ${
                          isCredit
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-foreground"
                        }`}
                      >
                        {isCredit ? "+" : "-"}₹
                        {Number(tx.amount).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Bal: ₹{Number(tx.balance_after).toFixed(2)}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <DialogFooter>
            <Button size="sm" onClick={() => setShowHistoryModal(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pricing Rates Dialog */}
      <Dialog open={showRatesModal} onOpenChange={setShowRatesModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HelpCircle className="size-5 text-primary" />
              Meta WhatsApp Messaging Rates (India)
            </DialogTitle>
            <DialogDescription>
              WhatsApp Business API conversation charges based on template category:
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="font-semibold text-foreground">Marketing Templates</p>
                <p className="text-muted-foreground">Promotions, offers, event invitations, webinars</p>
              </div>
              <span className="font-mono text-sm font-bold text-foreground">
                ₹{marketingRate.toFixed(2)} / msg
              </span>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="font-semibold text-foreground">Utility Templates</p>
                <p className="text-muted-foreground">Confirmations, reminders, event updates</p>
              </div>
              <span className="font-mono text-sm font-bold text-foreground">
                ₹{utilityRate.toFixed(2)} / msg
              </span>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="font-semibold text-foreground">Authentication &amp; OTP</p>
                <p className="text-muted-foreground">Verification codes and password resets</p>
              </div>
              <span className="font-mono text-sm font-bold text-foreground">
                ₹0.15 / msg
              </span>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="font-semibold text-foreground">Service Conversations</p>
                <p className="text-muted-foreground">Customer initiated chat inquiries</p>
              </div>
              <span className="font-mono text-sm font-bold text-foreground">
                ₹0.30 / 24h window
              </span>
            </div>
          </div>

          <DialogFooter>
            <Button size="sm" onClick={() => setShowRatesModal(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
