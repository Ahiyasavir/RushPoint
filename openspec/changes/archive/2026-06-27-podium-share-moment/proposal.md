# Proposal — Podium moment (animated finish + branded share)

## Why

The end of a run is the single most emotional, most shareable moment of the whole experience — and
today it is a static score screen. A celebratory **3D podium reveal** for the top teams, followed by
a one-tap **branded share**, turns that peak into organic reach: people post their podium to stories.

> The podium *animation* itself overlaps Appendix B row #10 ("Game Juice"). This change scopes the
> **podium reveal + the share moment** specifically, and consumes the `share-branding` stamp.

## What Changes

> Observable behavior. Finish-screen UI + a share action; no scoring change.

- When a run finalizes, the Final screen plays a **podium reveal**: the top 3 teams rise onto a
  1-2-3 podium with confetti, honoring `prefers-reduced-motion` (instant podium, no motion).
- A **"Share podium"** button generates a branded podium image (via the `share-branding` stamp:
  logo + app link + QR) and routes it to the native share sheet / download.
- Non-top teams see a personalized "You placed #N" celebration with the same share affordance.

## Capabilities

### New Capabilities
- `podium-moment`: an animated top-3 podium reveal on the Final screen plus a one-tap branded podium
  share image.

### Modified Capabilities
<!-- None -->

## Surfaces touched

- **play-web:** `screens/FinalScreen.tsx` — podium reveal component; a podium-card builder that tiles
  the top 3 and calls `stampBrand` (from `share-branding`). Pure `selectPodium(rankings)` helper.
- **Tests:** `scripts/test-podium.ts` (podium selection + placement pure logic).
- **Depends on [`share-branding`](../share-branding/proposal.md)** for the stamp; complements
  Appendix B #10 for the animation primitives.
- No callable, no server change.

## Non-goals

- No change to ranking/scoring — `selectPodium` only reads the final `rankings[]`.
- No video/animated export — still podium image only.
- No standalone 3D engine — CSS transforms + the existing confetti only.
