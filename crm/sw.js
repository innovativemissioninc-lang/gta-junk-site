// GTJ CRM service worker: caches the app shell so it opens instantly and
// installs as a phone app. API calls always go to the network.
const CACHE = 'gtj-crm-v7';
const SHELL = ['/crm/', '/crm/app.css?v=7', '/crm/playbook.js?v=7', '/crm/app.js?v=7', '/crm/manifest.webmanifest', '/crm/icon-192.png', '/assets/logo-badge.svg', '/assets/logo-horizontal-light.svg'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) return;
  if (!url.pathname.startsWith('/crm/')) return;
  // Network first, so updates show up; fall back to cache when offline.
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request).then((r) => r || caches.match('/crm/'))));
});
