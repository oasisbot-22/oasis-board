const SW_VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `oasis-board-cache-${SW_VERSION}`;

const VERSIONED_ASSETS = [
  `/?v=${SW_VERSION}`,
  `/index.html?v=${SW_VERSION}`,
  `/styles.css?v=${SW_VERSION}`,
  `/app.js?v=${SW_VERSION}`,
  `/manifest.webmanifest?v=${SW_VERSION}`,
  `/icons/icon-192.png?v=${SW_VERSION}`,
  `/icons/icon-512.png?v=${SW_VERSION}`,
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(VERSIONED_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('oasis-board-cache-') && k !== CACHE).map((k) => caches.delete(k)));
    if ('navigationPreload' in self.registration) {
      try { await self.registration.navigationPreload.enable(); } catch {}
    }
    await self.clients.claim();
    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    for (const client of clients) {
      client.postMessage({ type: 'SW_ACTIVATED', version: SW_VERSION });
    }
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  if (requestUrl.pathname.startsWith('/api/')) return;

  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preloaded = await event.preloadResponse;
        if (preloaded) return preloaded;

        const networkResponse = await fetch(event.request);
        const copy = networkResponse.clone();
        caches.open(CACHE).then((cache) => cache.put(`/?v=${SW_VERSION}`, copy));
        return networkResponse;
      } catch {
        return caches.match(`/?v=${SW_VERSION}`) || caches.match(`/index.html?v=${SW_VERSION}`);
      }
    })());
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((networkResponse) => {
        const copy = networkResponse.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return networkResponse;
      });
    })
  );
});
