"use client";

import { useEffect, useState } from "react";
import {
  BellRing,
  Smartphone,
  X,
  Loader2,
  Share,
  PlusSquare,
  CheckCircle2,
  Volume2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  subscribeToPush,
  isPushSubscribed,
  isIosDevice,
  isStandaloneApp,
  sendTestPush,
} from "@/lib/notifications/push-client";
import { writeBrowserNotifyPref } from "@/lib/notifications/browser-notify";

const DISMISS_KEY = "wacrm:push_banner_dismissed_until";

export function PushNotificationBanner() {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showIosGuide, setShowIosGuide] = useState(false);
  const [isIosNonPwa, setIsIosNonPwa] = useState(false);

  useEffect(() => {
    setMounted(true);

    if (typeof window === "undefined" || !("Notification" in window)) {
      return;
    }

    // Check if dismissed recently
    try {
      const dismissedUntil = localStorage.getItem(DISMISS_KEY);
      if (dismissedUntil && Date.now() < parseInt(dismissedUntil, 10)) {
        return;
      }
    } catch {
      // ignore
    }

    const checkStatus = async () => {
      const isIos = isIosDevice();
      const isStandalone = isStandaloneApp();

      if (isIos && !isStandalone) {
        setIsIosNonPwa(true);
        setVisible(true);
        return;
      }

      // If notification permission is already denied, don't nag the user with banner
      if (Notification.permission === "denied") {
        return;
      }

      // Check if already subscribed to push
      const subscribed = await isPushSubscribed();
      if (!subscribed) {
        setVisible(true);
      }
    };

    void checkStatus();
  }, []);

  const handleDismiss = () => {
    setVisible(false);
    try {
      // Dismiss for 3 days
      const expire = Date.now() + 3 * 24 * 60 * 60 * 1000;
      localStorage.setItem(DISMISS_KEY, expire.toString());
    } catch {
      // ignore
    }
  };

  const handleEnablePush = async () => {
    setLoading(true);
    try {
      const res = await subscribeToPush();
      if (res.success) {
        writeBrowserNotifyPref(true);
        setVisible(false);
        toast.success("Push notifications activated on this device!", {
          description: "Sending a test notification to your lock screen...",
        });

        // Send a real test push alert to confirm
        void sendTestPush();
      } else {
        if (Notification.permission === "denied") {
          toast.error("Notification permission was blocked.", {
            description:
              "Please tap the lock icon in your browser address bar and set Notifications to Allow.",
          });
          setVisible(false);
        } else {
          toast.error(res.error || "Failed to enable notifications.");
        }
      }
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  if (!mounted || !visible) return null;

  return (
    <>
      <div className="relative mb-4 overflow-hidden rounded-xl border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-background p-4 shadow-sm transition-all animate-in fade-in slide-in-from-top-2 duration-300">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
              {isIosNonPwa ? (
                <Smartphone className="size-5" />
              ) : (
                <BellRing className="size-5 animate-bounce" />
              )}
            </div>
            <div className="space-y-1">
              <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                {isIosNonPwa
                  ? "Get WhatsApp Alerts on iPhone"
                  : "Enable WhatsApp Mobile Notifications"}
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-medium text-primary">
                  <Volume2 className="size-3" /> Sound &amp; Vibration
                </span>
              </h4>
              <p className="text-xs text-muted-foreground leading-relaxed max-w-xl">
                {isIosNonPwa
                  ? "Apple requires adding LeadPilot to your Home Screen to receive instant push alerts when new leads message you."
                  : "Receive instant notifications on your phone lock screen whenever a customer sends a message."}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-center">
            {isIosNonPwa ? (
              <Button
                size="sm"
                onClick={() => setShowIosGuide(true)}
                className="gap-1.5 bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 text-xs h-8"
              >
                <Share className="size-3.5" />
                How to Install on iPhone
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleEnablePush}
                disabled={loading}
                className="gap-1.5 bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 text-xs h-8"
              >
                {loading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <BellRing className="size-3.5" />
                )}
                Turn On Notifications
              </Button>
            )}

            <Button
              variant="ghost"
              size="icon"
              onClick={handleDismiss}
              className="size-8 text-muted-foreground hover:text-foreground"
              aria-label="Dismiss banner"
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* iOS Installation Modal */}
      <Dialog open={showIosGuide} onOpenChange={setShowIosGuide}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Smartphone className="size-5 text-primary" />
              Install on iPhone (PWA)
            </DialogTitle>
            <DialogDescription>
              Follow these 3 quick steps in Safari to enable background push notifications on iOS:
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-sm">
            <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
                1
              </div>
              <div className="space-y-0.5">
                <p className="font-medium text-foreground flex items-center gap-1.5">
                  Tap Safari&apos;s Share button <Share className="size-4 text-primary" />
                </p>
                <p className="text-xs text-muted-foreground">
                  Located at the bottom center of your Safari browser bar.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
                2
              </div>
              <div className="space-y-0.5">
                <p className="font-medium text-foreground flex items-center gap-1.5">
                  Tap &quot;Add to Home Screen&quot; <PlusSquare className="size-4 text-primary" />
                </p>
                <p className="text-xs text-muted-foreground">
                  Scroll down in the share sheet and tap &quot;Add to Home Screen&quot;, then tap &quot;Add&quot;.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
                3
              </div>
              <div className="space-y-0.5">
                <p className="font-medium text-foreground flex items-center gap-1.5">
                  Open LeadPilot from your Home Screen <CheckCircle2 className="size-4 text-green-500" />
                </p>
                <p className="text-xs text-muted-foreground">
                  Launch the new app icon from your iPhone home screen and tap &quot;Turn On Notifications&quot; when prompted.
                </p>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button size="sm" onClick={() => setShowIosGuide(false)}>
              Got it
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
