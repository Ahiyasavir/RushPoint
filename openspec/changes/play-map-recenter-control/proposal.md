## Why

Product owner: *"In the game map I want a button that focuses the map back to my location."*

The participant map frames its targets and the player's dot ONCE, on first fit
(`apps/play-web/src/components/NavMap.tsx`, `fitted.current`), and then never moves the camera again.
A player who pinches, drags or zooms while walking has no way back: the map is a 208 px strip on a
phone held in one hand while navigating, so a stray thumb drag is not an edge case, it is the normal
case. Once the dot is off screen the map stops answering the only question it exists to answer,
"where am I versus where do I go", and the player's recovery today is to leave the screen and come
back.

There IS a MapLibre `GeolocateControl` mounted on that map, and it is not the answer:

- it is a 29 px icon-only browser control whose accessible name is MapLibre's own hardcoded English
  string, on a Hebrew-default app;
- it opens a SECOND geolocation watch (`trackUserLocation: true`) alongside the one `PlayScreen`
  already runs, so a racing phone pays for two GPS subscriptions;
- it re-triggers the browser permission prompt, and on a denial it fails silently with a control
  that still looks tappable;
- it recentres on ITS OWN fix, which can disagree with the blue dot the app drew from the app's fix.

## What Changes

**A labelled recentre control on the participant map, driven by the app's own position.**

- A real `<button>` with a visible label and an explicit accessible name, in Hebrew and English,
  which pans and zooms the map back to the player's own dot — the same fix that drew the dot, so the
  camera and the marker can never disagree.
- It is present at all times so it does not appear and vanish under the player's thumb, and it is
  **disabled with an explanatory accessible name whenever there is no usable fix** (permission
  denied, no fix yet, a malformed or null-island coordinate). It never crashes, never throws, and
  never blocks anything else on the screen: the map, the task and every submit path are untouched
  whether it is enabled or not.
- MapLibre's `GeolocateControl` is removed, so the app runs exactly one geolocation watch and there
  is exactly one "take me back" affordance on the map.

## What explicitly does NOT change

- **No new permission request.** The control consumes the position `PlayScreen` already tracks; it
  never calls `navigator.geolocation` itself.
- **The initial fit.** The map still frames targets + the player once on first data, unchanged.
  Recentring is a manual action and never fights the user's own panning.
- **Nothing is gated on it.** No submission, check-in, arrival probe or navigation depends on the
  control's state. A disabled button is a missing convenience, never a blocked player.
- **No new callable, no server change, no rules change, no env var, no new dependency.**

## Surfaces touched

- `apps/play-web` — **NEW** `src/lib/recenter.ts` (pure verdict), `components/NavMap.tsx`,
  `i18n.ts` (HE + EN).
- `scripts/` — **NEW** `test-map-recenter.ts`.
- **Not touched:** `functions/`, `packages/shared`, `apps/creator-web`, `firestore.rules`.
