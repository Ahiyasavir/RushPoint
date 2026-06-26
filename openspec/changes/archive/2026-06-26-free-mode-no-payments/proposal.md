# Proposal — Free mode (payments & subscriptions off for launch)

## Why

For the initial launch we want **zero friction and zero payment risk**: the whole app should be
completely free, with no credits, no Pro subscription, and **no mention of payment anywhere**.
Payments are also currently blocked on the Israeli merchant-account / Cardcom setup (§ DEPLOY /
launch-readiness), so gating them off cleanly lets us launch now and switch billing on later without
re-architecting.

The goal is to **set payments aside, not delete them** — every billing callable, the wallet ledger,
and the credit/Pro model stay in the codebase behind a single flag, so flipping payments back on is a
one-line change, not a re-implementation.

## What Changes

> Observable behavior. A single `PAYMENTS_ENABLED` flag (default **false**) gates all billing.

- **Launching a run is always free.** With payments off, `launchRun` never consumes a credit, never
  requires Pro, and never refuses for billing reasons — every creator can launch unlimited runs.
- **No payment is ever shown.** The Wallet/credits page, pricing, "buy credits", "upgrade to Pro",
  and any cost copy are **hidden** across creator-web; the participant finish footer drops the upsell.
- **Buying is disabled.** `purchaseCredits` and `subscribePro` reject with a typed "payments are
  currently disabled" error; `stripeWebhook` is inert. (They remain in code, dark.)
- **All previously Pro-gated features are unlocked for everyone** while in free mode (analytics
  dashboard, white-label, replay) — no upsell, full access.
- **Reversible:** setting `PAYMENTS_ENABLED = true` restores the existing credit/Pro behavior with no
  other code change.

## Capabilities

### New Capabilities
- `free-mode`: a single `PAYMENTS_ENABLED` flag that, when off, makes the entire app free —
  unlimited free launches, all Pro features unlocked, and every payment surface hidden — while
  keeping all billing code intact for a later flip.

### Modified Capabilities
<!-- launchRun billing, the wallet-status read, and the Pro-gate checks become flag-aware. -->

## Surfaces touched

- **shared:** `PAYMENTS_ENABLED` config flag + pure helpers `resolveLaunchBilling(paymentsEnabled,
  wallet)` and `isFeatureUnlocked(paymentsEnabled, wallet, feature)` — the TDD lever.
- **Backend:** `launchRun` uses `resolveLaunchBilling` (free-mode short-circuit, no credit/Pro);
  `purchaseCredits` / `subscribePro` reject when disabled; `getWalletStatus` reports free-mode.
- **creator-web:** hide `WalletPage`, pricing, and all upsell CTAs (`i18n.ts`, `RunConsolePage`,
  nav); the Pro-gated surfaces (analytics #49, white-label #58, replay #59) read `isFeatureUnlocked`.
- **play-web:** finish footer drops the non-Pro upsell while in free mode.
- **Tests:** `scripts/test-free-mode.ts` (billing + feature-unlock resolution); e2e (free unlimited
  launch; buying rejected).

## Non-goals

- **No deletion of payment code** — the wallet ledger, Stripe webhook, and all billing callables stay
  (dark) so payments can be re-enabled by flipping the flag.
- **No refunds / migration of existing wallets** — balances are simply ignored while free.
- **No change to referral mechanics' existence** (referral free-run grants are moot in free mode but
  the code stays).
- **No removal of the legal/ToS billing sections** — they remain accurate for when payments return.
