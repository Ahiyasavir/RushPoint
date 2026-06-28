# Design — White-label Pro tier

## Current behavior

- `wallet.plan: 'free' | 'pro'`, `proExpiresAt`. `GameBranding` already exists on the game.
- The finish footer carries a "Powered by RushPoint" + `?ref=` on **non-Pro** runs (CLAUDE.md). Share
  cards (`storyCard.ts`) draw the RushPoint wordmark; `share-branding` adds logo+QR.
- `launchRun` seals plan/maxParticipants onto the run at launch.

## Approach

### Pure helper → `packages/shared/src` (the TDD lever)

```ts
resolveRunBrand(
  entitlement: { whiteLabel: boolean; brand?: { name: string; logoUrl: string } },
  gameBranding?: GameBranding
): { showRushpointFooter: boolean; brandName: string; brandLogoUrl: string | null }
  // whiteLabel + valid brand → creator brand, footer hidden.
  // else → RushPoint brand, footer shown.
```

Tested in `scripts/test-run-brand.ts`: white-label with brand → creator brand + no footer;
white-label without a brand → falls back to RushPoint (no half-branded state); non-white-label →
RushPoint + footer.

### Entitlement + sealing

- Extend the wallet/plan model with `whiteLabel: boolean` and a `brand`. Granted via billing
  (`subscribePro` extended with a white-label SKU, server-validated).
- `launchRun` seals `run.whiteLabel` + `run.brand` from the wallet at launch (so a later downgrade
  doesn't change an in-flight run).

### Consumers

`storyCard`, recap collage, podium share, and the finish footer call `resolveRunBrand(run.entitlement,
game.branding)` to decide whose logo and whether to show the RushPoint footer.

## Test strategy (TDD)

- **Pure (RED first)** → `scripts/test-run-brand.ts`: the resolution truth table above.
- **e2e** → launch with a white-label wallet → `run.whiteLabel === true` + brand sealed; launch with a
  standard wallet → footer shown. Server-validated (a client cannot fake the entitlement).
- **UI (preview):** white-label run finish screen shows the creator brand, no RushPoint footer;
  standard run shows the footer.

## Conventions

- Entitlement is server-validated, sealed at launch (Appendix A rule 15 — server-write-only state).
- `resolveRunBrand` is the single source of truth — no scattered `if (pro)` branding checks.
- Compliance/legal attribution is out of scope of the suppression.
