## Why

A creator's first launch of a new course is a leap of faith: the only way to walk
the route, test GPS radii, and sanity-check task flow is to burn a real Event
Credit (or a lifetime free run) on what is really a rehearsal. Competitors ship a
"preview/test event" mode. RushPoint can add one with zero new billing machinery:
`launchRun` already resolves billing through the pure `resolveLaunchBilling`
helper (`packages/shared/src/freeMode.ts`) and already fixes `maxParticipants` at
launch — a test drive is just a third short-circuit in that decision plus a flag
on the run doc.

## What Changes

- **`launchRun` gains `testDrive?: boolean`.** When true: **no billing at all** —
  no credit decrement, no `lifetimeFreeRunsUsed` increment, no Pro requirement,
  wallet never read or written. The run doc gets `isTestDrive: true`,
  `billingType: 'test'`, and `maxParticipants` **forced to 2** (creator + one
  companion phone). Everything else is a real run — join code, routing, scoring,
  staff, live ops — so the walkthrough is faithful.
- **Abuse guard:** at most **one live (not finished) test-drive run per game**.
  Launching a second throws `failed-precondition` telling the creator to finalize
  the first. Enforced inside the launch transaction (test-drive launches always
  use a transaction, even in free mode where paid launches use a batch).
- **Aggregate hygiene:** `finalizeRun`'s platform-benchmark contribution
  (`benchmarks/{taskType}`), the player-profile/badges fold
  (`recordPlayerResult`), and the best-effort `game.playCount` increment all
  **skip** test runs — a rehearsal must not pollute cross-run aggregates.
  `getRunAnalytics` / `getRunRecap` / `getPublicLeaderboard` still work but
  return `isTestDrive` so their UIs label/watermark the data ("test run").
- **play-web:** `getJoinInfo` surfaces `isTestDrive`; PlayScreen shows a
  persistent "TEST RUN" banner chip while playing a test run (same raised-banner
  pattern as the viewer-mode banner). i18n EN+HE.
- **creator-web:** a secondary "Launch test run" action next to the real launch
  button (BuilderPage header + DashboardPage game card) and a "Test" badge in the
  RunConsole billing-badge slot. i18n EN+HE.

## Capabilities

### New Capabilities
- `test-drive-mode`: the `testDrive` branch of `resolveLaunchBilling` (pure,
  vitest-tested); free + capped launch path with the one-live-test-run guard;
  `Run.isTestDrive` / `billingType: 'test'`; aggregate exclusions; join-info flag;
  play-web banner; creator-web launch action + badges.

## Non-goals

- **No new callable** — the flag rides `launchRun`; the e2e coverage-guard list
  is unchanged.
- No time limit or auto-expiry on test runs, and no restriction on task types —
  fidelity is the point.
- No separate test access-code namespace (normal `accessCodes/{CODE}` doc).
- No analytics UI filtering beyond the benchmark/profile/playCount exclusions and
  the `isTestDrive` badge labeling; public leaderboard/publish stays allowed,
  just watermarked.
- No creator-tunable participant cap (constant: 2).

## Surfaces touched

- **shared:** `resolveLaunchBilling` testDrive branch + `TEST_DRIVE_MAX_PARTICIPANTS`
  (`packages/shared/src/freeMode.ts`); `Run.isTestDrive?` + `billingType` union
  gains `'test'` (`packages/shared/src/types/index.ts`).
- **functions:** `launchRun`, `joinRun` full-message, `getJoinInfo`, `finalizeRun`
  (benchmark + profile skips), `getRunAnalytics`/`getRunRecap`/
  `getPublicLeaderboard` passthrough — all in `functions/src/runs/index.ts`.
- **creator-web:** `services/calls.ts` wrapper; `BuilderPage.tsx` +
  `DashboardPage.tsx` secondary launch action; `RunConsolePage.tsx` badge; i18n EN/HE.
- **play-web:** `services/calls.ts` `getJoinInfo` type; `PlayScreen.tsx` banner;
  i18n EN/HE.
- **Tests:** vitest cases for the `resolveLaunchBilling` testDrive branch; a new
  `test-drive` e2e scenario in `scripts/e2e-verify.mjs` (wallet unchanged, cap 2,
  duplicate-live-test rejection, join-info flag, finalize-then-relaunch).
