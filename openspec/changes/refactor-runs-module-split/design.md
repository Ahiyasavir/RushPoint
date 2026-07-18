## Context

`functions/src/runs/index.ts` is 2,972 lines. It already sits in a directory that follows a
modular convention — `sanitizeTask.ts`, `teamDevices.ts`, `feedbackSummary.ts`, and
`leaderboardThrottle.ts` are focused single-purpose modules with co-located `*.test.ts` files
— but the bulk of the run domain never got split out and accreted into one file spanning eight
domains.

Concrete anchors verified against the current source:

- **Callables + internal helpers in `runs/index.ts`** (line numbers as of this proposal):
  `launchRun` (161), `getJoinInfo` (281), `joinRun` (317), `startTeams` (428),
  `requestGuardianConsent` (483), `grantGuardianConsent` (501), `completeTaskForTeam` (533,
  internal), `recordPlayerResult` (789, internal), `skipStage` (811),
  `buildRankings` (891, internal-but-exported), `maybeRefreshLeaderboardSnapshot` (971,
  internal-but-exported), `activateHotZone` (1021), `deactivateHotZone` (1060),
  `getRunDiscoveryPois` (1083), `claimDiscoveryPoi` (1096), `finalizeRun` (1158),
  `refreshLeaderboard` (1272), `getPublicLeaderboard` (1322), `getRunRecap` (1378),
  `getRunReplay` (1418), `getRunAnalytics` (1451), `getRunHeatmap` (1486),
  `getMyProfile` (1526), `startInstantPlay` (1539), `createTrackable` (1599),
  `getRunTrackables` (1624), `transferTrackable` (1636, internal), `pickUpTrackable` (1670),
  `dropTrackable` (1673), `createZone` (1682), `deleteZone` (1708), `getRunZones` (1721),
  `captureZone` (1732), `listRunTeams` (1767), `resolveTeamContext` (1813, internal),
  `resolveCallerTeam` (1835, internal-but-exported), `joinTeamAsDevice` (1862),
  `transferController` (1945), `claimController` (1968), `computeStageUnlock` (2000, internal),
  `sweepExpiredInFlight` (2031, internal), `assignNextInActiveStage` (2079, internal),
  `completeTask` (2184), `requestNextTask` (2250), `requestTaskHint` (2270),
  `findGameTask` (2329, internal), `assertTaskNotExpired` (2340, internal),
  `submitTaskAnswer` (2356), `submitSequenceStep` (2461), `getRecommendedTasks` (2512),
  `getMyTeamState` (2551), `listLiveRuns` (2718), `checkOutTask` (2760),
  `submitRunFeedback` (2782), `getRunFeedbackSummary` (2826), `getRunSurveyResults` (2880).
  Plus module-local helpers `requireAuth` (100), `gamePath`/`runPath`/`teamPath`/`teamsCol`
  (105–116), `generateCode` (120), `uniqueCode` (128), `buildInitialStages` (139),
  `feedbackCol` (2778).

- **The duplicated stage-completion block.** In `completeTaskForTeam` at **lines 704–743**:
  compute `completedCount`, `required = min(requiredTaskCount ?? tasks.length, tasks.length)`,
  `allTerminal`, `stageDone = completedCount >= required || allTerminal`; on `stageDone`,
  auto-skip every non-completed task (collecting `assigned` ones into `skippedHeldTaskIds` for
  post-transaction slot release), mark the stage `completed`, sum `earnedScore`, detect the
  final stage via `game.stages...isFinal ?? (stageIdx === stages.length - 1)`, and unlock the
  next stage iff `isReleased(nextGameStage, launchedAt, now)`. In `sweepExpiredInFlight` at
  **lines 2051–2075**: the *same* computation, whose comment reads *"Stage completion — mirror
  of completeTaskForTeam's stageDone block."* `computeStageUnlock` (2000–2020) is a third,
  partial variant handling only the lazy next-stage unlock on a later poll. **`captureZone`
  (1732) does NOT contain a stage-completion block** — it only awards a capture bonus
  (`bonusPenalty` delta) and updates the zone's owner; the review's "captureZone path" claim
  is inaccurate and is dropped from this design.

- **`requireAuth` is defined five times**, byte-identical bodies:
  `functions/src/index.ts:52`, `functions/src/runs/index.ts:100`,
  `functions/src/payments/index.ts:26`, `functions/src/games/index.ts:46`,
  `functions/src/users/index.ts:20`. All are `if (!context.auth) throw ...
  'unauthenticated', 'Sign in required'; return context.auth.uid;`.

- **The import contract that constrains the barrel.** `functions/src/index.ts:18` imports the
  internal helpers `{ completeTaskForTeam, resolveCallerTeam, maybeRefreshLeaderboardSnapshot }
  from './runs/index'`, `functions/src/index.ts:24-47` re-exports the enumerated callables
  from `./runs/index`, and `functions/src/__property__/invariants.property.test.ts:16` imports
  `{ buildRankings } from '../runs/index'`. The barrel must keep exporting all of these.

## Goals / Non-Goals

**Goals:**
- Break `runs/index.ts` into focused, individually-navigable modules along clean domain
  boundaries, extending the existing `runs/` modular pattern.
- Reduce the public `runs/index.ts` to a thin barrel whose export surface is identical to
  today's, so no importer (`index.ts`, the property test) needs to change its import paths.
- Collapse the duplicated stage-completion logic to one shared helper so the two verbatim
  copies can never drift again.
- Give `requireAuth` a single definition.
- Preserve 100% of runtime behavior; prove it with the existing e2e + property suites staying
  green **unmodified**.

**Non-Goals:**
- No behavioral change, no scoring/routing/authz change, no error-message change.
- No fixing the sweep-vs-complete slot-release divergence (preserve each caller's behavior).
- No consolidation of the larger `assertAdmin` / `assertStaffOrOwner` helpers.
- No new callable, no schema/rules/index change, no client change.
- `completeTaskForTeam` and the routing helpers stay internal — never re-exported as triggers.

## Decisions

**1. Module split boundaries (new files under `functions/src/runs/`).** Each domain's callables
and its private helpers move together; cross-module internals move to a shared `helpers.ts` to
avoid import cycles.

- `functions/src/runs/helpers.ts` — the cross-cutting internals every module needs:
  path builders (`gamePath`, `runPath`, `teamPath`, `teamsCol`, `feedbackCol`),
  `findGameTask`, and the newly-extracted **`applyStageCompletion`** (Decision 2).
  `requireAuth` is *removed* here and imported from `../auth` (Decision 3).
- `functions/src/runs/lifecycle.ts` — run creation/registration/finalization:
  `launchRun`, `getJoinInfo`, `joinRun`, `startTeams`, `skipStage`, `finalizeRun`,
  `listLiveRuns`, `startInstantPlay`, `getMyProfile`, `requestGuardianConsent`,
  `grantGuardianConsent`; private `generateCode`, `uniqueCode`, `buildInitialStages`,
  `recordPlayerResult`. (Consent + instant-play + profile ride with lifecycle because they
  gate/seed run entry and finalize; keeping them here avoids a fourth tiny file.)
- `functions/src/runs/tasks.ts` — the task/stage engine:
  `completeTaskForTeam` (internal), `completeTask`, `requestNextTask`, `requestTaskHint`,
  `submitTaskAnswer`, `submitSequenceStep`, `getRecommendedTasks`, `checkOutTask`,
  `getMyTeamState`; private `computeStageUnlock`, `sweepExpiredInFlight`,
  `assignNextInActiveStage`, `assertTaskNotExpired`. This is where `applyStageCompletion` is
  consumed at both sites.
- `functions/src/runs/leaderboard.ts` — standings + read-only run analytics:
  `buildRankings` (exported internal — used by `finalizeRun` and the property test),
  `maybeRefreshLeaderboardSnapshot` (exported internal — used by `completeTaskForTeam`),
  `refreshLeaderboard`, `getPublicLeaderboard`, `getRunRecap`, `getRunReplay`,
  `getRunAnalytics`, `getRunHeatmap`.
- `functions/src/runs/zones.ts` — geofenced live-ops overlays:
  `activateHotZone`, `deactivateHotZone`, `createZone`, `deleteZone`, `getRunZones`,
  `captureZone`, `getRunDiscoveryPois`, `claimDiscoveryPoi`.
- `functions/src/runs/trackables.ts` — carryable objects:
  `createTrackable`, `getRunTrackables`, `pickUpTrackable`, `dropTrackable`; private
  `transferTrackable`.
- `functions/src/runs/feedback.ts` — post-run feedback + surveys:
  `submitRunFeedback`, `getRunFeedbackSummary`, `getRunSurveyResults`. (Wraps the existing
  `feedbackSummary.ts` helpers; the `feedbackCol` path builder moves to `helpers.ts`.)
- `functions/src/runs/devices.ts` — multi-phone teams:
  `joinTeamAsDevice`, `transferController`, `claimController`; `resolveTeamContext` (internal),
  `resolveCallerTeam` (exported internal — also imported by `functions/src/index.ts`).
  (Wraps the existing `teamDevices.ts` helpers.)
- `functions/src/runs/index.ts` — **thin barrel**: `export * from './lifecycle'` etc. for each
  module, re-exporting every callable AND the four internal helpers currently imported from it
  (`completeTaskForTeam`, `resolveCallerTeam`, `maybeRefreshLeaderboardSnapshot`,
  `buildRankings`). Nothing else imports the file, so this keeps every consumer's paths intact.

*Import-cycle management:* `completeTaskForTeam` (tasks) calls `maybeRefreshLeaderboardSnapshot`
(leaderboard); `finalizeRun` (lifecycle) calls `buildRankings` (leaderboard) and
`recordPlayerResult` (lifecycle); several modules call `resolveCallerTeam` (devices) and the
path/stage helpers (helpers). Dependencies flow **tasks/lifecycle/zones/... → leaderboard,
devices, helpers**, with `helpers.ts` importing nothing from its siblings — a DAG, no cycle.
Where an unavoidable cross-reference appears at build time, it is resolved by importing the
concrete module (`./leaderboard`) directly rather than through the barrel, so the barrel stays
a pure re-export and does not create a cycle through itself.

**2. Extract `applyStageCompletion` — one source of truth for stage completion.** New pure-ish
helper in `helpers.ts`:

```
applyStageCompletion(
  stages: RunStageRecord[],   // mutated in place (both callers already work on a clone)
  stageIdx: number,
  game: Game,
  launchedAt: string | undefined,
  now: string,                // ISO string; callers pass the same `now` they already compute
): { completed: boolean; heldAssignedTaskIds: string[] }
```

It reproduces lines 704–743 exactly: compute `completedCount` / `required` / `allTerminal`,
return early with `{ completed: false, heldAssignedTaskIds: [] }` when not done; otherwise
auto-skip leftovers (collecting `assigned` ids into `heldAssignedTaskIds`), set the stage
`completed`/`completedAt`/`earnedScore`, detect the final stage, and unlock the next stage iff
`isReleased(...)`. **Behavior preservation is per-caller:**
- `completeTaskForTeam` pushes `heldAssignedTaskIds` into its existing `skippedHeldTaskIds`
  array so the post-transaction `releaseTask` loop is byte-for-byte identical to today.
- `sweepExpiredInFlight` today does **not** release slots — so it ignores
  `heldAssignedTaskIds`, preserving its current (possibly-suboptimal) behavior. This divergence
  is deliberately not "fixed" here (see Open Questions); the helper merely makes it *visible*
  and *shared* instead of silently duplicated.

`computeStageUnlock` (the partial third variant, lazy next-stage unlock on a later poll) is a
genuinely different operation (it scans for the earliest eligible locked stage across a whole
poll, not "the stage that just finished") and is **left as-is** — folding it in would change
behavior. It is documented next to `applyStageCompletion` so the relationship is explicit.

*Alternative considered:* make `applyStageCompletion` fully pure (return a new `stages` array).
Rejected — both call sites already clone and then mutate their `stages` array in place; a
mutating helper matches the existing pattern with the smallest possible diff, which is exactly
what a behavior-preserving refactor wants. The unit test exercises it as a pure input→output
function anyway (clone in the test, assert on the result).

**3. Single `requireAuth` in `functions/src/auth.ts`.** New module:

```
export function requireAuth(context: functions.https.CallableContext): string {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  return context.auth.uid;
}
```

Imported by `functions/src/index.ts`, `functions/src/runs/*` (via each split module or via
`helpers.ts` re-export), `functions/src/payments/index.ts`, and — since the bodies are
identical — `functions/src/games/index.ts` and `functions/src/users/index.ts`. The five local
definitions are deleted. `assertAdmin` / `assertStaffOrOwner` are **not** touched in this pass
(they are larger and only partly duplicated); `auth.ts` is the natural home to consolidate them
later, but that is out of scope. Placing the file at `functions/src/auth.ts` (sibling of
`index.ts`) keeps the import depth shallow for every consumer.

**4. The barrel keeps the callable surface byte-identical.** `functions/src/index.ts`'s
`export { ...enumerated callables... } from './runs/index'` list is unchanged, so Firebase
discovers exactly the same set of triggers and the `npm run e2e` callable-coverage guard stays
at 66/66. Internal helpers (`completeTaskForTeam`, routing helpers) remain non-enumerated in
that re-export list, so they stay internal — the barrel exporting them for *intra-`functions`*
import does not make them Cloud Functions.

## Test Strategy

This is a **behavior-preserving refactor**, so the primary "test" is that the existing safety
net stays green with **zero edits to the tests themselves**:

- **Existing e2e is the behavioral oracle — `npm run e2e`.** The full create→launch→join→
  start→play→review→leaderboard→finalize lifecycle, the station-contention race, the leaderboard
  invariant oracle + live/final parity, the authz denial matrix, the sanitizer allowlist, the
  seeded boundary fuzz, and the **callable-coverage guard (66/66)** must all pass **unmodified**.
  Because no callable signature or behavior changes, any red here means the refactor changed
  behavior and must be corrected. The coverage guard specifically proves the barrel still
  exposes exactly the same set of callables.
- **Existing pure-logic + property lanes — `npm test`.** `functions/src/__property__/invariants.property.test.ts`
  (which imports `buildRankings` from `../runs/index`), the `scripts/test-*.ts` aggregator, and
  the co-located `runs/*.test.ts` (`feedbackSummary.test.ts`, `leaderboardThrottle.test.ts`,
  `sanitizeTask.test.ts`, `teamDevices.test.ts`) must all stay green — proving the barrel keeps
  its internal-helper exports and that moved code compiles and behaves identically.
- **New co-located unit test for the extracted helper — `functions/src/runs/helpers.test.ts`
  (RED first).** Before extracting, write a vitest file that imports the *intended*
  `applyStageCompletion` signature and asserts, on hand-built `RunStageRecord[]` fixtures:
  (a) a stage with `requiredTaskCount` met returns `completed: true`, marks leftovers
  `skipped`, sets `status/completedAt/earnedScore`, and reports the `assigned` leftover ids in
  `heldAssignedTaskIds`; (b) a non-final completed stage unlocks the next stage only when
  `isReleased` is true (scheduled-release gate held → next stays `locked`); (c) the final stage
  (via `isFinal`) does not unlock anything; (d) a stage not yet meeting `required` and not
  all-terminal returns `completed: false` with no mutation of stage status. Run `npm test`,
  confirm it fails (function doesn't exist), then extract and confirm green — locking the
  single-source behavior against future edits to either call site.
- **Type + build gates prove the module wiring — `npm run typecheck`, `npm run creator:build`,
  `npm run play:build`.** A missed export or a stray import cycle from the split fails
  typecheck/build loudly.
- **No UI touched → `npm run i18n:check` is not required** by the rules (backend-only change);
  it is run in the final gate pass anyway and must stay clean (it will be a no-op — no strings
  change).

No new e2e assertions are added: the change asserts *sameness*, and the existing suite already
covers every affected callable (66/66). Adding assertions would imply new behavior, which there
is none of.

## Risks / Trade-offs

- **[Risk] A silent behavior change slips in during the mechanical move** (e.g. a subtly
  reordered statement, a dropped `await`). → Mitigation: move code verbatim, run the full
  `npm run e2e` + `npm test` after each module is carved out (not just at the end), and treat
  any red as a real regression, not a test to update. The `applyStageCompletion` extraction is
  the one genuinely-edited hot path and is guarded by its own RED-first unit test plus the e2e
  partial-stage and task-expiry scenarios.
- **[Risk] Import cycle introduced by the split** (tasks ↔ leaderboard, lifecycle ↔ leaderboard).
  → Mitigation: `helpers.ts` imports nothing from siblings; cross-module calls import the
  concrete module, not the barrel; typecheck/build catch any accidental cycle.
- **[Trade-off] The barrel re-exports internal helpers** (`completeTaskForTeam`, etc.) for
  intra-`functions` use, which can *look* like they're public. → Accepted and unchanged from
  today: they are already imported this way; the enumerated re-export list in
  `functions/src/index.ts` — not the barrel — is what defines the Cloud Function surface, and
  that list is untouched.
- **[Trade-off] `git blame` history moves** for the carved-out code. → Accepted; the domain
  clarity and de-duplication are worth it, and `git log --follow` still traces it.

## Migration Plan

Pure internal refactor — no data migration, no rollback beyond a revert (nothing persisted
changes). Land it in reviewable slices, each ending green:
1. `functions/src/auth.ts` + swap all five `requireAuth` definitions to the import.
2. `helpers.ts` with the RED-first `applyStageCompletion` extraction; rewire both call sites.
3. Carve out one domain module at a time (`leaderboard` and `devices` first, since others
   depend on them), re-pointing the barrel, running gates after each.
4. Reduce `runs/index.ts` to the final thin barrel; full gate pass.
Because the export surface is invariant throughout, `functions/src/index.ts` and the property
test never need editing.

## Open Questions

- **Should `sweepExpiredInFlight` release station slots for auto-skipped assigned tasks like
  `completeTaskForTeam` does?** The two currently diverge; this refactor preserves the
  divergence and merely surfaces it via `applyStageCompletion`'s `heldAssignedTaskIds` return.
  If the sweep path *should* release those slots, that is a **behavioral bugfix** to propose
  separately (with its own e2e assertion), not part of this behavior-preserving split.
- **Should `assertAdmin` / `assertStaffOrOwner` also move into `functions/src/auth.ts`?**
  Deferred — they are larger and only partially duplicated; `auth.ts` is the natural home when
  someone consolidates them, but this pass only unifies the trivially-identical `requireAuth`.
