## 1. RED — failing test first

- [x] 1.1 Create `apps/creator-web/src/lib/__tests__/callFeedback.test.ts` (vitest, node env — picked
      up by the existing `apps/creator-web/vitest.config.ts` `src/**/*.test.ts` include, and so by
      `turbo run test` inside `npm test`). It imports `describeCallFailure` and `CALL_FAILURE_KEYS`
      from `../callFeedback`, and the real `translations` map from `../../i18n`.
- [x] 1.2 Encode the code table from the design's D2: `permission-denied` / `unauthenticated` →
      `notAllowed`, severity `error`, not retryable; `failed-precondition` / `invalid-argument` /
      `not-found` / `already-exists` / `out-of-range` → `rejected`, `error`, not retryable;
      `deadline-exceeded` / `unavailable` / `internal` / `aborted` / `cancelled` → `offline`,
      `warning`, retryable; `resource-exhausted` → `rateLimited`, `warning`, retryable.
- [x] 1.3 Encode prefix equivalence: `{ code: 'functions/permission-denied' }` classifies identically
      to `{ code: 'permission-denied' }`.
- [x] 1.4 Encode the offline hint: a bare `TypeError` with `{ online: false }` → `offline`; the same
      error with `{ online: true }` → `generic`; `{ code: 'unavailable' }` with `{ online: true }` →
      `offline` (a real code beats the hint).
- [x] 1.5 Encode totality on hostile input — unknown code `'teapot'`, `{ nope: 1 }`, a plain `Error`,
      a thrown string, a thrown number, `null`, `undefined`, and a non-string `code`. None throws;
      each yields a key in `CALL_FAILURE_KEYS`.
- [x] 1.6 Encode the actionability invariant as a loop over `CALL_FAILURE_KEYS` against BOTH `he` and
      `en`: the entry exists and is non-empty; the Hebrew entry contains a Hebrew letter and the
      English entry contains none; and no entry contains `'functions/'`, a hyphenated Firebase code,
      or the words `Firebase` / `Error`.
- [x] 1.7 Encode `retryable === false` for exactly `notAllowed` and `rejected`.
- [x] 1.8 Run `npx vitest run src/lib/__tests__/callFeedback.test.ts` from `apps/creator-web` and
      confirm it FAILS for the right reason (`callFeedback` does not exist yet). Record the output
      verbatim in the report.

## 2. GREEN — the pure classifier and its copy

- [x] 2.1 Add `apps/creator-web/src/lib/callFeedback.ts`: `CallFailureKey`, `CALL_FAILURE_KEYS`,
      `CallFailure`, and the total `describeCallFailure(e, opts?)`. Read `code` only, strip a
      `functions/` prefix, apply the D2 table, then the `online === false` fallback, then `generic`.
      Do NOT modify `lib/callErrors.ts`.
- [x] 2.2 Add the `callFailure` group to BOTH dictionaries in `apps/creator-web/src/i18n.ts` — keys
      `offline`, `notAllowed`, `rateLimited`, `rejected`, `generic` — Hebrew written as Hebrew in
      the console's existing tone, English as English. Each says what happened AND what to do.
- [x] 2.3 Re-run the vitest file and confirm GREEN. Record the output verbatim.

## 3. GREEN — Builder: a failed save is not a pending save

- [x] 3.1 In `apps/creator-web/src/pages/BuilderPage.tsx`, widen `SaveStatus` with `'failed'` and add
      a `saveError: CallFailure | null` state.
- [x] 3.2 In `save()`, catch the rejection: `console.error` the original, set `status = 'failed'` and
      `saveError = describeCallFailure(e, { online: navigator.onLine })`. On success clear
      `saveError` and keep the existing saved/unsaved resolution.
- [x] 3.3 Render the failed state in the header indicator: a red dot and a distinct label
      (`b.saveFailedShort`), never the pending amber/`b.unsaved` pair.
- [x] 3.4 Render the persistent banner strip under the header: the reason from `t.callFailure[key]`,
      plus a Retry button rendered ONLY when `saveError.retryable`, calling `save()` directly. No
      auto-dismiss. Static Tailwind classes, logical `ms-`/`me-`/`text-start`, `role="status"`.
- [x] 3.5 Add `saveFailedShort`, `saveFailedRetry` and the banner title to both dictionaries.

## 4. GREEN — Run console: every confirmed site speaks

- [x] 4.1 `adjustScore` (`:411-424`): wrap in try/catch — `toast.error(t.callFailure[…])` on failure,
      `toast.success(rc.adjustScoreApplied)` on success, and keep `loadTeams()` on the success path.
- [x] 4.2 `refreshStandings` (`:323-327`): add the catch, and a success toast so the refresh button
      is no longer indistinguishable from a no-op.
- [x] 4.3 `FeedConsole.hide` (`:1434-1437`): replace `.catch(() => undefined)` with a real catch +
      toast.
- [x] 4.4 `ChatHQ.reply` (`:1517-1523`): toast the failure; keep the draft for the retry (that part
      is already right).
- [x] 4.5 `HotZonePanel.activate` / `deactivate` (`:1004-1014`): add catches + toasts.
- [x] 4.6 `TrackablesConsole.create` (`:1167-1171`) and `ZonesConsole.create` / `remove`
      (`:1218-1228`): add catches + toasts; only clear the input on success.
- [x] 4.7 `ack` (`:328-330`): replace the empty catch with a toast — an SOS acknowledgement is not a
      place for an unexplained non-event.
- [x] 4.8 Add the two new run-console strings (`adjustScoreApplied`, `standingsRefreshed`) to both
      dictionaries.

## 5. REFACTOR & gates

- [x] 5.1 Re-read every touched file immediately before the final edit pass (a parallel lane may be
      editing `BuilderPage`/`TaskWizard`/`GalleryPage`); keep diffs tightly scoped and report any
      overlap rather than reverting another lane.
- [x] 5.2 `npm run typecheck` — green.
- [x] 5.3 `npm run lint` — 0 errors.
- [x] 5.4 `npm test` — green (both lanes; `scripts/test-failure-visibility.ts` must still pass,
      proving `callErrors.ts` was not disturbed).
- [x] 5.5 `npm run creator:build` and `npm run play:build` — green.
- [x] 5.6 `npm run i18n:check` AND `npm run i18n:check:strict` — PART A clean, PART B still zero.
- [x] 5.7 `npm run bundle:budget` — within budget (this change adds no dependency).
- [x] 5.8 Do NOT run emulator-bound gates (`e2e`, `verify:emulator`, `test:rules`, `simulate`) — a
      live playtest stack owns the ports. Record that the browser verification of the Builder banner
      is therefore unverified in this session.
