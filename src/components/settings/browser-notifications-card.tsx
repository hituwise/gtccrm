'use client';

import { useState, useEffect, useSyncExternalStore } from 'react';
import {
  Bell,
  BellRing,
  CircleAlert,
  Loader2,
  Smartphone,
  Download,
  CheckCircle2,
  Copy,
  Check,
  Database,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useBrowserNotifyPref } from '@/hooks/use-browser-notifications';
import {
  BROWSER_NOTIFY_CHANGE_EVENT,
  getNotificationPermission,
  writeBrowserNotifyPref,
  type BrowserNotifyPermission,
} from '@/lib/notifications/browser-notify';
import {
  subscribeToPush,
  unsubscribeFromPush,
  sendTestPush,
  isPushSubscribed,
} from '@/lib/notifications/push-client';

const PUSH_MIGRATION_SQL = `-- 043_push_subscriptions.sql — Run in Supabase SQL Editor
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_push_subscriptions_endpoint UNIQUE (endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_account_user
  ON public.push_subscriptions(account_id, user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_subscriptions_select ON public.push_subscriptions;
CREATE POLICY push_subscriptions_select ON public.push_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS push_subscriptions_insert ON public.push_subscriptions;
CREATE POLICY push_subscriptions_insert ON public.push_subscriptions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS push_subscriptions_update ON public.push_subscriptions;
CREATE POLICY push_subscriptions_update ON public.push_subscriptions
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS push_subscriptions_delete ON public.push_subscriptions;
CREATE POLICY push_subscriptions_delete ON public.push_subscriptions
  FOR DELETE USING (auth.uid() = user_id);

GRANT ALL ON TABLE public.push_subscriptions TO service_role;
GRANT ALL ON TABLE public.push_subscriptions TO authenticated;`;

function subscribePermission(onChange: () => void): () => void {
  window.addEventListener('focus', onChange);
  document.addEventListener('visibilitychange', onChange);
  window.addEventListener(BROWSER_NOTIFY_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('focus', onChange);
    document.removeEventListener('visibilitychange', onChange);
    window.removeEventListener(BROWSER_NOTIFY_CHANGE_EVENT, onChange);
  };
}

const serverPermission = (): BrowserNotifyPermission => 'unsupported';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function BrowserNotificationsCard({ className }: { className?: string }) {
  const t = useTranslations('Settings.browserNotifications');
  const enabled = useBrowserNotifyPref();
  const permission = useSyncExternalStore(
    subscribePermission,
    getNotificationPermission,
    serverPermission,
  );
  const [requesting, setRequesting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [hasPush, setHasPush] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const supported = permission !== 'unsupported';
  const checked = enabled && permission === 'granted';

  // Check if already installed as standalone PWA and listen for install prompts
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      Boolean((navigator as unknown as { standalone?: boolean }).standalone);
    setIsStandalone(standalone);

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    void isPushSubscribed().then(async (subscribed) => {
      setHasPush(subscribed);
      if (!subscribed && enabled && permission === 'granted') {
        const sub = await subscribeToPush();
        if (sub.success) {
          setHasPush(true);
          setDbError(null);
        } else if (
          sub.error?.includes('push_subscriptions') ||
          sub.error?.includes('schema cache') ||
          sub.error?.includes('does not exist')
        ) {
          setDbError(sub.error);
        }
      }
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, [checked, enabled, permission]);

  const onToggle = async (next: boolean) => {
    if (!next) {
      writeBrowserNotifyPref(false);
      setHasPush(false);
      void unsubscribeFromPush();
      return;
    }

    if (permission === 'granted') {
      writeBrowserNotifyPref(true);
      setRequesting(true);
      try {
        const sub = await subscribeToPush();
        if (sub.success) {
          setHasPush(true);
          setDbError(null);
          toast.success('Push notifications active on this device!');
        } else if (sub.error) {
          if (
            sub.error.includes('push_subscriptions') ||
            sub.error.includes('schema cache') ||
            sub.error.includes('does not exist')
          ) {
            setDbError(sub.error);
          }
          toast.error(sub.error);
        }
      } finally {
        setRequesting(false);
      }
      return;
    }

    if (permission === 'denied') {
      toast.error(t('statusDenied'), { description: t('deniedHint') });
      return;
    }

    setRequesting(true);
    try {
      const result = await Notification.requestPermission();
      writeBrowserNotifyPref(result === 'granted');
      if (result === 'granted') {
        const sub = await subscribeToPush();
        if (sub.success) {
          setHasPush(true);
          setDbError(null);
          toast.success('Push notifications active on this device!');
        } else if (sub.error) {
          if (
            sub.error.includes('push_subscriptions') ||
            sub.error.includes('schema cache') ||
            sub.error.includes('does not exist')
          ) {
            setDbError(sub.error);
          }
          toast.error(sub.error);
        }
      } else if (result === 'denied') {
        toast.error(t('permissionDeniedToast'), { description: t('deniedHint') });
      }
    } finally {
      setRequesting(false);
    }
  };

  const handleInstallApp = async () => {
    if (!installPrompt) return;
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setInstallPrompt(null);
        setIsStandalone(true);
        toast.success('App installed successfully!');
      }
    } catch (err) {
      console.error('[pwa] install failed:', err);
    }
  };

  const copySql = async () => {
    try {
      await navigator.clipboard.writeText(PUSH_MIGRATION_SQL);
      setCopied(true);
      toast.success('SQL copied to clipboard! Paste into Supabase SQL Editor.');
      setTimeout(() => setCopied(false), 3000);
    } catch {
      toast.error('Could not copy to clipboard.');
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      // 1. Try immediate local Notification (SW for mobile, new Notification for desktop)
      let shownLocal = false;
      if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
        try {
          const reg = await navigator.serviceWorker.ready;
          if (reg && 'showNotification' in reg) {
            await reg.showNotification(t('testTitle'), {
              body: t('testBody'),
              icon: '/icon-192.png',
              badge: '/icon-192.png',
              tag: 'wacrm-test-notification',
            });
            shownLocal = true;
          }
        } catch {
          // ignore
        }
      }

      if (!shownLocal) {
        try {
          new Notification(t('testTitle'), {
            body: t('testBody'),
            icon: '/icon-192.png',
            tag: 'wacrm-test-notification',
          });
        } catch {
          // Ignored if browser requires Service Worker
        }
      }

      // 2. Ensure device has an active push subscription
      if (!hasPush) {
        const subRes = await subscribeToPush();
        if (subRes.success) {
          setHasPush(true);
          setDbError(null);
        } else if (subRes.error) {
          if (
            subRes.error.includes('push_subscriptions') ||
            subRes.error.includes('schema cache') ||
            subRes.error.includes('does not exist')
          ) {
            setDbError(subRes.error);
          }
          toast.error(subRes.error);
          return;
        }
      }

      // 3. Real server-side Web Push (reaches mobile PWA & desktop even if closed)
      const pushRes = await sendTestPush();
      if (pushRes.success) {
        toast.success('Push alert delivered! Check your notification tray.');
      } else if (pushRes.message) {
        if (
          pushRes.message.includes('push_subscriptions') ||
          pushRes.message.includes('schema cache') ||
          pushRes.message.includes('does not exist')
        ) {
          setDbError(pushRes.message);
        }
        toast.info(pushRes.message);
      } else {
        toast.info(t('testTitle'), { description: t('testBody') });
      }
    } catch {
      toast.info(t('testTitle'), { description: t('testBody') });
    } finally {
      setTesting(false);
    }
  };

  const statusKey =
    permission === 'granted'
      ? 'statusGranted'
      : permission === 'denied'
        ? 'statusDenied'
        : 'statusDefault';

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Bell className="size-4 text-muted-foreground" />
          {t('title')} &amp; Mobile Push
        </CardTitle>
        <CardDescription>
          Get instant alerts for new WhatsApp lead messages on desktop and mobile phones — even when the app is closed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!supported ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleAlert className="size-4 shrink-0" />
            {t('unsupported')}
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {t('toggleLabel')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {hasPush
                    ? 'Background push active — you will receive alerts on this device.'
                    : 'Enables browser notifications and mobile background push.'}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {requesting && (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                )}
                <Switch
                  checked={checked}
                  onCheckedChange={(next) => void onToggle(next)}
                  disabled={requesting || permission === 'denied'}
                  aria-label={t('toggleLabel')}
                />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">{t(statusKey)}</p>

            {permission === 'denied' && (
              <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                <span>{t('deniedHint')}</span>
              </p>
            )}

            {/* Supabase SQL Migration Warning Box */}
            {dbError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 space-y-3 text-xs text-red-900 dark:text-red-200">
                <div className="flex items-start gap-2">
                  <Database className="mt-0.5 size-4 shrink-0 text-red-500" />
                  <div className="space-y-1">
                    <p className="font-semibold text-red-800 dark:text-red-300">
                      Supabase Setup Required (1 Step)
                    </p>
                    <p className="leading-relaxed">
                      The table <code className="rounded bg-red-200/50 dark:bg-red-950/60 px-1 py-0.5">push_subscriptions</code> does not exist in your Supabase database yet. Run the SQL snippet below in your Supabase SQL Editor to finish setting up push alerts:
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={copySql}
                    className="gap-1.5 border-red-300 dark:border-red-800 bg-background text-foreground"
                  >
                    {copied ? <Check className="size-3.5 text-green-500" /> : <Copy className="size-3.5" />}
                    {copied ? 'Copied to Clipboard!' : 'Copy SQL Query'}
                  </Button>
                  <a
                    href="https://supabase.com/dashboard"
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary underline hover:text-primary/80"
                  >
                    Open Supabase Dashboard &rarr;
                  </a>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={sendTest}
                disabled={!checked || testing}
              >
                {testing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <BellRing className="size-4" />
                )}
                {t('sendTest')}
              </Button>
            </div>

            {/* Mobile PWA & App Installation Section */}
            <div className="mt-4 rounded-lg border border-border/80 bg-muted/30 p-4">
              <div className="flex items-start gap-3">
                <Smartphone className="mt-0.5 size-5 text-primary shrink-0" />
                <div className="space-y-1 text-sm">
                  <p className="font-medium text-foreground flex items-center gap-2">
                    Install as Mobile App (PWA)
                    {isStandalone && (
                      <span className="inline-flex items-center gap-1 rounded bg-green-500/10 px-1.5 py-0.5 text-xs font-normal text-green-600 dark:text-green-400">
                        <CheckCircle2 className="size-3" /> Installed
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Install WACRM on your Android or iPhone for full-screen view and background push notifications when leads message:
                  </p>
                  <ul className="text-xs text-muted-foreground list-disc list-inside space-y-0.5 pt-1">
                    <li>
                      <strong>Android (Chrome):</strong> Tap the 3 dots (⋮) &rarr; <span className="text-foreground">&quot;Install app&quot;</span> (or &quot;Add to Home screen&quot;).
                    </li>
                    <li>
                      <strong>iPhone (Safari):</strong> Tap the Share button (&uarr;) &rarr; <span className="text-foreground">&quot;Add to Home Screen&quot;</span>.
                    </li>
                  </ul>
                  {installPrompt && !isStandalone && (
                    <div className="pt-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleInstallApp}
                        className="gap-2"
                      >
                        <Download className="size-4" />
                        Install App Now
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
