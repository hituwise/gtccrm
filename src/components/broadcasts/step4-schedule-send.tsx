'use client';

import { useEffect, useState, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { MessageTemplate, MetaBillingDetails } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ArrowLeft,
  Send,
  Loader2,
  Users,
  Save,
  Calendar,
  Clock,
  CheckCircle2,
  Coins,
  ArrowUpRight,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { calculateBroadcastCost } from '@/lib/billing/wallet';

interface AudienceConfig {
  type: string;
  tagIds?: string[];
  csvContacts?: { phone: string; name?: string }[];
}

interface Step4Props {
  name: string;
  onNameChange: (name: string) => void;
  template: MessageTemplate;
  audience: AudienceConfig;
  onSend: (scheduledAt?: string | null) => void;
  onSaveDraft?: () => void;
  onBack: () => void;
  isProcessing: boolean;
  progress: number;
}

export function Step4ScheduleSend({
  name,
  onNameChange,
  template,
  audience,
  onSend,
  onSaveDraft,
  onBack,
  isProcessing,
  progress,
}: Step4Props) {
  const t = useTranslations('Broadcasts.wizard');
  const [showConfirm, setShowConfirm] = useState(false);
  const [estimatedReach, setEstimatedReach] = useState<number>(0);
  const [loadingReach, setLoadingReach] = useState(true);

  // Meta Billing state
  const [metaBilling, setMetaBilling] = useState<MetaBillingDetails | null>(null);

  // Scheduling state: 'now' vs 'schedule'
  const [sendMode, setSendMode] = useState<'now' | 'schedule'>('now');
  
  // Default scheduled date = tomorrow at 10:00 AM local time
  const defaultScheduleStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    // Format YYYY-MM-DDTHH:mm for datetime-local
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, []);

  const [scheduledDateTime, setScheduledDateTime] = useState<string>(defaultScheduleStr);

  async function loadBillingDetails() {
    try {
      const res = await fetch('/api/billing/funds');
      if (res.ok) {
        const data = await res.json();
        if (data.metaBilling) {
          setMetaBilling(data.metaBilling);
        }
      }
    } catch (err) {
      console.warn('[Step4ScheduleSend] billing load error:', err);
    }
  }

  useEffect(() => {
    loadBillingDetails();
  }, []);

  useEffect(() => {
    async function calculateReach() {
      setLoadingReach(true);
      try {
        const supabase = createClient();

        if (audience.type === 'all') {
          const { count } = await supabase
            .from('contacts')
            .select('*', { count: 'exact', head: true });
          setEstimatedReach(count ?? 0);
        } else if (audience.type === 'tags' && audience.tagIds && audience.tagIds.length > 0) {
          const uniqueIds = new Set<string>();
          let from = 0;
          const PAGE_SIZE = 1000;
          while (true) {
            const { data: contactTags } = await supabase
              .from('contact_tags')
              .select('contact_id')
              .in('tag_id', audience.tagIds)
              .range(from, from + PAGE_SIZE - 1);

            if (!contactTags || contactTags.length === 0) break;
            for (const ct of contactTags) uniqueIds.add(ct.contact_id);
            if (contactTags.length < PAGE_SIZE) break;
            from += PAGE_SIZE;
          }
          setEstimatedReach(uniqueIds.size);
        } else if (audience.type === 'csv' && audience.csvContacts) {
          setEstimatedReach(audience.csvContacts.length);
        } else {
          setEstimatedReach(0);
        }
      } finally {
        setLoadingReach(false);
      }
    }

    calculateReach();
  }, [audience]);

  // Cost calculation
  const { costPerMessage, totalCost, categoryLabel } = calculateBroadcastCost(
    template.category,
    estimatedReach
  );

  // Quick schedule presets
  const setQuickSchedule = (hoursAhead: number) => {
    const d = new Date();
    d.setHours(d.getHours() + hoursAhead);
    d.setMinutes(0, 0, 0);
    const pad = (n: number) => n.toString().padStart(2, '0');
    setScheduledDateTime(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  };

  const audienceLabel =
    audience.type === 'all'
      ? t('scheduleSend.audienceAll')
      : audience.type === 'tags'
        ? t('scheduleSend.audienceTags')
        : audience.type === 'csv'
          ? t('scheduleSend.audienceCsv')
          : t('scheduleSend.audienceField');

  const minDateTime = useMemo(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 5);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, []);

  const metaBillingUrl =
    metaBilling?.whatsappManagerUrl || 'https://business.facebook.com/billing_hub';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('scheduleSend.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Review estimated Meta messaging funds, choose dispatch timing, or schedule for an upcoming event.
        </p>
      </div>

      {/* Broadcast Name */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          {t('scheduleSend.broadcastName')}
        </label>
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={t('scheduleSend.broadcastNamePlaceholder')}
          className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {/* Cost & Required Meta Funds Calculator Card */}
      <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 via-background to-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Coins className="size-4 text-primary" />
            Estimated Meta Funds Required
          </div>
          <span className="text-xs text-muted-foreground">
            Meta Rate: <strong className="text-foreground">₹{costPerMessage.toFixed(2)}</strong> / recipient ({categoryLabel})
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 rounded-lg border border-border bg-card/60 p-3 text-xs">
          <div>
            <p className="text-muted-foreground">Target Recipients</p>
            <p className="text-sm font-bold text-foreground">
              {loadingReach ? '...' : estimatedReach.toLocaleString()}
            </p>
          </div>

          <div>
            <p className="text-muted-foreground">Template Category</p>
            <p className="text-sm font-bold text-foreground">
              {categoryLabel}
            </p>
          </div>

          <div>
            <p className="text-muted-foreground">Estimated Meta Cost</p>
            <p className="text-sm font-bold text-primary font-mono">
              ₹{totalCost.toFixed(2)}
            </p>
          </div>

          <div>
            <p className="text-muted-foreground">Payment Method</p>
            <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
              Meta Prepaid / Card
            </p>
          </div>
        </div>

        {/* Notice: Billed directly by Meta */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-foreground">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
            <div>
              <p className="font-semibold text-foreground">
                Estimated Meta Charges: ~₹{totalCost.toFixed(2)}
              </p>
              <p className="text-muted-foreground mt-0.5">
                WhatsApp charges are billed directly by <strong>Meta</strong> from your Meta Business Manager prepaid balance or linked payment method. Please ensure your Meta balance has at least <strong>₹{totalCost.toFixed(2)}</strong> before dispatching.
              </p>
            </div>
          </div>
          <a
            href={metaBillingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-3 py-1.5 text-xs shrink-0 whitespace-nowrap shadow-sm transition-colors"
          >
            Check Balance in Meta Hub <ArrowUpRight className="size-3.5" />
          </a>
        </div>

        {/* Meta Messaging Tier & Limitation Awareness */}
        {metaBilling?.messagingLimitTier && (
          <div
            className={`rounded-lg border p-3 text-xs ${
              metaBilling.messagingLimitMax && estimatedReach > metaBilling.messagingLimitMax
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200'
                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200'
            }`}
          >
            <div className="flex items-start gap-2">
              <Users className="size-4 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="font-semibold">
                  Meta Daily Limit:{' '}
                  {metaBilling.messagingLimitMax
                    ? `${metaBilling.messagingLimitMax.toLocaleString()} unique recipients / 24 hrs (${metaBilling.messagingLimitTier})`
                    : `${metaBilling.messagingLimitTier} (Unlimited)`}
                </p>
                <p className="opacity-90 leading-relaxed">
                  {metaBilling.messagingLimitMax && estimatedReach > metaBilling.messagingLimitMax
                    ? `Your audience (${estimatedReach.toLocaleString()}) exceeds your current 24-hr Meta tier (${metaBilling.messagingLimitMax.toLocaleString()}). The system will send without any CRM limitation, but Meta may throttle recipients past ${metaBilling.messagingLimitMax.toLocaleString()} until your quality score upgrades your tier.`
                    : `No CRM limit applied. All ${estimatedReach.toLocaleString()} recipients will be dispatched according to your Meta tier.`}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Dispatch Timing: Send Now vs Schedule for Event */}
      <div className="rounded-xl border border-border bg-card/50 p-4 space-y-4">
        <p className="text-sm font-medium text-foreground flex items-center gap-2">
          <Clock className="size-4 text-primary" />
          Dispatch Timing &amp; Event Scheduler
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Option 1: Send Immediately */}
          <div
            onClick={() => setSendMode('now')}
            className={`cursor-pointer rounded-lg border p-3.5 transition-all ${
              sendMode === 'now'
                ? 'border-primary bg-primary/10 shadow-xs'
                : 'border-border bg-card/40 hover:bg-muted/40'
            }`}
          >
            <div className="flex items-start gap-3">
              <input
                type="radio"
                name="sendMode"
                checked={sendMode === 'now'}
                onChange={() => setSendMode('now')}
                className="mt-1 accent-primary"
              />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                  <Send className="size-3.5 text-primary" /> Send Immediately
                </p>
                <p className="text-xs text-muted-foreground">
                  Start sending to all recipients right away after clicking confirm.
                </p>
              </div>
            </div>
          </div>

          {/* Option 2: Schedule for Event */}
          <div
            onClick={() => setSendMode('schedule')}
            className={`cursor-pointer rounded-lg border p-3.5 transition-all ${
              sendMode === 'schedule'
                ? 'border-primary bg-primary/10 shadow-xs'
                : 'border-border bg-card/40 hover:bg-muted/40'
            }`}
          >
            <div className="flex items-start gap-3">
              <input
                type="radio"
                name="sendMode"
                checked={sendMode === 'schedule'}
                onChange={() => setSendMode('schedule')}
                className="mt-1 accent-primary"
              />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                  <Calendar className="size-3.5 text-primary" /> Schedule for Event / Later
                </p>
                <p className="text-xs text-muted-foreground">
                  Set a specific date and time for automatic event delivery.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Schedule Date & Time Picker */}
        {sendMode === 'schedule' && (
          <div className="rounded-lg border border-primary/20 bg-muted/30 p-3.5 space-y-3 animate-in fade-in duration-200">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Calendar className="size-3.5 text-primary" /> Select Event Date &amp; Time
              </label>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] text-muted-foreground">Presets:</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setQuickSchedule(2)}
                  className="h-6 text-[10px] px-2"
                >
                  +2 Hours
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setQuickSchedule(24)}
                  className="h-6 text-[10px] px-2"
                >
                  Tomorrow
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setQuickSchedule(48)}
                  className="h-6 text-[10px] px-2"
                >
                  In 2 Days
                </Button>
              </div>
            </div>

            <Input
              type="datetime-local"
              min={minDateTime}
              value={scheduledDateTime}
              onChange={(e) => setScheduledDateTime(e.target.value)}
              className="bg-background text-foreground text-sm font-medium"
            />

            <p className="text-xs text-muted-foreground leading-relaxed">
              📅 This broadcast will automatically be queued and delivered on{' '}
              <strong className="text-foreground">
                {new Date(scheduledDateTime).toLocaleString(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </strong>{' '}
              to <strong className="text-foreground">{estimatedReach}</strong> contacts.
            </p>
          </div>
        )}
      </div>

      {/* Summary Card */}
      <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
        <p className="text-sm font-medium text-foreground">{t('scheduleSend.summary')}</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">{t('scheduleSend.template')}</p>
            <p className="text-foreground font-medium">{template.name}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('scheduleSend.audience')}</p>
            <p className="text-foreground font-medium">{audienceLabel}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('scheduleSend.estimatedReach')}</p>
            <div className="flex items-center gap-1.5">
              {loadingReach ? (
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
              ) : (
                <>
                  <Users className="h-3.5 w-3.5 text-primary" />
                  <p className="font-medium text-foreground">{estimatedReach.toLocaleString()}</p>
                </>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Estimated Cost</p>
            <p className="text-foreground font-bold text-primary">₹{totalCost.toFixed(2)}</p>
          </div>
        </div>
      </div>

      {/* Processing overlay */}
      {isProcessing && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <p className="text-sm font-medium text-foreground">
                {sendMode === 'schedule' ? 'Scheduling campaign...' : t('scheduleSend.sending')}
              </p>
            </div>
            <span className="text-xs font-medium text-primary">{progress}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted">
            <div
              className="h-1.5 rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Footer Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          disabled={isProcessing}
          className="border-border text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('back')}
        </Button>

        <div className="flex items-center gap-2">
          {onSaveDraft && (
            <Button
              variant="outline"
              onClick={onSaveDraft}
              disabled={!name.trim() || isProcessing}
              className="border-border text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {t('scheduleSend.saveDraft')}
            </Button>
          )}

          <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
            <Button
              type="button"
              onClick={() => setShowConfirm(true)}
              disabled={!name.trim() || isProcessing}
              className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 gap-2"
            >
              {sendMode === 'schedule' ? (
                <>
                  <Calendar className="h-4 w-4" />
                  Schedule Broadcast
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  {t('scheduleSend.sendNow')}
                </>
              )}
            </Button>

            <DialogContent className="border-border bg-popover sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="text-popover-foreground">
                  {sendMode === 'schedule' ? 'Confirm Scheduled Campaign' : t('scheduleSend.confirmTitle')}
                </DialogTitle>
                <DialogDescription className="text-muted-foreground space-y-2 pt-2">
                  <p>
                    You are about to{' '}
                    <strong>{sendMode === 'schedule' ? 'schedule' : 'dispatch'}</strong>{' '}
                    the broadcast <strong>&quot;{name}&quot;</strong> using template{' '}
                    <strong>{template.name}</strong> to{' '}
                    <strong>{estimatedReach.toLocaleString()}</strong> recipients.
                  </p>
                  <div className="rounded-lg border border-border bg-muted/40 p-2.5 text-xs text-foreground space-y-1">
                    <p>
                      • <strong>Estimated Meta Charges:</strong> ₹{totalCost.toFixed(2)} ({categoryLabel})
                    </p>
                    <p>
                      • <strong>Billed to:</strong> Meta WhatsApp Business Account ({metaBilling?.wabaName || 'Geniplus Academy'})
                    </p>
                    {sendMode === 'schedule' ? (
                      <p>
                        • <strong>Scheduled Time:</strong>{' '}
                        {new Date(scheduledDateTime).toLocaleString(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </p>
                    ) : (
                      <p>• <strong>Timing:</strong> Dispatched immediately upon confirmation.</p>
                    )}
                  </div>
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  variant="outline"
                  onClick={() => setShowConfirm(false)}
                  className="border-border text-muted-foreground"
                >
                  {t('cancel')}
                </Button>
                <Button
                  onClick={() => {
                    setShowConfirm(false);
                    onSend(sendMode === 'schedule' ? new Date(scheduledDateTime).toISOString() : null);
                  }}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 gap-1.5"
                >
                  {sendMode === 'schedule' ? (
                    <>
                      <Calendar className="h-4 w-4" />
                      Confirm &amp; Schedule
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      {t('scheduleSend.sendNow')}
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}
