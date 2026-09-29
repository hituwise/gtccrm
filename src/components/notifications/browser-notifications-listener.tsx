"use client";

import { useEffect } from "react";
import { useBrowserNotifications } from "@/hooks/use-browser-notifications";
import { registerServiceWorker } from "@/lib/notifications/push-client";

/**
 * Headless. Mount ONCE per signed-in dashboard tab (the dashboard
 * shell, below the auth gate) so desktop notifications and PWA service
 * workers are active on every dashboard page, not just the inbox.
 */
export function BrowserNotificationsListener() {
  useBrowserNotifications();

  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      registerServiceWorker().catch(() => {});
    }
  }, []);

  return null;
}
