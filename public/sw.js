// Service Worker for WACRM PWA and Web Push Notifications
/// <reference lib="webworker" />

const CACHE_NAME = 'wacrm-pwa-v1';
const STATIC_ASSETS = ['/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
        )
      ),
    ])
  );
});

// Network-first fetch handler (required by Android Chrome for PWA installability)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || event.request.url.includes('/api/')) {
    return;
  }
  event.respondWith(
    fetch(event.request).catch(async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    })
  );
});

// Handle incoming background Web Push notifications
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const payload = event.data.json();
    const title = payload.title || 'New WhatsApp Message';
    const options = {
      body: payload.body || 'You have received a new message from a customer.',
      icon: payload.icon || '/icon-192.png',
      badge: payload.badge || '/icon-192.png',
      tag: payload.tag || 'wacrm-message',
      data: payload.data || { url: '/inbox' },
      renotify: true,
      silent: false,
      vibrate: [200, 100, 200],
    };

    event.waitUntil(self.registration.showNotification(title, options));
  } catch (err) {
    console.error('[sw] Failed to parse push payload:', err);
    const text = event.data.text();
    event.waitUntil(
      self.registration.showNotification('New Message', {
        body: text,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
      })
    );
  }
});

// Handle notification click: focus existing window or open new one
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/inbox';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          if (client.url.includes(targetUrl)) {
            return client.focus();
          }
          if ('navigate' in client) {
            return client.navigate(targetUrl).then((navClient) => navClient?.focus());
          }
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
