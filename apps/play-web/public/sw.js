/* RushPoint play-web service worker — offline app shell.
 *
 * Field participants lose signal often. This SW keeps the app *loadable* offline
 * by caching the app shell (HTML + hashed JS/CSS/font/image assets). It never
 * caches Firebase traffic (Firestore/Auth/Functions/Storage are cross-origin and
 * handled by the SDK's own offline cache); only same-origin GETs are touched.
 */
// Bump on every shell-affecting release: `activate` deletes every other cache, so
// a bump is what actually pushes a fix (e.g. the wave-e deep-link routing fix) out
// to devices that already installed the app. A stale shell can also reference a
// hashed chunk that no longer exists — see lazyWithRetry() in src/App.tsx.
const CACHE = 'rushpoint-play-v3';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', '/icon-512-maskable.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Only same-origin requests; let Firebase / cross-origin traffic pass through.
  if (url.origin !== self.location.origin) return;

  // Navigations: network-first so fresh deploys win, fall back to cached shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Only cache a healthy same-origin shell. A deploy-in-progress 5xx, a
          // field captive-portal interstitial, or any non-basic/redirected body
          // would otherwise be persisted as /index.html and served as the app
          // shell on every later OFFLINE boot until a good navigation overwrites
          // it — a poisoned, blank boot exactly when signal is lost.
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('/index.html', copy));
          }
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/'))),
    );
    return;
  }

  // Static assets: stale-while-revalidate (instant from cache, refresh in bg).
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
