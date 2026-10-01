/**
 * Client-side Web Push & Service Worker utilities for PWA and desktop notifications.
 */

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    return reg;
  } catch (err) {
    console.error('[push-client] SW registration failed:', err);
    return null;
  }
}

export async function isPushSubscribed(): Promise<boolean> {
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window)
  ) {
    return false;
  }
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    if (!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    return Boolean(sub);
  } catch {
    return false;
  }
}

export async function subscribeToPush(): Promise<{
  success: boolean;
  error?: string;
}> {
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window)
  ) {
    return {
      success: false,
      error: 'Push notifications are not supported in this browser.',
    };
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return {
        success: false,
        error: 'Notification permission was denied. Please allow notifications in your browser settings.',
      };
    }

    const reg = await registerServiceWorker();
    if (!reg) {
      return {
        success: false,
        error: 'Failed to register the background service worker.',
      };
    }

    // Wait until service worker is active
    await navigator.serviceWorker.ready;

    // Get VAPID public key from backend
    const keyRes = await fetch('/api/notifications/push-subscription');
    if (!keyRes.ok) {
      return {
        success: false,
        error: 'Could not fetch notification configuration.',
      };
    }
    const { vapidPublicKey } = await keyRes.json();
    if (!vapidPublicKey) {
      return {
        success: false,
        error: 'VAPID public key not found on server.',
      };
    }

    // Check existing subscription
    let subscription = await reg.pushManager.getSubscription();
    if (!subscription) {
      const convertedKey = urlBase64ToUint8Array(vapidPublicKey);
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedKey as BufferSource,
      });
    }

    const subJson = subscription.toJSON();
    let p256dh = subJson.keys?.p256dh;
    let auth = subJson.keys?.auth;

    if ((!p256dh || !auth) && subscription.getKey) {
      try {
        const rawP256dh = subscription.getKey('p256dh');
        if (rawP256dh && !p256dh) {
          p256dh = btoa(String.fromCharCode(...new Uint8Array(rawP256dh)))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
        }
        const rawAuth = subscription.getKey('auth');
        if (rawAuth && !auth) {
          auth = btoa(String.fromCharCode(...new Uint8Array(rawAuth)))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
        }
      } catch (keyErr) {
        console.warn('[push-client] getKey fallback failed:', keyErr);
      }
    }

    const saveRes = await fetch('/api/notifications/push-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        keys: {
          p256dh: p256dh || subJson.keys?.p256dh,
          auth: auth || subJson.keys?.auth,
        },
        userAgent: navigator.userAgent,
      }),
    });

    if (!saveRes.ok) {
      const errData = await saveRes.json().catch(() => ({}));
      const msg = errData.error || 'Failed to save subscription to server.';
      if (msg.includes('does not exist')) {
        return {
          success: false,
          error: 'Table "push_subscriptions" not found. Please run the SQL in Supabase SQL Editor.',
        };
      }
      return {
        success: false,
        error: msg,
      };
    }

    return { success: true };
  } catch (err: unknown) {
    console.error('[push-client] subscribeToPush failed:', err);
    return {
      success: false,
      error: (err as { message?: string })?.message || 'An unknown error occurred.',
    };
  }
}

export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}

export function isIosDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream;
}

export function isStandaloneApp(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((navigator as unknown as { standalone?: boolean }).standalone)
  );
}

export async function unsubscribeFromPush(): Promise<boolean> {
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window)
  ) {
    return false;
  }

  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    if (!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch('/api/notifications/push-subscription', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
    }
    return true;
  } catch (err) {
    console.error('[push-client] unsubscribe failed:', err);
    return false;
  }
}

export async function sendTestPush(): Promise<{
  success: boolean;
  sentCount?: number;
  message?: string;
}> {
  const res = await fetch('/api/notifications/push-subscription', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'test' }),
  });
  return res.json();
}
