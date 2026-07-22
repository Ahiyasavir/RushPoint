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
const CACHE = 'rushpoint-admin-shell-v4';
// Every shell path is resolved against the worker's OWN directory, never '/'.
// In playtest/tunnel mode creator-web is served under `/creator/` (vite `base`)
// while play-web owns `/` on the same origin — hardcoding '/' made this worker
// cache (and offline-serve) the *participant* app's shell.
const BASE = new URL('./', self.location).href;
const p = (rel) => new URL(rel, BASE).href;
const SHELL = [
  p('./'), p('index.html'), p('manifest.webmanifest'),
  p('icon.svg'), p('icon-192.png'), p('icon-512.png'), p('icon-512-maskable.png'),
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
          caches.open(CACHE).then((c) => c.put(p('index.html'), copy));
          return res;
        })
        .catch(() => caches.match(p('index.html')).then((r) => r || caches.match(p('./')))),
    );
    return;
  }

  // Static assets: NETWORK-FIRST, cache as offline fallback. A previous cache-first
  // strategy meant an installed PWA kept serving a stale bundle forever — code
  // edits (and dev-server/playtest updates) never reached the device because the
  // worker answered from cache and never re-fetched. Network-first always prefers
  // fresh content when online, and still falls back to the cache in a dead zone.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req)),
  );
});
