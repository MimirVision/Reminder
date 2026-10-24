// Vakt's service worker: lets Vakt install as an app and open instantly. It caches the app itself (the page,
// scripts, styles, fonts, icons), never data: every request to Supabase goes straight to the network, so what you
// see is always the database's current state. Scoped to Vakt's own folder, so it never touches the other apps.
const CACHE = 'vakt-shell-v3';
const SHELL = ['./', './manifest.webmanifest', './icon.svg', './icon-192.png', './theme.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('vakt-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  const scope = new URL(self.registration.scope);
  if (req.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;

  // Pages: the network first, so a new version shows up at once; the cached page when offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      if (res.ok) caches.open(CACHE).then((c) => c.put('./', copy));
      return res;
    }).catch(() => caches.match('./')));
    return;
  }
  // Built files have their content hash in the name, so a cached copy is always right.
  if (url.pathname.includes('/assets/')) {
    e.respondWith(caches.match(req).then((hit) => hit ?? fetch(req).then((res) => {
      const copy = res.clone();
      if (res.ok) caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    })));
    return;
  }
  e.respondWith(fetch(req).catch(() => caches.match(req)));
});


// Reminders (Web Push from the vakt-notify function). The message is encrypted end to end: the push service that
// carries it (Apple, Google, Mozilla, Microsoft) cannot read it.
self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { title: 'Vakt', body: e.data ? e.data.text() : '' }; }
  const icon = new URL('icon-192.png', self.registration.scope).href;
  e.waitUntil(self.registration.showNotification(m.title || 'Vakt', { body: m.body || '', tag: m.tag || undefined, icon, badge: icon, data: { url: m.url || '/' } }));
});

// A tap opens the app on the right tab (the tabs live after the #), in a window that is already open if there is one.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const path = (e.notification.data && e.notification.data.url) || '/';
  const target = `${self.registration.scope}#${path}`;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.startsWith(self.registration.scope));
    if (open) return open.navigate(target).then((c) => (c || open).focus());
    return self.clients.openWindow(target);
  }));
});
