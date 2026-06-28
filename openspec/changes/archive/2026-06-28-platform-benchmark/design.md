# Design — Platform benchmark

## Current behavior

- `run-analytics-heatmap` defines `compareToPlatformMedian(taskType, value)` as a stub returning null
  (no cross-run data). `finalizeRun` writes final standings.
- No platform-level aggregate exists.

## Approach

### Pure helpers → `packages/shared/src` (the TDD lever)

```ts
mergeBenchmark(
  prev: { count: number; medianMsRolling: number; completionRateRolling: number } | null,
  sample: { medianMs: number; completionRate: number }
): { count, medianMsRolling, completionRateRolling }
  // rolling/weighted update; from null → initialized from the first sample.

benchmarkIndicator(value: number, platformMedian: number | null): 'faster' | 'slower' | 'on_par' | 'unknown'
  // null platformMedian → 'unknown'; within ±10% → 'on_par'; below → 'faster'; above → 'slower'.
```

Tested in `scripts/test-benchmark.ts`: `mergeBenchmark` initializes from null, updates the rolling
aggregate monotonically in count; `benchmarkIndicator` thresholds (faster/slower/on_par/unknown).

### Contribution (server)

`finalizeRun` computes per-task-type samples and, when contribution is not opted out, applies
`mergeBenchmark` to `benchmarks/{taskType}` in a transaction. Only aggregate counts/medians are
stored — never a run/game/team id.

### Read-back

`compareToPlatformMedian` (now real) reads `benchmarks/{taskType}.medianMsRolling`;
`benchmarkIndicator` turns it into the ↑/↓/≈ chip in the analytics table.

## Test strategy (TDD)

- **Pure (RED first)** → `scripts/test-benchmark.ts`: `mergeBenchmark` + `benchmarkIndicator` cases.
- **e2e** → finalize a run → `benchmarks/{taskType}` updated with aggregate-only fields (no ids);
  a second run reads back a non-null platform median; opt-out skips contribution.
- **UI (preview):** analytics table shows real ↑/↓/≈ indicators once a benchmark exists.

## Conventions

- Aggregate-only, no PII / no per-run identifiers (privacy by construction). Server-write-only.
- Rolling merge in a transaction (idempotency rule 15). `FIRESTORE_PATHS` for the benchmarks path.
