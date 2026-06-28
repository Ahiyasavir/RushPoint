# Proposal — Platform benchmark (cross-run anonymized comparisons)

## Why

The analytics dashboard (`run-analytics-heatmap`) shows a creator how *their* run performed — but the
insight that actually changes behavior is **comparison**: "your task 3 took 7 min; the platform
median for this task type is 4 min — consider simplifying." That benchmark requires an anonymized
cross-run data pipeline, which is its own capability and the natural follow-up to row 49.

## What Changes

> Observable behavior. An anonymized aggregate that powers the benchmark indicators in analytics.

- On run finalization, **anonymized, aggregate-only** metrics per task type (median completion time,
  completion rate) are contributed to a platform-level `benchmarks` collection — **no team or game
  identifiers, no PII**, only counts and rolling aggregates per task type.
- The analytics dashboard's `compareToPlatformMedian(taskType, value)` (stubbed in row 49) is
  **backed by real data**: each task in the creator's analytics shows a directional indicator
  (↑ slower / ↓ faster / ≈ on par) versus the anonymized platform median.
- Contribution is **opt-outable** and strictly aggregate (a single run cannot be reverse-identified).

## Capabilities

### New Capabilities
- `platform-benchmark`: an anonymized cross-run aggregate per task type that backs the analytics
  benchmark indicators with real comparison data.

### Modified Capabilities
<!-- run-analytics' compareToPlatformMedian goes from a stub to a data-backed function. -->

## Surfaces touched

- **Firestore:** new aggregate `benchmarks/{taskType}` doc (`{ count, medianMsRolling,
  completionRateRolling }`) — **no per-run identifiers**. Server-write-only.
- **Backend:** `finalizeRun` contributes anonymized aggregates (a rolling update, opt-out aware).
- **shared:** pure `mergeBenchmark(prev, sample)` (rolling aggregate update) +
  `benchmarkIndicator(value, platformMedian)` (↑/↓/≈) — the TDD lever.
- **creator-web:** the analytics table benchmark column reads the real indicator.
- **Tests:** `scripts/test-benchmark.ts` (rolling merge + indicator); e2e (contribution + read-back).

## Non-goals

- No per-game or per-creator leaderboards of benchmarks (anonymized aggregates only).
- No exposure of any individual run's data through the benchmark surface.
- Depends on `run-analytics-heatmap` (row 49) for the dashboard surface it feeds.
