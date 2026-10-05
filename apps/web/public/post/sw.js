// Post service worker. Two jobs: open instantly from a cached shell (even offline), and turn a push from your alert server into the
// number on the Home Screen icon. iOS requires every push to show a notification; with only Badges switched on in iOS Settings
// that notification is silent and invisible, and the number is all you see.
const SHELL = 'post-shell-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.add('/post/')).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL && k.startsWith('post-shell')).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Microsoft, Supabase, fonts: never touched here
  if (req.mode === 'navigate') {
    // Network first so a new version arrives at once; the saved shell opens the app with no connection.
    e.respondWith(fetch(req).then((res) => { if (res.ok && url.pathname.startsWith('/post/')) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put('/post/', copy)); } return res; }).catch(() => caches.match('/post/')));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    // Hashed file names never change, so cache first.
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); } return res; })));
  }
});

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: 'Post', body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const looking = wins.some((w) => w.visibilityState === 'visible');
    // The number on the icon is set here, so it updates with Post closed. If you are looking at Post right now there is nothing to count.
    let badge = Promise.resolve();
    if (self.navigator) {
      if (looking && 'clearAppBadge' in self.navigator) badge = self.navigator.clearAppBadge().catch(() => {});
      else if (!looking && typeof data.badge === 'number' && 'setAppBadge' in self.navigator) badge = self.navigator.setAppBadge(data.badge).catch(() => {});
    }
    wins.forEach((w) => w.postMessage({ type: 'push', looking }));
    await Promise.all([
      self.registration.showNotification(data.title || 'Post', { body: data.body || '', icon: '/post/icon-180.png', badge: '/post/icon-180.png', tag: data.tag || undefined, data: { url: data.url || '/post/' } }),
      badge,
    ]);
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/post/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    for (const w of wins) if ('focus' in w && 'navigate' in w) return w.navigate(target).then((c) => c && c.focus());
    return self.clients.openWindow(target);
  }));
});
