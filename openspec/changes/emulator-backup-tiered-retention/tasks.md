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

## 6. RED→GREEN — post-incident hardening (D10: hung probe + probe-independent heartbeat)

Triggered by a real, observed recurrence: the loop's last snapshot was 21:38, the emulator was then
stopped, and the loop stayed alive but SILENT for ~3 hours (frozen heartbeat, no banner) while
`--status` would have reported healthy.

- [x] 6.1 RED: add failing cases to `scripts/test-emulator-backup.ts` for a new
      `probeReadyWithTimeout(probe, timeoutMs, scheduleTimeout?, clearScheduledTimeout?)`: a
      never-resolving probe, a rejecting probe, a synchronously-throwing probe, a promptly
      resolved-true probe, a promptly resolved-false probe, and timer-cleanup (the timeout handle is
      cleared once the probe settles first). Confirm it fails because the export does not exist yet.
- [x] 6.2 GREEN: implement `probeReadyWithTimeout` in `scripts/lib/emulatorBackup.mjs` — races the
      probe against a hard timeout; timeout, rejection, or a synchronous throw all resolve to `false`,
      indistinguishable from an ordinary not-ready result. Re-run 6.1 to green.
- [x] 6.3 Wire it into `scripts/emulator-backup.mjs`: the single `isReadyNow()` definition is wrapped
      once with `probeReadyWithTimeout` (new `EMU_BACKUP_READY_PROBE_TIMEOUT_MS`, default 5000 ms), so
      every existing call site (boot-wait loop, `tick()`, `snapshotNow`) is bounded without per-site
      changes.
- [x] 6.4 Add a `watchdogTick()` + its own `setInterval` (`WATCHDOG_MS`, independent of `tick`'s
      interval), started before the boot-wait loop, that calls `reportHealth()` + `writeStatus()` on a
      wall-clock cadence regardless of whether a tick (export or probe) is currently in flight.
- [x] 6.5 Document `EMU_BACKUP_READY_PROBE_TIMEOUT_MS` in the header comment of
      `scripts/emulator-backup.mjs`, alongside the existing env var list.
- [x] 6.6 Re-run `npm test` (the full pure-logic aggregator) and `npx openspec validate
      emulator-backup-tiered-retention --strict`; both must pass. Runtime behavior of the watchdog
      against a real emulator remains UNVERIFIED here — no emulator was started for this task, per
      constraint.

Follow-up defect introduced by 6.4: the watchdog calls `reportHealth()` every ~5 s and
`reportHealth()` shouted its 6-line red banner unconditionally — ~720 banners an hour, burying the
emulator/dev-stack output needed to diagnose the very failure being announced (design D11).

- [x] 6.7 RED: add failing cases to `scripts/test-emulator-backup.ts` for a new
      `shouldShoutHealth({ health, lastShoutMs, lastShoutHealth, nowMs, minGapMs })`: `ok`/`starting`
      never shout; first-ever banner shouts; null/undefined/NaN `lastShoutMs` shouts; same level under
      / exactly at / past the gap; every level CHANGE shouts immediately despite the gap; a backwards
      `nowMs` shouts (and throttles normally after the caller re-stamps); gap `0` = always, negative /
      `NaN` = default; empty/undefined argument returns `false`. Confirm it fails because the export
      does not exist yet.
- [x] 6.8 GREEN: implement `shouldShoutHealth` + `DEFAULT_HEALTH_SHOUT_GAP_MS` (60 s floor) in
      `scripts/lib/emulatorBackup.mjs`. Re-run 6.7 to green.
- [x] 6.9 Wire it into `reportHealth()` in `scripts/emulator-backup.mjs`: `assessLoopHealth` and
      `writeStatus()` keep running on every watchdog tick unchanged; only `shout()` is gated, on
      module-local `lastShoutMs`/`lastShoutHealth` (deliberately NOT persisted into `STATUS.json` —
      banner cadence is not published health). Gap = `EMU_BACKUP_SHOUT_MIN_GAP_MS`, default
      `max(60000, EMU_BACKUP_INTERVAL_MS)`.
- [x] 6.10 Document `EMU_BACKUP_SHOUT_MIN_GAP_MS` in the header comment of
      `scripts/emulator-backup.mjs`, alongside the existing env var list.
- [x] 6.11 Harden `probeReadyWithTimeout` against a synchronously-firing injected scheduler: the
      timer handle was captured in a `const` that `finish()` closed over, so a synchronous callback
      hit its temporal dead zone and rejected the promise instead of resolving `false`. RED with a
      fake synchronous scheduler, then declare `let timer` before the `scheduleTimeout` call.
- [x] 6.12 Re-run `npm run typecheck`, `npm run lint`, `npm test` and `npx openspec validate
      emulator-backup-tiered-retention --strict`; all must pass. Record output verbatim. Emulator-
      dependent gates remain UNVERIFIED (live stack serving from this tree).
