## 1. RED — pin the queue view before it exists

- [x] 1.1 Write `apps/creator-web/src/lib/__tests__/photoReviewQueue.test.ts` against the not-yet-existing
      `../photoReviewQueue`, covering: empty queue, single item, ties on submission time, missing /
      empty / unparsable / `NaN` / future timestamps, an item whose team already finished, an
      already-reviewed item and the same item appearing twice (idempotence and exclusion), ordering
      stability under input shuffling and re-application, `decideReview` idempotence for every
      (status, action) pair, `moveFocus` totality, and the failure map.
- [x] 1.2 Run `npx vitest run src/lib/__tests__/photoReviewQueue.test.ts` in `apps/creator-web` and
      record the RED output verbatim in the report.

## 2. GREEN — the pure module

- [x] 2.1 Create `apps/creator-web/src/lib/photoReviewQueue.ts` exporting `WAIT_WARN_MS`,
      `WAIT_OVERDUE_MS`, `WaitTier`, `ReviewQueueItem`, `buildReviewQueueView`, `decideReview`,
      `moveFocus`, `recordFailure`, `clearFailure`.
- [x] 2.2 Implement wait computation as a total function: unusable input yields `null`, elapsed time is
      clamped at zero, tier never escalates on an unknown wait.
- [x] 2.3 Implement de-duplication by stable key and exclusion of non-pending rows.
- [x] 2.4 Implement the total, stable comparator: unfinished before finished, longer wait first, known
      wait before unknown, then key ascending.
- [x] 2.5 Implement `decideReview` on top of the shared `photoQueue` transition table, refusing
      approve-after-approve, reject-after-approve and reject-after-reject.
- [x] 2.6 Re-run the suite until green.

## 3. GREEN — copy

- [x] 3.1 Add the Hebrew keys to `apps/creator-web/src/i18n.ts`: waiting duration, overdue tag, unknown
      submission time, finished-team tag, per-row failure naming the team, retry, keyboard hint.
- [x] 3.2 Add the matching English keys. Natural Hebrew, no em-dashes, no transliteration.

## 4. GREEN — the panel

- [x] 4.1 Re-read `RunConsolePage.tsx` immediately before editing (a live-task-pause lane is active in
      this file). Confine the diff to `PhotoReviewConsole` and its call site.
- [x] 4.2 Pass the finished team ids and a live `nowMs` tick into the panel; build the view with
      `buildReviewQueueView`.
- [x] 4.3 Render the wait duration and tier per card, plus the finished-team tag, using `dir="auto"` on
      team names and static Tailwind classes with logical RTL properties.
- [x] 4.4 Gate every review through `decideReview`; on failure record a per-row failure and render it
      on the card with a retry control; clear it on success.
- [x] 4.5 Add the queue-scoped keyboard handler (`J` / `K` / `A` / `R`) with a roving `tabIndex` and an
      on-screen hint. No `document`-level listener.

## 5. GREEN — the builder hint

- [x] 5.1 Re-read `TaskWizard.tsx` immediately before editing (a pause-clock lane is active in the
      builder). Add one hint line under the existing `autoApprove` checkbox stating what leaving it
      off costs during the run. Do not change the default.

## 6. REFACTOR and gates

- [x] 6.1 Re-read the module for dead exports and duplicated wait logic; keep the thresholds as named
      exported constants referenced by the tests.
- [x] 6.2 `npm run typecheck`
- [x] 6.3 `npm run lint`
- [x] 6.4 `npm test`
- [x] 6.5 `npm run creator:build`
- [x] 6.6 `npm run play:build`
- [x] 6.7 `npm run bundle:budget`
- [x] 6.8 `npm run i18n:check:strict`
- [x] 6.9 `npx openspec validate photo-review-throughput --strict`
- [x] 6.10 Report the e2e assertions from design.md that were not written, since the e2e script is
      owned elsewhere this session.
