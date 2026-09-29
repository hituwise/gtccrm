// Service Worker for WACRM PWA and Web Push Notifications
/// <reference lib="webworker" />

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Handle incoming background Web Push notifications
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const payload = event.data.json();
    const title = payload.title || 'New WhatsApp Message';
    const options = {
      body: payload.body || 'You have received a new message from a customer.',
      icon: payload.icon || '/icon',
      badge: payload.badge || '/icon',
      tag: payload.tag || 'wacrm-message',
      data: payload.data || { url: '/inbox' },
      renotify: true,
      vibrate: [200, 100, 200],
    };

    event.waitUntil(self.registration.showNotification(title, options));
  } catch (err) {
    console.error('[sw] Failed to parse push payload:', err);
    // Fallback notification if payload wasn't JSON
    const text = event.data.text();
    event.waitUntil(
      self.registration.showNotification('New Message', {
        body: text,
        icon: '/icon',
        badge: '/icon',
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
      // If a tab is already open with the app, focus it and navigate
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
      // Otherwise open a new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
