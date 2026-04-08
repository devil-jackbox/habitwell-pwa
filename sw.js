const CACHE = "habitwell-v1";
const ASSETS = ["/"];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
});

self.addEventListener("fetch", e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});

// =========================

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'HabitWell OS', body: event.data.text() };
  }

  const title   = payload.notification?.title || payload.title || '⚡ HabitWell OS';
  const options = {
    body:    payload.notification?.body  || payload.body  || 'Time to check your habits!',
    icon:    '/habitwell-pwa/icons/icon-192.png',
    badge:   '/habitwell-pwa/icons/icon-96.png',
    vibrate: [200, 100, 200],
    tag:     'habitwell-reminder',         // replaces old notif instead of stacking
    renotify: false,
    data: {
      url: payload.data?.url || 'https://devil-jackbox.github.io/habitwell-pwa/'
    }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If app is already open, focus it
      for (const client of clientList) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open new window
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
