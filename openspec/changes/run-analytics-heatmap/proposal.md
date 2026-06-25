# Proposal — Run analytics & heatmap dashboard

## Why

After a run the organizer has no way to know which tasks were too hard, which stage caused teams to
drop off, or where participants spent the most time. This is the most actionable data for improving
a game — and today it is silently discarded. A data-driven creator builds better games, runs more
events, and stays on the platform longer.

This change adds a **post-run analytics dashboard** (Pro-gated) with a per-task time/completion
heatmap on the route map, a completion-rate table, and hint/skip breakdowns — so every run teaches
the creator something.

## What Changes

> Observable behavior. Read-only analytics surface; existing scoring/run logic untouched.

- A new **`getRunAnalytics`** callable returns post-run aggregate analytics for a finished run:
  median/p90 task completion time, per-stage completion rate and drop-off, hint usage and skip
  counts per task. Owner-only. PII-safe: aggregates are available even after the 90-day prune
  (individual teams' data stripped, counts preserved).
- The creator RunConsole adds an **Analytics tab** (Pro-gated) after a run is finalized:
  a **route map heatmap** (task pins colored by drop-off rate), a task-time table with benchmark
  arrows ("this task took 2× longer than your platform median"), and a hint/skip bar chart.
- **Benchmark comparison**: each task's median time is compared to the anonymized cross-platform
  median for the same task type, shown as a directional indicator.

## Capabilities

### New Capabilities
- `run-analytics`: a `getRunAnalytics` aggregate (time, completion, hint/skip per task) + a
  creator analytics dashboard with a route heatmap and benchmark indicators (Pro-gated).

### Modified Capabilities
<!-- None -->

## Surfaces touched

- **Callable:** new `getRunAnalytics` in `functions/src/runs/index.ts` + re-export + wrapper.
- **shared:** `computeRunAnalytics(teams, tasks)` pure aggregator; `BenchmarkIndicator` type.
- **creator-web:** new Analytics tab in RunConsole; heatmap uses the existing MapLibre route map
  with colored task pins (drop-off intensity → amber → red). Pro gate: `wallet.plan === 'pro'`.
- **Tests:** new `scripts/test-run-analytics.ts` (pure aggregator); e2e assertions for the callable.
- **No play-web changes, no Firestore rules change** beyond the new callable path.

## Non-goals

- No real-time analytics during a live run (post-run only).
- No data export / CSV (that is a separate change, #30 email export already ships for emails).
- No team-level PII in the analytics payload — aggregates only.
- Depends on `getRunAnalytics` being owner-only; no public analytics surface.
