/* Wayfare service worker (PWA)
 * - cache-first for hashed static assets (/assets/*) and static public files
 * - network-only for /api/* (never cached, never intercepted)
 * - navigations: network-first, offline fallback to the cached app shell
 */
const SHELL_CACHE = 'wayfare-shell-v1';
const STATIC_CACHE = 'wayfare-static-v1';
const SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/logo.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== STATIC_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // API traffic is network-only - never serve from cache.
  if (url.pathname.startsWith('/api/')) return;

  // Only handle same-origin GETs; leave cross-origin (fonts, tiles, photon) alone.
  if (url.origin !== self.location.origin) return;

  // SPA navigations: network-first, fall back to the cached shell offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Static files (hashed /assets/*, icons, images): cache-first, populate on miss.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
    )
  );
});
