// Vakt's service worker: lets Vakt install as an app and open instantly. It caches the app itself (the page,
// scripts, styles, fonts, icons), never data: every request to Supabase goes straight to the network, so what you
// see is always the database's current state. Scoped to Vakt's own folder, so it never touches the other apps.
const CACHE = 'vakt-shell-v1';
const SHELL = ['./', './manifest.webmanifest', './icon.svg', './icon-192.png'];

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

