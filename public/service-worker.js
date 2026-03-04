const CACHE_NAME = 'platestack-v3';
const API_CACHE_NAME = 'platestack-api-v1';

// Core app shell to pre-cache
const PRECACHE_URLS = [
  '/',
  '/css/style.css',
  '/favicon.svg',
  '/manifest.json',
];

// API paths that should never be cached (auth, mutations, sensitive)
const API_NO_CACHE = [
  '/api/auth/',
  '/api/settings/backup',
  '/api/settings/restore',
];

// Install: pre-cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  const keep = new Set([CACHE_NAME, API_CACHE_NAME]);
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Notification click: focus the app and navigate to the relevant page
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const hash = event.notification.data && event.notification.data.hash;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing window if available
      for (const client of clients) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          if (hash) client.navigate(self.location.origin + '/' + hash);
          return;
        }
      }
      // Open new window if none found
      return self.clients.openWindow('/' + (hash || ''));
    })
  );
});

// Fetch strategy:
//  - API GET requests: network-first, fall back to cached response for offline reads
//  - JS/CSS/HTML: network-first so deployments show immediately; fall back to cache offline
//  - Other static assets: cache-first
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // API GET requests: network-first with offline fallback
  if (url.pathname.startsWith('/api/')) {
    // Skip caching for auth and other sensitive endpoints
    if (API_NO_CACHE.some((p) => url.pathname.startsWith(p))) return;

    event.respondWith(
      fetch(request)
        .then((res) => {
          // Only cache successful JSON responses
          if (res.ok) {
            const clone = res.clone();
            caches.open(API_CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return res;
        })
        .catch(() =>
          // Offline: try to serve from cache
          caches.match(request).then((cached) => {
            if (cached) return cached;
            // No cached version — return a synthetic offline error
            return new Response(
              JSON.stringify({ error: 'You are offline and this data is not cached yet' }),
              { status: 503, headers: { 'Content-Type': 'application/json' } }
            );
          })
        )
    );
    return;
  }

  // JS / CSS / HTML: network-first so deployments show immediately; fall back to cache offline
  if (url.pathname.match(/\.(js|css|html)$/) || url.pathname === '/' || url.pathname.endsWith('/')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Other static assets (images, fonts): cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        return res;
      });
    })
  );
});
