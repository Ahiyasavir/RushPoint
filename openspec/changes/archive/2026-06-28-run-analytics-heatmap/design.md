# Design — Run analytics & heatmap dashboard

## Current behavior

- Finished run: `finalizeRun` writes `run.status = 'finished'`, `run.rankings[]`. Team docs hold
  full `TaskState[]` with `completedAt`, `earnedScore`, `verificationOutcome`, `actualMinutes`.
- The 90-day prune (`pruneRunPII`) clears team-level data but leaves `run.rankings[]` intact.
- `v21-growth.todo.test.ts` already has the `computeRunAnalytics` + `getRunAnalytics` blueprint
  (rows #22) — this change implements those stubs.

## Approach

### Pure aggregator → `packages/shared/src`

```ts
computeRunAnalytics(teams: TeamSummary[], tasks: Task[]) → RunAnalytics {
  perTask: {
    taskId, taskTitle, coordinates?,
    completionRate,           // completed / (completed + skipped + timed-out)
    medianMinutes,            // median of actualMinutes across completing teams
    p90Minutes,
    hintCount, skipCount,
    dropOffCount,             // teams that started the task but never completed
  }[],
  perStage: {
    stageId, stageTitle,
    completionRate,           // teams that finished the stage / teams that reached it
    medianMinutes,
    dropOff,                  // # teams that left the stage incomplete
  }[],
  overall: { teamCount, finisherCount, totalMedianMinutes }
}
```

Retention-safe: if a team's `taskStates` are cleared, it contributes 0 to per-task counts —
aggregates degrade gracefully. No team-level PII in the output.

### Callable → `getRunAnalytics` (`functions/src/runs/index.ts`)

Auth: `requireAuth` → must be the owner (`ownerUid === caller`). Run must be finished. Reads all
teams via `FIRESTORE_PATHS.teamsCol`, runs `computeRunAnalytics`, returns the result.

### Benchmark

A simple `compareToPlatformMedian(taskType, medianMinutes)` stub: for now returns `null`
(no cross-run data yet) — the type is defined so the future data pipeline can fill it in.

### Creator-web Analytics tab

- New `RunConsole` tab "ניתוח" / "Analytics" (Pro-only: `wallet.plan !== 'pro'` → upsell chip).
- Route map: existing `RoutePreviewMap` with task pins recolored by `completionRate`
  (green ≥ 80%, amber 50–80%, red < 50%). A legend overlay.
- Table: one row per task — title, completion %, median time, p90, hints, skips; sortable by column.
- Benchmark arrow: if `compareToPlatformMedian` returns a value, show `↑` / `↓` / `≈` chip.

## Test strategy (TDD)

- **Pure (RED first)** → `scripts/test-run-analytics.ts`:
  `computeRunAnalytics` — completion rate correct; median/p90 correct; hint + skip counts correct;
  prune-safe (cleared team ⇒ no crash, aggregates exclude it); stage drop-off correct.
- **e2e** → extend `scripts/e2e-verify.mjs`: `getRunAnalytics` owner-only; returns expected
  per-task structure; non-owner → `permission-denied`.
- **UI (preview):** analytics tab renders map with colored pins; table shows correct values for a
  seeded run.

## Conventions

- New callable = new `getRunAnalytics` entry in `functions/src/runs/index.ts` + re-export + wrappers.
  Uses `FIRESTORE_PATHS.teamsCol`. No dotted-array writes (read-only).
- Answer keys untouched (analytics aggregates completion outcomes, not answer content).
- Pro gate is a client-side UI gate only — the callable itself is owner-gated but not Pro-gated
  (data should not be withheld; only the dashboard surface is Pro).
