// Kill switch for the participant app's service worker (change: marketing-to-apex).
//
// This file exists for one reason: the apex used to serve play-web, whose
// main.tsx registers `/sw.js` on every production visit. A service worker is
// scoped to an ORIGIN, not to an app, so every returning visitor to
// rush-point.com still has that worker installed and controlling this site.
//
// What it does to this site if left alone: its non-navigation handler is
// cache-first, so `/manifest.webmanifest`, `/icon-512.png` and `/og.jpg` keep
// being answered out of the old `rushpoint-play-v5` cache — this site would
// advertise the participant app's PWA identity from its own origin. Its
// navigation handler is network-first, so pages usually come through correctly,
// but on a flaky connection it falls back to the cached play-web shell and the
// visitor gets the old app on a domain that no longer serves it. Nothing about
// either failure looks like a caching problem from the outside.
//
// A worker does not go away on its own: it is replaced only by whatever the
// browser finds at the SAME path on its next update check, which happens on
// navigation. So the fix has to LIVE at /sw.js on this origin. Deleting the file
// would leave the old worker installed forever, because a 404 is not an update.
//
// `skipWaiting` + `clients.claim` so this takes effect on the first check rather
// than after every tab holding the old worker is closed.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => {
        // Reload each open tab so it is served by the network rather than by the
        // worker that is being torn down underneath it.
        clients.forEach((client) => client.navigate(client.url));
      })
      .catch(() => undefined),
  );
});

// No fetch handler on purpose. A worker with no fetch listener does not intercept
// anything, so from the moment this installs the network is the only source, even
// in the window before `unregister` completes.
