## 1. RED — failing tests first

- [x] 1.1 Create `scripts/test-emulator-retention.ts` in the house style of
      `scripts/test-emulator-backup.ts` (`ok(cond, msg)`, `passed`/`failed`, `process.exit`),
      importing `planRetention`, `selectImportSource`, `assessLoopHealth`, `canStartExport` and
      `shouldStartBackupLoop` from `./lib/emulatorBackup.mjs`. Synthetic fixtures only — the test
      MUST NOT read or write `.firebase/backups/` or `C:\Users\savir\rushpoint-rescue\`.
- [x] 1.2 Encode the `planRetention` cases from the design's Test Strategy: empty, single, all-zero
      capacities, recent-tier off-by-one at `keep-1`/`keep`/`keep+1`, hourly/daily bucket
      representative is the newest, exact hour/day boundaries ±1 ms, shuffled input, clock-backwards
      snapshot, DST-transition span, multi-day gap, unparseable name, `STATUS.json`-like entry,
      pinned snapshots, and the disk cap (under / at / over / smaller than one snapshot).
- [x] 1.3 Add a shared invariant helper asserting on EVERY `planRetention` case that
      `keep ∪ prune === input`, `keep ∩ prune === ∅`, and the greatest-timestamp snapshot is never
      pruned.
- [x] 1.4 Encode the `selectImportSource` cases, including the real incident numbers (217 KB primary
      vs 689 KB backup with the primary made to look freshest → the backup must win via the
      substance guard), fresher-but-invalid, fresher-but-empty, both invalid, single candidate,
      comparable sizes, `allowShrink` override, and fallback-timestamp reporting.
- [x] 1.5 Encode the `assessLoopHealth` / `canStartExport` / `shouldStartBackupLoop` cases:
      interval-multiple boundaries, failure-driven stalling, the monotonicity sweep, re-entrancy
      refusal while `inFlight`, and loop-start suppression only for a recent heartbeat with a live
      pid (never for a stale heartbeat or a dead pid) plus the explicit opt-out.
- [x] 1.6 Run `npx tsx scripts/test-emulator-retention.ts` and confirm it FAILS for the right reason
      (the new exports do not exist yet). Record the failure.

## 2. GREEN — pure logic

- [x] 2.1 Add `planRetention({ snapshots, policy })` to `scripts/lib/emulatorBackup.mjs`: epoch-ms
      bucketing (`Math.floor(ts / unitMs)`), union-of-tiers keep, newest-per-bucket representative,
      unconditional keep for pinned / unparseable / greatest-timestamp, and NO `nowMs` parameter.
- [x] 2.2 Add the disk-cap pass inside `planRetention`: oldest-first eviction from the tier-retained
      set until the byte total fits, never evicting the newest snapshot.
- [x] 2.3 Add `selectImportSource({ primary, backup, allowShrink, shrinkRatio })`: disqualify
      absent/invalid/empty candidates, compare like-for-like metadata write times with a flagged
      `nameMs` fallback, then apply the substance guard returning an explicit `reason` and `shrink`
      detail. Leave `selectFreshestImport` exported and unchanged.
- [x] 2.4 Add `assessLoopHealth`, `canStartExport` and `shouldStartBackupLoop` with the thresholds
      from the design (degraded > 2 intervals or ≥ 1 failure; stalled > 5 intervals or ≥ 3
      consecutive failures; loop start suppressed only by a recent heartbeat with a live pid).
- [x] 2.5 Re-run `npx tsx scripts/test-emulator-retention.ts` and confirm GREEN.

## 3. GREEN — loop wiring

- [x] 3.1 Wire `planRetention` into `scripts/emulator-backup.mjs`'s `prune()`, reading the tier and
      cap policy from `EMU_BACKUP_KEEP` / `EMU_BACKUP_KEEP_HOURLY` / `EMU_BACKUP_KEEP_DAILY` /
      `EMU_BACKUP_MAX_BYTES`, sizing snapshots via a `statSync` roll-up and detecting the `PINNED`
      marker. Preserve the existing readiness gate and `didExportSucceed` behavior exactly.
- [x] 3.2 Write `.firebase/backups/STATUS.json` on every tick (pid, startedAt, updatedAt,
      lastSuccessAt/Name, consecutiveFailures, intervalMs, health, snapshot count and total bytes).
      Confirm the name cannot be picked up by `listBackups()`'s `backup-` prefix filter.
- [x] 3.3 Add the export timeout and the `inFlight` re-entrancy guard so a hung export is killed,
      counted as a failure, and cannot stack overlapping exports.
- [x] 3.4 Emit the loud repeated multi-line stderr banner while health is `degraded`/`stalled`, and
      stay quiet while `ok`.
- [x] 3.5 Add the `--status` CLI mode (renders the status file, exits non-zero when `stalled` or
      when no status file exists) and the `--snapshot-now [--pin]` one-shot mode (single snapshot
      then exit; non-zero when the emulator is not ready).

## 4. GREEN — emulator start path

- [x] 4.1 Flip `scripts/dev-emulator.mjs` to start the snapshot loop by default, opting out only on
      `RUSHPOINT_BACKUP=0`/`false`, gated through `shouldStartBackupLoop` so a live loop's heartbeat
      suppresses a duplicate while a stale one does not.
- [x] 4.2 Replace the `selectFreshestImport` call in `dev-emulator.mjs` with `selectImportSource`,
      supplying like-for-like metadata mtimes and byte sizes for both candidates, and print a loud
      multi-line banner naming both sizes whenever the substance guard engages or the chosen dataset
      is materially smaller than the rejected one. Do not regress the freshest-wins behavior in the
      ordinary case.

## 5. REFACTOR & gates

- [x] 5.1 Review the new pure functions for duplication with the existing helpers
      (`isSnapshotDue`, `canAttemptExport`, `snapshotTimeMs`, `selectSnapshotsToPrune`); reuse rather
      than re-derive, and keep every existing export intact for back-compat.
- [x] 5.2 Document the new env vars and the `--status` / `--snapshot-now` modes in the header
      comment of `scripts/emulator-backup.mjs`, including the recommendation to call
      `--snapshot-now --pin` from `emulator-restore.mjs` and `seed:reset` (recommendation only —
      not wired in this change).
- [x] 5.3 Run `npm run typecheck`, `npm run lint` and `npm test`; all must pass, including the
      pre-existing `scripts/test-emulator-backup.ts`. Record output verbatim.
- [x] 5.4 Explicitly record that emulator-dependent gates (`npm run e2e`, `verify:emulator`) and the
      loop's runtime behavior are UNVERIFIED because a live playtest stack is serving from this tree
      and no emulator/backup/tunnel process may be started or restarted.
