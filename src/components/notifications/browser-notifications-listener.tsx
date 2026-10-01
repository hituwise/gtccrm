"use client";

import { useEffect } from "react";
import { useBrowserNotifications } from "@/hooks/use-browser-notifications";
import {
  registerServiceWorker,
  isPushSubscribed,
  subscribeToPush,
} from "@/lib/notifications/push-client";

/**
 * Headless. Mount ONCE per signed-in dashboard tab (the dashboard
 * shell, below the auth gate) so desktop notifications and PWA service
 * workers are active on every dashboard page, not just the inbox.
 */
export function BrowserNotificationsListener() {
  useBrowserNotifications();

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    registerServiceWorker()
      .then(async () => {
        // If notification permission is already granted on this device,
        // ensure this device has an active push subscription on the server.
        if (
          typeof Notification !== "undefined" &&
          Notification.permission === "granted" &&
          "PushManager" in window
        ) {
          try {
            const isSubbed = await isPushSubscribed();
            if (!isSubbed) {
              await subscribeToPush();
            }
          } catch (err) {
            console.warn("[BrowserNotificationsListener] push sync error:", err);
          }
        }
      })
      .catch((err) => {
        console.warn("[BrowserNotificationsListener] SW registration error:", err);
      });
  }, []);

  return null;
}
