> **TDD order is mandatory.** Every group below starts with a RED task (a failing test that encodes
> the new behavior, run and confirmed failing *for the right reason*), then the minimum code to go
> GREEN, then REFACTOR. Groups 1–4 (shared + backend) must land before groups 5–7 (UI), which depend
> on the shared helpers, the types, and the callable.

## 1. Shared: `applyReport` reducer (pure lane)

- [x] 1.1 RED: write `scripts/test-feed-reports.ts` (mirror `scripts/test-feed-reactions.ts`)
  importing `applyReport`, `FEED_REPORT_REASONS`, `FEED_AUTO_HIDE_REPORTS` from
  `@rushpoint/shared`. Assert: first report → `reportCount === 1`, `reportedBy[uid] === reason`,
  `active` still true; same uid again with the same reason → `changed === false`, count unchanged;
  same uid with a **different** valid reason → reason updated, count unchanged; a **second distinct**
  uid → `hidden === true`, `active === false`, `hiddenBy === 'auto:reports'`, `hiddenAt` set; a third
  report on the already-hidden item → no error, `hidden === false`, still inactive;
  `reportsCleared: true` at/above the threshold → stays `active: true` while the count still rises;
  an invalid reason **throws**; the input object is deep-equal unchanged after the call. Run
  `npm test` and confirm it FAILS (module missing).
- [x] 1.2 GREEN: add `packages/shared/src/feedReports.ts` — `FEED_REPORT_REASONS`
  (`'inappropriate' | 'harassment' | 'privacy' | 'other'`), `FeedReportReason`,
  `FEED_AUTO_HIDE_REPORTS = 2`, `FeedReportState`, `FeedReportResult`, and the pure
  `applyReport(item, uid, reason, now?)` per design D2 (clone before write, recompute
  `reportCount` from `Object.keys(reportedBy).length`, never mutate, throw on bad reason, injected
  `now` for determinism). Export it from `packages/shared/src/index.ts`. Re-run `npm test` → green.
- [x] 1.3 Add the three additive optional fields to `FeedItem` in
  `packages/shared/src/types/index.ts` (~L1007): `reportedBy?: Record<string, string>`,
  `reportCount?: number`, `reportsCleared?: boolean`, each with a comment naming this change.
  `npm run typecheck` green.
- [x] 1.4 REFACTOR: confirm `feedReports.ts` shares the doc-comment/style shape of
  `feedReactions.ts` (closed constant set, narrow state interface, `changed` flag) and that no
  reducer logic leaked into the (not-yet-written) callable. No behavior change; `npm test` still green.

## 2. Shared: `feedMute` helpers (pure lane)

- [x] 2.1 RED: write `scripts/test-feed-mute.ts` asserting `addMutedItem`/`addMutedTeam` return new
  immutable, deduped, order-stable state; `isFeedItemMuted` matches by item id **and** by team id;
  `parseFeedMute(null)` and `parseFeedMute('{{not json')` return the empty state without throwing;
  `serializeFeedMute` → `parseFeedMute` round-trips. Run `npm test` → FAILS.
- [x] 2.2 GREEN: add `packages/shared/src/feedMute.ts` (`FeedMuteState`, `EMPTY_FEED_MUTE`,
  `addMutedItem`, `addMutedTeam`, `isFeedItemMuted`, `parseFeedMute`, `serializeFeedMute`) per
  design D3 — pure, no `localStorage` access inside shared (persistence lives in play-web). Export
  from `packages/shared/src/index.ts`. `npm test` → green.
- [x] 2.3 REFACTOR: keep the module free of any React/DOM/Firestore import so it stays in the
  no-emulator lane. `npm run typecheck` green.

## 3. Backend: `reportFeedItem` callable

- [x] 3.1 RED: extend the feed scenario in `scripts/e2e-verify.mjs` (around L1948–L2080) with
  assertions for `reportFeedItem`: participant report → `{ ok: true, reportCount: 1 }` and the doc
  still `active === true`; the same participant reporting again → count still 1; an invalid reason →
  `invalid-argument`; a stranger → denied; a **second distinct** participant → `hidden === true`,
  doc `active === false`, `hiddenBy === 'auto:reports'`, and a follow-up `reactToFeedItem` on it is
  rejected `not-found`. Run `npm run e2e` and confirm these FAIL (callable does not exist) — the
  **callable coverage guard** will also be red for `reportFeedItem`.
- [x] 3.2 Add `reportFeedItem: { max: 20, windowMs: MIN }` to `packages/shared/src/rateLimit.ts`
  (just below the `reactToFeedItem` entry, ~L81), with a comment on why it is lower than reactions.
- [x] 3.3 GREEN: implement `reportFeedItem` in `functions/src/index.ts` next to `reactToFeedItem`
  (~L719) per design D1: `requireAuth` → `enforceRateLimit(uid, 'reportFeedItem')` → required-arg
  validation → reason validation against `FEED_REPORT_REASONS` → membership via `resolveCallerTeam`
  falling back to `assertStaffOrOwner` → `db.runTransaction` on
  `FIRESTORE_PATHS.feedItem(...)` (`not-found` only when the doc is missing — an **inactive** item
  still accepts reports) → `applyReport` → `tx.update` with **whole nested maps** (never dotted
  `.set({merge})` keys, never a dotted array update) → return `{ ok: true, reportCount, hidden }`.
  Re-run `npm run e2e` → the new assertions and the coverage guard go green.
- [x] 3.4 Add the typed `reportFeedItem` wrapper to `apps/play-web/src/services/calls.ts` alongside
  the existing feed wrappers. `npm run typecheck` green.
- [x] 3.5 Add `reportFeedItem` to the table-driven **authorization denial matrix** in
  `scripts/e2e-verify.mjs` (~L5577): participant → **allowed**; stranger and other-run staff →
  **denied**. `npm run e2e` green.
- [x] 3.6 REFACTOR: de-duplicate the membership-resolution snippet shared by `reactToFeedItem` and
  `reportFeedItem` into a small local helper (e.g. `assertRunMemberOrStaff`) if it reads cleanly —
  authz semantics must be **identical** before and after; otherwise leave both explicit and note why.
  `npm run e2e` still green.

## 4. Backend: `hideFeedItem` restore

- [x] 4.1 RED: add e2e assertions — a **participant** calling `hideFeedItem({ restore: true })` is
  **denied**; the **owner** calling it on an auto-hidden item makes it `active === true` with
  `hiddenAt`/`hiddenBy` cleared and `reportsCleared === true`; a **third** distinct reporter
  afterwards does **not** re-hide it (`hidden === false`, `active === true`) while `reportCount`
  still climbs. Run `npm run e2e` → FAIL.
- [x] 4.2 GREEN: extend `hideFeedItem` (`functions/src/index.ts` ~L767) with an optional
  `restore?: boolean`, keeping `assertStaffOrOwner` as the **first** statement (before any branch).
  Restore path: `.update({ active: true, hiddenAt: FieldValue.delete(), hiddenBy:
  FieldValue.delete(), reportsCleared: true })`. Hide path unchanged. `npm run e2e` → green.
- [x] 4.3 REFACTOR: confirm `applyReport` honors `reportsCleared` exactly once (in the auto-hide
  branch only — reports must still be recorded and counted) and that the pure test from 1.1 covers
  it. `npm test` + `npm run e2e` green.

## 5. play-web: report + mute UI (depends on 1–4)

- [x] 5.1 Add all new play-web strings to **both** the `en` and `he` maps in
  `apps/play-web/src/i18n.ts` under `feed.*` — report action + confirm, the four reason labels,
  "reported / removed pending review" feedback, mute-team action + confirmation, unmute/undo if
  offered, and any `aria-label`. No hardcoded strings anywhere.
- [x] 5.2 In `apps/play-web/src/components/FeedPanel.tsx`, add a per-card **report** control that
  collects a reason from the closed set (existing dialog/sheet pattern) and calls the
  `reportFeedItem` wrapper. On choose, **optimistically** `addMutedItem` and persist **before/
  regardless of** the call resolving (design D3), so the reporter's suppression works offline.
- [x] 5.3 Wire the mute store: read/write `localStorage` under a run-scoped key
  (e.g. `rp.feedMute.<runId>`) via `parseFeedMute`/`serializeFeedMute`, hold it in React state, and
  filter the rendered list through `isFeedItemMuted` **after** the snapshot. No Firestore write.
- [x] 5.4 Add the per-card **"mute this team"** action (`addMutedTeam`), hiding all current and
  future items from that team on this device.
- [ ] 5.5 Verify with the preview tools on a live run: report → card disappears instantly for the
  reporter only; a second participant's report hides it for everyone; mute-team hides all that
  team's cards and survives a reload; the participant listener still filters `active == true`.

## 6. play-web: staff moderation view (depends on 4)

- [x] 6.1 Add the moderation strings to **both** `en` and `he` in `apps/play-web/src/i18n.ts`
  (hidden badge, report-count label, reason summary, restore action + confirm).
- [x] 6.2 In `FeedPanel`, when `moderate` is true, drop the `where('active', '==', true)` clause
  (rules already permit staff/owner to read hidden docs — **no** rules or index change), render
  hidden items visually distinct with a report-count badge, and add a **Restore** action calling
  `hideFeedItem({ ..., restore: true })`. The non-moderate listener is left **exactly** as-is.
- [ ] 6.3 Verify via the preview tools in the staff console (`?staff`): a hidden item is listed with
  its report count and restores successfully; the participant view is unchanged.

> **5.5 / 6.3 are the only open items in groups 5–6.** Code is complete and gate-green
> (typecheck · play:build · i18n:check · i18n:check:strict). Both are browser passes against a live
> run and are deliberately left unticked — they need the parent-owned emulator.

## 7. creator-web: legal clause + Builder disclosure

- [x] 7.1 Add the new live-photo-feed clause to **both** the Hebrew and English document bodies in
  `apps/creator-web/src/pages/LegalPage.tsx` per design D7 — upload prohibitions, run-wide
  visibility to all teams, any participant may report, reported content is removed pending review,
  organizer/RushPoint removal rights, and that mute is device-local team suppression (not
  identity-level blocking). Cross-reference §5.4 rather than replacing it.
- [x] 7.2 Add bilingual helper text under the `photoFeedEnabled` checkbox in
  `apps/creator-web/src/pages/BuilderPage.tsx` (~L472) — photos visible to every team in the run,
  organizer responsible for participant content. **Do not touch** the
  `checked={game.photoFeedEnabled !== false}` default expression.
- [x] 7.3 Add every new creator-web string to **both** the `en` and `he` maps in
  `apps/creator-web/src/i18n.ts`; nothing hardcoded in the components.

## 8. Gates

- [ ] 8.1 Run `npm run typecheck` · `npm run lint` · `npm test` · `npm run creator:build` ·
  `npm run play:build` — all green.
- [ ] 8.2 Run `npm run e2e` against a clean emulator — all scenarios green, including the new
  report/auto-hide/restore assertions, the authz matrix rows, and the **callable coverage guard**
  (`reportFeedItem` must be invoked by at least one scenario or the whole run fails).
- [ ] 8.3 Run `npm run i18n:check` (must be clean — PART A is a hard gate) and
  `npm run i18n:check:strict` (the new UI must add **zero** new PART B findings). Fix by routing
  text through `t.*`; use `// i18n-ignore` only for a deliberate non-switchable literal, with a reason.
- [ ] 8.4 Re-read the change against Google Play's UGC checklist and confirm all four limbs are
  demonstrably shipped: **report** (5.2), **block** (5.3/5.4), **moderation** (auto-hide + staff
  hide/restore, 3–4 and 6), **published policy** (7.1) — plus the creator disclosure (7.2).
