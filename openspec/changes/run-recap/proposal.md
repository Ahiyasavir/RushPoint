# Proposal — Run recap (competition summary + everyone's photos)

## Why

When a run ends, the moment of peak shareability arrives — and the app has nothing to offer beyond a
single team's score card. There is no **competition-level recap**: the organizer can't post "here's
how our event went", and the dozens of **photos** participants captured during the run (stored at
`TaskState.photoUrl` across every team) are never resurfaced. That is the single richest pile of
organic, brand-carrying content the platform produces, and today it dies in Firestore.

This change adds a **shareable run recap**: an aggregate of the final standings plus a **montage of
everyone's photos**, rendered as a branded collage image and a **public recap page the organizer can
share** (WhatsApp-first). It turns the end of every event into a recruitment surface.

## What Changes

> Observable behavior.

- A new **`getRunRecap`** callable returns the competition recap for a run: ordered standings (rank,
  team, score, time), the **collected approved photos across all teams**, and headline stats (teams,
  photos, winner). Owner-only for any run; **public only when the run is `published`** (mirrors
  `getPublicLeaderboard`).
- The participant/organizer app renders a **recap view** and a **branded recap collage** image that
  tiles everyone's photos — shared via the [`share-branding`](../share-branding/proposal.md) stamp
  (logo + link + QR).
- A **public recap URL** (`?recap=<accessCode>`, published-only) renders the shareable recap page —
  parallel to the existing `?board=<accessCode>` public leaderboard — so an organizer can drop one
  link in a group chat.
- Photos in the recap respect existing **moderation** (only approved/non-rejected photo tasks) and
  **PII retention** (the recap's photo list is empty once a run's PII is pruned, standings remain).

## Capabilities

### New Capabilities
- `run-recap`: a `getRunRecap` aggregate (standings + everyone's photos + stats), a shareable branded
  recap collage, and a public organizer recap page.

### Modified Capabilities
<!-- None — introduced as a new capability; becomes the baseline at archive time. -->

## Surfaces touched

- **Callable:** new `getRunRecap` in `functions/src/runs/index.ts` + re-export in
  `functions/src/index.ts` + typed wrapper in both apps' `services/calls.ts`.
- **shared:** `packages/shared/src` — `buildRunRecap(teams, run)` aggregator + `computeMontageGrid(n,
  W, H)` layout (both pure/testable); recap result types; new `?recap=` route constant.
- **play-web:** a recap screen + `?recap=<accessCode>` public route in `App.tsx`; a recap-collage
  builder that tiles photos and calls the `share-branding` `stampBrand`.
- **creator-web:** a "Share recap" action in the RunConsole (post-finalize) surfacing the public link.
- **Tests:** new `scripts/test-run-recap.ts` (aggregator + montage-grid pure logic); `getRunRecap`
  assertions added to `scripts/e2e-verify.mjs`.

## Non-goals

- **No new photo storage or re-upload** — the recap reads existing `TaskState.photoUrl` values.
- **No server-side image rendering** — the collage is composited client-side (the `share-branding`
  helper); `getRunRecap` returns data + URLs only.
- **No moderation changes** — it only *reads* the approved/rejected outcome already on each photo.
- **No video / animated recap** — still-image montage only.
- **Depends on [`share-branding`](../share-branding/proposal.md)** for the watermark — land that first.
