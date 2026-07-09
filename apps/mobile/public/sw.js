/*
 * RushPoint mobile (Expo web) — service worker.
 *
 * Makes the team app installable and keeps it loading when the network drops
 * (Jerusalem dead zones). Caches ONLY the same-origin app shell (HTML + the
 * hashed Expo/Metro JS/CSS under /_expo/ + icons). It deliberately does NOT
 * touch Firebase traffic (Firestore / Functions / Auth / Storage are all
 * cross-origin) — the Firestore SDK has its own IndexedDB offline cache, so
 * caching those here would serve stale game state. Cross-origin + non-GET
 * requests fall straight through to the network.
 */
const CACHE = 'rushpoint-mobile-shell-v1';
const SHELL = ['/', '/index.html', '/icon.svg', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()),
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

  // Only same-origin GETs. Firebase (firestore.googleapis.com,
  // *.cloudfunctions.net, identitytoolkit, the emulator on other ports) is
  // cross-origin and bypasses the worker entirely.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // SPA navigations: network-first (pick up fresh builds), fall back to the
  // cached shell offline.
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

  // Static assets (the hashed /_expo bundle, icons): cache-first, populate on
  // first network hit so the shell survives a later offline reload.
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
