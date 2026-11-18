// Service worker: shows phone/desktop notifications sent by the server and opens the job when tapped.
// It also makes the site installable as an app. It deliberately caches nothing: pages hold private order and account data.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Required by some browsers for the install prompt. Every request simply goes to the network as normal.
self.addEventListener('fetch', () => {});

self.addEventListener('push', (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch (e) {
    d = { title: 'Tap to Wash', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(d.title || 'Tap to Wash', {
      body: d.body || '',
      tag: d.tag || undefined,
      icon: '/site-icon',
      badge: '/site-icon',
      data: { url: d.url || '/admin/notifications' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/admin/notifications';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.indexOf('/admin') !== -1 && 'focus' in c) {
          c.focus();
          if ('navigate' in c) return c.navigate(url);
          return undefined;
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
