## Why

The app's "try a sample game" button is the single most important first impression: it is what
a stranger taps before they trust the product enough to sign up. Today that button points at a
shared seeded live run (`?code=PLAY01` → `demo-game-oldcity`, "מירוץ הסלון"), which drops every
visitor into the SAME run and reads as a thin placeholder rather than a showcase. It does not
lean on instant-play, and its content is Hebrew only and unremarkable.

A flagship demo should be the FACE of the platform: a charming, witty, genuinely fun game a
first-time visitor can start solo, in seconds, from anywhere on earth, with zero setup, no
organizer, no staff approval, and no GPS — showcasing the coolest features tastefully without
overwhelming a newcomer.

## What Changes

- A new **flagship instant-play demo game**, "אקדמיית הסוכנים" (The Pocket Spy Academy):
  a light bilingual spy narrative across **3 short stages / 8 tasks**, every one `locationless`,
  every photo task `autoApprove: true`, published to the gallery with `allowInstantPlay: true`
  and NOT consent-gated, so it launches through the existing `startInstantPlay` callable with no
  human in the loop.
- The demo is defined once in `scripts/lib/spy-academy-game-def.mjs` and seeded on every emulator
  boot (idempotent) by `scripts/seed-local.mjs`, mirroring the Sansana/QA game pattern.
- The creator landing page's demo button (`AuthGate.tsx`) is **repointed** from the shared
  `?code=PLAY01` live run to `?game=demo-instant-spy`, so tapping it opens the promo screen whose
  "Play now" starts a fresh solo run of the flagship via `startInstantPlay`.
- A pure invariant test (`scripts/test-flagship-demo.ts`, in `npm test`) pins the contract:
  every task locationless, every photo auto-approving, no field/geofence/smart_station types,
  instant-play eligible, not consent-gated, every stage winnable, answer keys present, bilingual.

The old `demo-game-oldcity` stays seeded (e2e/tests reference it) but is no longer the FEATURED
try-it experience.

## Capabilities

### New Capabilities
- `flagship-instant-demo`: a staffless, locationless, instant-play showcase game that is the
  app's featured "try it" experience, plus the invariants that keep it playable-from-anywhere.

## Non-goals
- No new callable, no schema change, no sanitizer/authz/privacy change — it rides the existing
  `startInstantPlay` + `?game=` promo route unchanged.
- No new play-web route or button component — the existing GamePromo "Play now" is the entry.
- No removal of the old demo game; only what the featured demo button points at changes.

## Surfaces touched
- **scripts:** new `scripts/lib/spy-academy-game-def.mjs`; `scripts/seed-local.mjs` seeds it every
  boot; new `scripts/test-flagship-demo.ts` (pure, auto-discovered by `npm test`).
- **creator-web:** `AuthGate.tsx` `DEMO_URL` now targets `?game=demo-instant-spy`.
- **rules/functions/shared:** unchanged.
