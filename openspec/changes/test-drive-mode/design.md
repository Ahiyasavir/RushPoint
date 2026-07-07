# Design — test-drive-mode

## Data model

**`Run.isTestDrive?: boolean`** and **`Run.billingType`** union gains `'test'`
(packages/shared/src/types/index.ts, `Run` interface — next to `selfGuided`,
which is the precedent for a "special launch" flag on the run doc). Absent on all
existing runs; every consumer treats absent as false.

## Pure billing seam (packages/shared/src/freeMode.ts)

`resolveLaunchBilling` already owns the pro > free-run > credit precedence.
Add a constant + a short-circuit FIRST branch (before the free-mode and pro
checks), so the decision stays a single pure function:

```ts
export const TEST_DRIVE_MAX_PARTICIPANTS = 2;

export function resolveLaunchBilling(
  paymentsEnabled: boolean,
  wallet: Partial<Wallet>,
  opts?: { testDrive?: boolean },
): LaunchBillingDecision {
  if (opts?.testDrive) {
    return { ok: true, billingType: 'test', maxParticipants: TEST_DRIVE_MAX_PARTICIPANTS, consume: 'none' };
  }
  // …existing free-mode / pro / free_run / credit branches unchanged…
}
```

`LaunchBillingDecision.billingType` union gains `'test'`. The testDrive branch
ignores the wallet entirely — no Pro requirement, nothing to consume — which is
exactly the vitest-provable contract (same decision for empty wallet, pro
wallet, and zero-credit wallet).

## Server — launchRun (functions/src/runs/index.ts)

`data` gains `testDrive?: boolean` (`const { gameId, testDrive } = data`).
Existing validation (owner, ≥1 stage) unchanged; `buildRun` gains the flag:

```ts
const buildRun = (billingType: Run['billingType'], maxParticipants: number): Run => ({
  id: runRef.id, gameId, ownerUid: uid, status: 'live', accessCode: code,
  billingType, maxParticipants, participantCount: 0,
  ...(testDrive ? { isTestDrive: true } : {}),
  launchedAt: now, createdAt: now, updatedAt: now,
});
```

**Branch order:** `if (testDrive) { … } else if (!PAYMENTS_ENABLED) { batch }
else { billing transaction }`. The testDrive branch is the SAME in both payment
modes and always a **transaction** (the free-mode batch has no read phase, and
the abuse guard needs one):

```ts
const decision = resolveLaunchBilling(PAYMENTS_ENABLED, {}, { testDrive: true }); // 'test', cap 2, consume none
await db.runTransaction(async (t) => {
  // Abuse guard: ≤1 live test-drive run per game. Equality-only query
  // (no '!=' → no composite index, txn-safe via t.get(Query)); the tiny
  // result set is status-filtered in code.
  const liveTests = await t.get(
    db.collection(`users/${uid}/games/${gameId}/runs`).where('isTestDrive', '==', true),
  );
  if (liveTests.docs.some((d) => (d.data() as Run).status !== 'finished')) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'A test run for this game is already live. Finalize it before launching another.',
    );
  }
  t.set(runRef, buildRun(decision.billingType, decision.maxParticipants));
  t.set(accessCodeRef, accessCode);
});
```

No wallet ref is read or written, no transaction doc created. The trailing
best-effort `game.playCount` increment is **skipped** when `testDrive` (a
rehearsal is not a play).

Serializable-txn note: two concurrent test launches both read the (empty) query
result; the write conflict on the runs collection is not guaranteed by Firestore
query-contention alone, but Admin-SDK transactions lock the query's result-set
range — the second commits after the first's run doc exists in that range and
retries into the `failed-precondition`. This is the same query-in-txn pattern
the station-contention guard already relies on; the e2e scenario asserts the
sequential case (launch #2 rejected), which is the abuse case that matters.

## Server — downstream seams (all in functions/src/runs/index.ts)

- **`joinRun`** — no code change to the cap check (it already reads
  `r.maxParticipants`, forced to 2). Only the full-run error copy: when
  `r.billingType === 'test'`, say the run is a 2-person test run rather than
  suggesting credits/Pro.
- **`getJoinInfo`** — add `isTestDrive: run?.isTestDrive ?? false` to the return
  (run doc is already fetched).
- **`finalizeRun`** — two skips, both one-line gates on already-in-scope docs:
  the player-profile fold (`recordPlayerResult` loop) and the platform-benchmark
  contribution become `if (!run.isTestDrive) { … }` /
  `if (!game.benchmarkOptOut && !run.isTestDrive) { … }`. Rankings, scoring, and
  the leaderboard itself are computed normally — the walkthrough must exercise
  the real pipeline.
- **`getRunAnalytics` / `getRunRecap` / `getPublicLeaderboard`** — no gating
  change (owner tools + published gate behave as today); each return object
  gains `isTestDrive: run?.isTestDrive ?? false` so UIs can watermark. Minimal
  correct seam: aggregates that OUTLIVE the run (benchmarks, player profiles,
  playCount) are excluded at write time; per-run read surfaces are labeled, not
  blocked.

## UI

- **creator-web** (`services/calls.ts`): `launchRun` wrapper param type becomes
  `{ gameId: string; testDrive?: boolean }`.
  - `BuilderPage.tsx`: next to the existing launch button in the shell header, a
    secondary (ghost/outline) "Launch test run" button → same `saveAndLaunch`
    path with `testDrive: true` (same save-first + empty-stage guards; billing
    upsell branch is unreachable for test launches — `failed-precondition` copy
    surfaces via the plain alert).
  - `DashboardPage.tsx`: same secondary action on the game card next to launch
    (`launch(g, { testDrive: true })`).
  - `RunConsolePage.tsx`: the billing `Badge` switch (~line 113) gains the
    `'test'` case — amber `Badge` with `t.runConsole.testRun`; participants line
    already shows the 2-cap for free.
  - i18n: `launchTestRun`, `testRun` (+ a one-line hint) EN + HE.
- **play-web** (`services/calls.ts`): `getJoinInfo` result type gains
  `isTestDrive: boolean`; stash it in the session (`store.ts`) at join like the
  other join-info fields.
  - `PlayScreen.tsx`: while the session's run `isTestDrive`, render a persistent
    chip-banner above the task area — same pattern as the viewer-mode banner
    (`dir="auto" rounded-lg bg-app-raised border border-glass-border`, static
    Tailwind, amber accent): "🧪 TEST RUN — nothing here counts".
  - i18n: `testRunBanner` EN + HE.

## Test strategy

- **Pure (TDD RED→GREEN):** extend the freeMode/billing vitest (or
  `scripts/test-*` lane if that is where `resolveLaunchBilling` cases live —
  co-locate with the existing ones): testDrive branch returns
  `{ok: true, billingType: 'test', maxParticipants: 2, consume: 'none'}` for
  (a) payments off + empty wallet, (b) payments on + zero-credit free wallet,
  (c) payments on + active-pro wallet — i.e. wallet-independent; and
  `testDrive` absent/false leaves every existing decision byte-identical.
- **Callable (e2e):** new `test-drive` scenario in `scripts/e2e-verify.mjs`
  (no new callable → coverage-guard list unchanged):
  1. Snapshot `getWallet` → `launchRun({ gameId, testDrive: true })` → assert
     **wallet unchanged** (eventCredits, lifetimeFreeRunsUsed, no new
     transaction doc) and run doc/`getJoinInfo` show `billingType 'test'`.
  2. **`isTestDrive: true` visible in `getJoinInfo`** for the access code.
  3. Join with 2 anon users OK; **3rd join rejected** (`resource-exhausted`,
     cap 2).
  4. **Second `launchRun({ testDrive: true })` for the same game rejected**
     with `failed-precondition` (message mentions finalizing); a NORMAL launch
     of the same game still succeeds (guard is test-drive-scoped).
  5. Play a task, `finalizeRun` works; assert `benchmarks/{taskType}` docs are
     byte-unchanged by the test run and `players/{uid}` was not written; **a new
     test-drive launch now succeeds** (guard cleared by `finished`).
  Sanitizer allowlist untouched (no new Task fields).
- **UI:** preview the banner + badges; `npm run i18n:check` clean (zero new
  PART B warnings).

## Footguns respected

- Test-drive launch NEVER touches the wallet — not even a read — so a wallet
  rules/latency issue can't fail a rehearsal.
- Guard query is equality-only (`isTestDrive == true`) with in-code status
  filtering: no composite index, no `!=`-in-transaction edge cases.
- `buildRun` spread keeps `isTestDrive` off non-test run docs entirely (no
  `isTestDrive: false` noise on every run).
- No new transaction on any hot participant path — `joinRun`/`completeTask`
  are untouched except error copy.
- Static Tailwind classes for the banner/badge; `t.*` for all copy.
