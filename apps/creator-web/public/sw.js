/*
 * RushPoint Admin — service worker.
 *
 * Goal: make the dashboard installable and keep it loading when the network
 * drops (Jerusalem dead zones). It caches ONLY the static app shell — the
 * HTML/JS/CSS/icon. It deliberately does NOT touch Firestore/Functions/Auth
 * traffic: those run over the Firestore SDK, which has its own IndexedDB
 * offline cache (see services/firebase.ts). Caching API/auth responses here
 * would serve stale game state, so we let every non-GET and every cross-origin
 * request fall straight through to the network.
 */
const CACHE = 'rushpoint-admin-shell-v2';
const SHELL = [
  '/', '/index.html', '/manifest.webmanifest',
  '/icon.svg', '/icon-192.png', '/icon-512.png', '/icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
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

  // Only handle same-origin GETs. Everything else (Firestore, Functions, Auth,
  // POSTs) bypasses the worker entirely.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // SPA navigations: network-first so a fresh build is picked up, falling back
  // to the cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/'))),
    );
    return;
  }

  // Static assets: cache-first, then populate the cache on first network hit.
  event.respondWith(
    caches.match(req).then((cached) =>
      cached ||
      fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }),
    ),
  );
});
