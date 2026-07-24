## 1. Decouple the CTA from PAYMENTS_ENABLED

- [x] 1.1 In `apps/play-web/src/screens/FinalScreen.tsx`, change the footer render condition from
      `PAYMENTS_ENABLED && run.billingType !== 'pro'` to `run.billingType !== 'pro'`.
- [x] 1.2 Compute the href conditionally so the referral tag stays payments-gated:
      `const href = PAYMENTS_ENABLED ? `${creatorUrl()}/?ref=${team.ownerUid}` : creatorUrl();` and
      use it in the anchor's `href`.
- [x] 1.3 Leave the visible copy (`t.final.poweredBy`, `t.final.buildOwn`) and styling unchanged.

## 2. Gates

- [x] 2.1 `npm run typecheck` — green.
- [x] 2.2 `npm run lint` — 0 errors.
- [x] 2.3 `npm run i18n:check:strict` — clean, zero new PART B warnings (no new strings added).
- [x] 2.4 `npm run play:build` and `npm run creator:build` — green.
- [x] 2.5 Flag the manual browser check (not a gate): with `PAYMENTS_ENABLED = false`, a finished run
      shows the "Build your own field game" CTA linking to the creator app with no `?ref`; a
      `billingType:'pro'` run shows no CTA; with payments on, the `?ref=<ownerUid>` link is unchanged.
