## Why

The creator Dashboard's trailing "Explore / next steps" section re-advertises destinations that are
already one tap away in the persistent top nav. On a Dashboard that already has **Build / Gallery /
Wallet** in the top nav, this section (below the game grid, `DashboardPage.tsx`) renders a feature
**banner** whose CTAs link Gallery and (in paid mode) Wallet, **and then** a 3-card quick-actions
grid whose targets are `builder` / `gallery` / `wallet` (`templateLabels.ts` `QUICK_CARD_IDS`).
Gallery and Wallet each end up reachable three times on one screen, and the block is a tall promo
wall under the creator's actual games.

## What Changes

- Remove the redundant **3-card quick-actions grid** (the `QUICK_CARD_IDS`-driven cards).
- Keep the single feature **banner** as the one "next step" nudge (its Gallery / Invite-&-earn
  pitch is the non-redundant part — a framed invitation rather than a bare re-link).

This halves the redundancy while keeping one intentional pointer.

## What does NOT change

- **No destination becomes unreachable.** Build, Gallery, and Wallet all remain in the persistent
  top nav; Gallery (and, in paid mode, Wallet via "invite & earn") also remain on the banner. The
  "create a game" action the builder card offered is already served by the game grid and the
  new-game entry above.
- **The banner is untouched** (badge, title, body, `bannerCta1` → Gallery, `bannerCta2` → Wallet
  under `PAYMENTS_ENABLED`).
- **i18n keys stay in place.** The `dashboard.quickCards` strings and `QUICK_CARD_IDS` remain in the
  dictionary/lib (still referenced by `templateLabels` and its test) — the change only stops
  *rendering* the grid, so no keys are orphaned and `templateLabels.test.ts` still passes.
- No backend change, no routing change.

## Impact

- `apps/creator-web` — `src/pages/DashboardPage.tsx` (remove the quick-actions grid block; keep the
  banner). No i18n edit (strings left in place).
- **Not touched:** `src/lib/templateLabels.ts` (data + helpers stay), `functions/`,
  `packages/shared`, `apps/play-web`.
