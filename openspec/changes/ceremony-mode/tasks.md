## 1. Shared selector + sequence machine — RED then GREEN (pure logic, TDD)

- [x] 1.1 RED: `scripts/test-ceremony.ts` asserting `pickCeremonyFeed` (drops `active:false`; total-reactions desc; createdAt-asc tie-break; caps at `CEREMONY_FEED_CAP`=20; empty ⇒ []; output shape has ONLY taskTitle/teamName/photoUrl/totalReactions) and the phase machine (`ceremonyStart` for feed=0 / teams 0·1·2·3+; `ceremonyNext` full transition table; `standings` terminal). Confirm it fails.
- [x] 1.2 GREEN: implement `pickCeremonyFeed`, `ceremonyStart`, `ceremonyNext`, `CeremonyFeedItem`, `CEREMONY_FEED_CAP` in `packages/shared/src/ceremony.ts`; export from `@rushpoint/shared`. `npm test` → 1.1 passes.

## 2. Server — extend getPublicLeaderboard
- [x] 2.1 `functions/src/runs/index.ts` `getPublicLeaderboard`: when `published`, read the run's `feedItems` (Admin SDK, via FIRESTORE_PATHS) and return `ceremonyFeed: pickCeremonyFeed(...)`; `[]` when unpublished or the subcollection is absent. `npm run typecheck`.
- [x] 2.2 `apps/play-web/src/services/calls.ts`: add `ceremonyFeed: CeremonyFeedItem[]` to the `PublicLeaderboard` result type.

## 3. e2e — extend existing assertions (no new callable)
- [x] 3.1 In `scripts/e2e-verify.mjs`, extend the public-leaderboard assertions: pre-publish `ceremonyFeed` is `[]`; post-publish it is present, capped, `totalReactions`-desc sorted, excludes hidden items, and leaks no `reactedBy`/`active`/uid fields. (Runs against the `live photo feed` scenario's run where items exist.)
- [ ] 3.2 `npm run e2e` — green (coverage-guard list unchanged; batch gate).

## 4. play-web — CeremonyScreen
- [x] 4.1 `App.tsx`: `?board=<code>&ceremony` → lazy `CeremonyScreen` (existing `?board` state + a `ceremony` boolean).
- [x] 4.2 `screens/CeremonyScreen.tsx`: not-published holding screen + 12s re-poll; slideshow phase (4s/photo, CSS Ken-Burns, `dir="auto"` captions); podium reveal 3rd→2nd→1st (CSS keyframes); standings table (TvLeaderboard-style medals/fmtTime); tap-to-advance.
- [x] 4.3 Confetti canvas (RAF particles, branding palette, ~8s, cancel on unmount) fired on the `podium1` phase. No new dependencies.
- [x] 4.4 play-web i18n keys (`ceremonyWaiting`, `ceremonyChampion`, `ceremonyStandings`) EN + HE.

## 5. creator-web — share hint
- [x] 5.1 `RunConsolePage.tsx`: board-share row gains a "ceremony link" copy variant appending `&ceremony`; i18n key (`ceremonyLinkLabel`) EN + HE.

## 6. Gates
- [x] 6.1 `npm run typecheck`
- [x] 6.2 `npm run lint`
- [x] 6.3 `npm test`
- [x] 6.4 `npm run creator:build` + `npm run play:build`
- [ ] 6.5 `npm run e2e`
- [x] 6.6 `npm run i18n:check` (clean; `:strict` for the new screen)
