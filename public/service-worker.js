const CACHE_VERSION = 6;
const CACHE_NAME = 'platestack-v' + CACHE_VERSION;
const API_CACHE_NAME = 'platestack-api-v1';
const STT_CACHE_NAME = 'platestack-stt-v1';

// Core app shell to pre-cache
const PRECACHE_URLS = [
  '/',
  '/css/style.css',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/manifest.json',
  // JS app shell
  '/js/app.js',
  '/js/api.js',
  '/js/sync.js',
  // Components
  '/js/components/actionMenu.js',
  '/js/components/allergenBadges.js',
  '/js/components/chatDrawer.js',
  '/js/components/collapsible.js',
  '/js/components/commandBar.js',
  '/js/components/lightbox.js',
  '/js/components/modal.js',
  '/js/components/toast.js',
  '/js/components/unitConverter.js',
  // Data
  '/js/data/allergenKeywords.js',
  '/js/data/allergens.js',
  '/js/data/categories.js',
  '/js/data/flavorPairings.js',
  '/js/data/units.js',
  // Pages
  '/js/pages/calendar.js',
  '/js/pages/chefsheet.js',
  '/js/pages/chefsheetPreview.js',
  '/js/pages/dishForm.js',
  '/js/pages/dishList.js',
  '/js/pages/dishView.js',
  '/js/pages/flavorPairings.js',
  '/js/pages/ingredientList.js',
  '/js/pages/login.js',
  '/js/pages/menuBuilder.js',
  '/js/pages/menuList.js',
  '/js/pages/serviceNotes.js',
  '/js/pages/settings.js',
  '/js/pages/shoppingList.js',
  '/js/pages/specials.js',
  '/js/pages/today.js',
  '/js/pages/todoView.js',
  // Utils
  '/js/utils/escapeHtml.js',
  '/js/utils/loadingState.js',
  '/js/utils/markdown.js',
  '/js/utils/notifications.js',
  '/js/utils/printSheet.js',
  '/js/utils/speechToText.js',
  '/js/utils/unitConversion.js',
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

// Activate: clean up old caches (including stale API cache on version bump)
self.addEventListener('activate', (event) => {
  const keep = new Set([CACHE_NAME, API_CACHE_NAME, STT_CACHE_NAME]);
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
//  - Root '/': network-first, but only cache the SPA shell (not landing.html)
//  - API GET requests: network-first, fall back to cached response for offline reads
//  - JS/CSS/HTML: stale-while-revalidate for fast loads + fresh updates
//  - Other static assets: cache-first
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Cache Transformers.js CDN files (library code for offline STT)
  if (request.method === 'GET' && url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('transformers')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((res) => {
          const clone = res.clone();
          caches.open(STT_CACHE_NAME).then((cache) => cache.put(request, clone));
          return res;
        });
      })
    );
    return;
  }

  // Skip non-GET and cross-origin
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // API GET requests: network-first with offline fallback
  if (url.pathname.startsWith('/api/')) {
    // Skip caching for auth and other sensitive endpoints
    if (API_NO_CACHE.some((p) => url.pathname.startsWith(p))) return;

    event.respondWith(
      fetch(request)
        .then((res) => {
          // Only cache successful JSON responses with valid Content-Type
          if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
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

  // Root path: network-first, but only cache if it's the SPA shell (not landing.html)
  if (url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          // Only cache the authenticated SPA shell, not the landing page.
          // Landing page is small HTML; SPA shell links to app.js.
          const clone = res.clone();
          if (res.ok) {
            clone.text().then((html) => {
              if (html.includes('/js/app.js')) {
                caches.open(CACHE_NAME).then((cache) => cache.put(request, new Response(html, {
                  status: res.status,
                  statusText: res.statusText,
                  headers: res.headers,
                })));
              }
            });
          }
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // JS / CSS / HTML: stale-while-revalidate — serve from cache instantly, update in background
  if (url.pathname.match(/\.(js|css|html)$/) || url.pathname.endsWith('/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return res;
        });
        // Return cached version immediately if available, otherwise wait for network
        return cached || fetchPromise;
      })
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
