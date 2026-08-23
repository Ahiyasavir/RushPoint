## Why

The participant finish screen's ONLY on-screen "create your own" invite — the ⚡ "Powered by
RushPoint / Build your own field game, free →" footer — is wrapped in
`PAYMENTS_ENABLED && run.billingType !== 'pro'` (`apps/play-web/src/screens/FinalScreen.tsx:295-305`):

```tsx
{PAYMENTS_ENABLED && run.billingType !== 'pro' && (
  <a href={`${creatorUrl()}/?ref=${team.ownerUid}`} ...>
    ... {t.final.poweredBy} ... {t.final.buildOwn} ...
  </a>
)}
```

`PAYMENTS_ENABLED` is `false` — the launch default (`packages/shared/src/freeMode.ts:17`). So TODAY
**every finisher sees zero on-screen invitation to create their own game**; the only button below the
board is "Leave" (`:306`). The share card still preaches "Build your own field game"
(`lib/storyCard.ts:120`), but the player looking at their own screen is handed no next step.
Creator acquisition depends on converting delighted finishers, and the invite is currently dark for
100% of them.

The invite was coupled to `PAYMENTS_ENABLED` only because the `?ref=<ownerUid>` REWARD (a free run
credited to the host when a finisher signs up as a creator) is a payments concept. But the *invite
itself* has nothing to do with billing.

## What Changes

- Decouple the create-your-own INVITE from `PAYMENTS_ENABLED`. The finish screen SHALL always render
  a "Build your own field game →" CTA linking to the creator app, in both free mode and paid mode.
- Keep the Pro white-label suppression: the CTA SHALL stay hidden when `run.billingType === 'pro'`.
- Keep the `?ref=<ownerUid>` referral-REWARD semantics gated on `PAYMENTS_ENABLED`. When payments are
  off, the CTA links to the plain creator URL (no `?ref` credit to claim); when payments are on, it
  keeps the `?ref=<ownerUid>` tag exactly as today.

## What does NOT change

- The `?ref=` referral REWARD stays payment-coupled — only rendered / appended when
  `PAYMENTS_ENABLED` is true, so no change to referral crediting.
- Pro runs stay white-label: no branded CTA for `billingType === 'pro'`.
- The share-card CTA, the legal footer, the survey, the leaderboard/podium/badges — all unchanged.
- No server change. No new referral or wallet behavior.

## Impact

- Affected specs: `finish-create-cta` (new capability, one requirement ADDED).
- Affected code: `apps/play-web/src/screens/FinalScreen.tsx` (the footer's render condition + the
  href). Copy already exists — `t.final.buildOwn` and `t.final.poweredBy` in HE + EN
  (`apps/play-web/src/i18n.ts:295-296, :851-852`) — so no new i18n keys.
- NOT touched: `packages/shared/src/freeMode.ts`, the callable layer, referral/wallet logic.
