// Post alerts service worker: shows a notification for every push and opens the alerts page when it is tapped.
// iOS requires every push to show a notification, so there is no silent path here.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: 'Post', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(data.title || 'Post', {
    body: data.body || '',
    icon: '/post-alerts/icon-180.png',
    badge: '/post-alerts/icon-180.png',
    tag: data.tag || undefined,
    data: { url: data.url || '/post-alerts/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/post-alerts/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    for (const w of wins) if ('focus' in w && 'navigate' in w) return w.navigate(target).then((c) => c && c.focus());
    return self.clients.openWindow(target);
  }));
});
