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
        if (sub.success) setHasPush(true);
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
          toast.success('Push notifications active on this device!');
        } else if (sub.error) {
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
          toast.success('Push notifications active on this device!');
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

  const sendTest = async () => {
    setTesting(true);
    try {
      // 1. Try immediate local Notification
      try {
        new Notification(t('testTitle'), {
          body: t('testBody'),
          icon: '/icon',
          tag: 'wacrm-test-notification',
        });
      } catch {
        // Fall through to server push
      }

      // 2. Ensure device has an active push subscription
      if (!hasPush) {
        const subRes = await subscribeToPush();
        if (subRes.success) {
          setHasPush(true);
        } else if (subRes.error) {
          toast.error(subRes.error);
          return;
        }
      }

      // 3. Real server-side Web Push (reaches mobile PWA & desktop even if closed)
      const pushRes = await sendTestPush();
      if (pushRes.success) {
        toast.success('Push alert delivered! Check your notification tray.');
      } else if (pushRes.message) {
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
          Get instant alerts for new WhatsApp lead messages on desktop and mobile phones — even when the app is in the background.
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
                      <strong>Android (Chrome):</strong> Tap the 3 dots (⋮) &rarr; <span className="text-foreground">"Install app"</span> or "Add to Home screen".
                    </li>
                    <li>
                      <strong>iPhone (Safari):</strong> Tap the Share button (&uarr;) &rarr; <span className="text-foreground">"Add to Home Screen"</span>.
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
