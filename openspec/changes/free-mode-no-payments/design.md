# Design — Free mode (payments off)

## Current behavior (authoritative refs)

- `functions/src/runs/index.ts` `launchRun` (≈L121) runs a billing `runTransaction`: Pro → ok;
  else a free run; else a credit; else **refuse**. Sets `run.billingType` + `maxParticipants`.
- `functions/src/payments/index.ts` — `purchaseCredits` (L121), `subscribePro` (L174),
  `getWalletStatus` (L103), `stripeWebhook` (L286), `claimReferral`.
- `apps/creator-web/src/pages/WalletPage.tsx`, pricing/upsell copy in `i18n.ts`, `RunConsolePage.tsx`.
- Pro-gated surfaces specced this version: analytics (#49), white-label (#58), replay unlock (#59).

## Approach

A single flag is the whole design. Everything reads it; nothing is deleted.

### Config + pure helpers → `packages/shared/src` (the TDD lever)

```ts
export const PAYMENTS_ENABLED = false;   // launch default; flip to true to restore billing

resolveLaunchBilling(
  paymentsEnabled: boolean,
  wallet: { plan?: 'free'|'pro'; eventCredits?: number }
): { billingType: Run['billingType']; maxParticipants: number; consume: 'none'|'free_run'|'credit' }
  // paymentsEnabled === false  → { billingType: 'free', maxParticipants: FREE_MODE_MAX_PARTICIPANTS, consume: 'none' }
  // paymentsEnabled === true   → the existing pro / free-run / credit / refuse logic

isFeatureUnlocked(
  paymentsEnabled: boolean,
  wallet: { plan?: string; proExpiresAt?: string|null },
  feature: 'analytics'|'white_label'|'replay'
): boolean
  // paymentsEnabled === false → always true (everything unlocked)
  // paymentsEnabled === true  → the feature's normal Pro check
```

Tested in `scripts/test-free-mode.ts` (no emulator): free mode → always free launch + no consume +
all features unlocked; payments on → existing pro/credit/refuse + per-feature Pro gate preserved.

### Backend wiring

- `launchRun` calls `resolveLaunchBilling`; when `consume === 'none'` it skips the wallet
  transaction entirely (no read, no decrement) and just seals `billingType: 'free'`.
- `purchaseCredits` / `subscribePro`: first line — `if (!PAYMENTS_ENABLED) throw HttpsError(
  'failed-precondition', 'payments_disabled')` (bilingual). `stripeWebhook` returns 200 no-op.
- `getWalletStatus` returns a `paymentsEnabled: false` field so clients render free mode without
  guessing.

### Client wiring

- A shared `PAYMENTS_ENABLED` import gates UI: `WalletPage` route hidden; pricing/“buy”/“upgrade”
  copy and CTAs not rendered; nav entry removed.
- The Pro-gated surfaces (#49/#58/#59) call `isFeatureUnlocked(PAYMENTS_ENABLED, wallet, …)` → all
  open in free mode (no upsell chip).
- play-web finish footer: when `!PAYMENTS_ENABLED`, render without the upsell line.

## Test strategy (TDD)

- **Pure (RED first)** → `scripts/test-free-mode.ts`: `resolveLaunchBilling` + `isFeatureUnlocked`
  for both flag states (free → unlimited free + unlocked; on → existing behavior intact).
- **e2e** → with payments off: a creator with **0 credits, free plan** launches a run successfully
  (no refuse, no decrement); `purchaseCredits`/`subscribePro` → `failed-precondition`.
- **UI (preview):** no wallet/pricing/upsell visible anywhere; analytics/white-label/replay open.

## Conventions / footguns respected

- Server-write-only billing untouched in shape; the flag only **short-circuits** it (Appendix A 15).
- No deletion — payments return by flipping one constant. Helpers are pure (fully unit-tested).
- The flag is the single source of truth for both server and client (no divergence).
