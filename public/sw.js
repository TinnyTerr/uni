/**
 * Offline shell for the phone install.
 *
 * The app is useful on a train with no signal, so the shell is cached and
 * served cache-first. Sync traffic is the opposite: `/api/` is never cached,
 * because a stale answer there would look like the server had rolled back.
 */
const VERSION = 'uni-v1';
const SHELL = `${VERSION}-shell`;
const TILES = `${VERSION}-tiles`;
const TILE_HOST = 'tile.openstreetmap.org';
const MAX_TILES = 600;

// Enough to boot offline; hashed assets are added as they are requested.
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(PRECACHE))
      // A missing entry must not wedge the whole install.
      .catch((e) => console.warn('precache incomplete', e))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== TILES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Lets the page apply an update without the user force-quitting the app.
self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Map tiles: cache-first, so the campus you have already looked at works
  // with no signal. Bounded, oldest evicted first.
  if (url.hostname === TILE_HOST) {
    event.respondWith(
      caches.open(TILES).then((cache) =>
        cache.match(request).then(
          (hit) =>
            hit ??
            fetch(request).then(async (res) => {
              // <img> tiles are cross-origin no-cors, so the response is opaque.
              if (res.ok || res.type === 'opaque') {
                await cache.put(request, res.clone());
                const keys = await cache.keys();
                for (const k of keys.slice(0, Math.max(0, keys.length - MAX_TILES))) await cache.delete(k);
              }
              return res;
            }),
        ),
      ),
    );
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // always live

  // Navigations: try the network so a new build is picked up, fall back to the
  // cached shell when there is no connection.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r ?? Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(request, copy));
          }
          return res;
        }),
    ),
  );
});
