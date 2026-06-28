# Design — Run replay / VOD

## Current behavior

- Team docs hold `TaskState[]` with `startedAt`, `completedAt`, `earnedScore`, `photoUrl`. `run.rankings[]`
  holds final standings. The 90-day prune clears team PII but leaves rankings.
- `run-recap` already aggregates standings + photos; replay is the **time-ordered** view.

## Approach

### Pure aggregator → `packages/shared/src` (the TDD lever)

```ts
buildRunTimeline(teams, run): {
  events: { atMs, type: 'start'|'task_complete'|'photo'|'milestone'|'finish', teamId, label }[],
  scoreSeries: { teamId, points: { atMs, score }[] }[],
  perTeam: { teamId, displayName, finalScore, finalRank }[]
}
  // events sorted ascending by atMs; scoreSeries cumulative per team; retention-safe (cleared
  // team contributes no events, no crash).
```

Tested in `scripts/test-run-replay.ts`: events globally time-ordered; cumulative score series
correct; pruned team → omitted without error; empty run → empty timeline.

### Callable → `getRunReplay(runId)`

Owner-only, finished run. Reads teams, runs `buildRunTimeline`, returns it. Optional paid-unlock gate
(credit/Pro) is a UI/billing concern layered on top — the callable stays owner-gated.

### UI

RunConsole "Replay" page: timeline list + a scrubber (seek by time), per-team filter chips, the
photo gallery, and a score-over-time line chart. Export = browser print of a print-styled page.

## Test strategy (TDD)

- **Pure (RED first)** → `scripts/test-run-replay.ts`: ordering, cumulative series, prune-safety, empty.
- **e2e** → `getRunReplay` owner-only returns a correctly ordered timeline; non-owner → permission-denied.
- **UI (preview):** replay page renders timeline + scrubber + gallery + chart for a seeded run.

## Conventions

- New callable + re-export + wrappers; owner-gated; `FIRESTORE_PATHS`. Read-only (no writes).
- Retention-safe aggregation; no server-side rendering (print path only).
