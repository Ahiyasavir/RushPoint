## 1. Shared reducer — RED then GREEN (pure logic, TDD)

- [x] 1.1 RED: `scripts/test-feed-reactions.ts` asserting `applyReaction` (invalid emoji throws; first reaction increments + records `reactedBy`; same-emoji repeat is a no-op `changed:false`; emoji switch decrements old / increments new / drops zero keys / never negative; independent uids accumulate) and `FEED_EMOJIS` has exactly 4 entries. Confirm it fails (module missing).
- [x] 1.2 GREEN: implement `applyReaction` + `FEED_EMOJIS` in `packages/shared/src/feedReactions.ts`; export from `@rushpoint/shared`. `npm test` → 1.1 passes.

## 2. Shared types + paths + rate budget
- [x] 2.1 Add `FeedItem` interface + `Game.photoFeedEnabled?` (doc comments) and `FIRESTORE_PATHS.feedItem` / `feedItemsCol` in `packages/shared/src/types/index.ts`; add `reactToFeedItem: { max: 60, windowMs: MIN }` to `RATE_LIMITS` in `packages/shared/src/rateLimit.ts`. `npm run typecheck`.

## 3. Rules
- [x] 3.1 `firestore.rules`: `match /feedItems/{docId} { allow read: if isAuthenticated(); allow write: if false; }` next to `announcements`, with a comment that the `photoFeedEnabled` gate is write-side.

## 4. Server — feed writes + callables (functions)
- [x] 4.1 `submitStationPhoto` autoApprove path: after `completeTaskForTeam`, write the feed item (task title from the already-fetched game snap; `teamName` from the team doc; skip when `photoFeedEnabled === false`). Best-effort — a feed failure never fails the submission.
- [x] 4.2 `reviewStationSubmission` approve path: same write (adds a game-doc read for the title + gate).
- [x] 4.3 New callable `reactToFeedItem` (auth → rate limit → run-membership via `resolveCallerTeam` with staff/owner fallback → transaction around `applyReaction`; `not-found` for missing/hidden item, `invalid-argument` for a non-`FEED_EMOJIS` emoji). Re-export from `functions/src/index.ts`.
- [x] 4.4 New callable `hideFeedItem` (`assertStaffOrOwner`; sets `active:false`, `hiddenAt`, `hiddenBy`). Re-export.
- [x] 4.5 `updateGame` accepts `photoFeedEnabled` (mirror `allowInstantPlay`).
- [x] 4.6 `pruneRunPII` deletes the `feedItems` subcollection (add to the `deleteDocsInChunks` batch). `npm run typecheck`.

## 5. e2e — scenario + coverage
- [x] 5.1 Typed wrappers: `reactToFeedItem` in `apps/play-web/src/services/calls.ts`; `hideFeedItem` in both apps' `services/calls.ts`.
- [x] 5.2 New `live photo feed` scenario in `scripts/e2e-verify.mjs`: item written on autoApprove AND on staff approve; dedup/switch reaction semantics; invalid-emoji + stranger + participant-hide denials; owner hide works; `photoFeedEnabled:false` writes nothing; `pruneRunNow` removes items. Coverage guard: both new callables invoked.
- [ ] 5.3 `npm run e2e` — green (batch gate).

## 6. play-web — Feed panel
- [x] 6.1 Lazy `FeedPanel.tsx` (active-only snapshot listener, newest-first, emoji buttons with counts + own-reaction highlight, optimistic tap → `reactToFeedItem`); "Feed" toggle in `PlayScreen.tsx`, hidden when the game disables the feed.
- [x] 6.2 Staff hide affordance in `StaffConsole.tsx`.
- [x] 6.3 play-web i18n keys (`feedTitle`, `feedEmpty`, `feedHidden`) EN + HE.

## 7. creator-web — toggle + hide
- [x] 7.1 Builder settings checkbox for `photoFeedEnabled` (`BuilderPage.tsx`, default on).
- [x] 7.2 RunConsole feed list with hide buttons (`RunConsolePage.tsx`).
- [x] 7.3 creator-web i18n keys (`photoFeedLabel`, `photoFeedHint`, `feedHideAction`) EN + HE.

## 8. Gates
- [x] 8.1 `npm run typecheck`
- [x] 8.2 `npm run lint`
- [x] 8.3 `npm test`
- [x] 8.4 `npm run creator:build` + `npm run play:build`
- [ ] 8.5 `npm run e2e`
- [x] 8.6 `npm run i18n:check` (clean; `:strict` for the new panel)
