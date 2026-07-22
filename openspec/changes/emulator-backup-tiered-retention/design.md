## Context

`scripts/emulator-backup.mjs` runs a snapshot loop beside the local emulator suite; all of its
timing/rotation/selection logic already lives as pure functions in `scripts/lib/emulatorBackup.mjs`
and is unit-tested by `scripts/test-emulator-backup.ts` through the `npm test` aggregator. That
separation is the pattern this change extends — nothing here needs the emulator to be tested.

Current state, each item verified in this working tree:

- **Backups are opt-in and almost never on.** `dev-emulator.mjs:98` starts the loop only when
  `RUSHPOINT_BACKUP` is `1`/`true`. `dev:all` is `concurrently --names EMU,SEED,CREATOR,PLAY` and
  never sets it; only `playtest`, `playtest:ngrok` and `playtest:prod` carry a `BACKUP` process
  (`npm:emulator:backup`). Ordinary dev sessions have run unprotected.
- **The primary export is 13 days stale and much smaller than a snapshot.**
  `.firebase/emulator-data/firebase-export-metadata.json` is dated 2026-07-09 18:52; the directory
  totals 217 KB (`firestore_export` 170 KB, `auth_export` 41 KB, `storage_export` 1 KB). The newest
  backup `backup-2026-07-22T18-38-05-390Z` totals 689 KB (622 / 61 / 1 KB). The export mechanism
  itself works — a manual `firebase emulators:export` against the live emulator succeeds — so the
  gap is that sessions end by closing a terminal, not with Ctrl+C.
- **The import chooser is unguarded.** `selectFreshestImport` (`lib:94-101`) receives `primaryMs`
  from `statSync(primaryMeta).mtimeMs` and `backupMs` from `snapshotTimeMs(basename(dir))`
  (`dev-emulator.mjs:68-76`): a file-write time versus a folder-name time, two different events. It
  compares nothing about *content*. With the sizes above, anything that touches the primary dir's
  mtime hands victory to a dataset a quarter the size, which then becomes the baseline every
  subsequent snapshot is taken from.
- **Snapshots are full exports.** `exportSnapshot` (`:59-75`) shells out to
  `firebase emulators:export`. Retention therefore discards old *states*, not old *data*: a game
  from hours ago survives in the newest snapshot while it is in the live DB. Retention becomes fatal
  only *after* a swap — `KEEP_N=10` at `INTERVAL_MS=120000` (`:20-21`) means all ten folders are
  rewritten from the replacement dataset within 20 minutes, and `prune()` (`:77-83`) `fs.rmSync`s
  the originals with no Recycle Bin.
- **The loop stops silently.** `.firebase/backups/` holds exactly ten folders ending at
  `18-38-05-390Z`; separately, the loop went 16+ minutes with no snapshot while PID 14756 was alive
  and the emulator up. The only failure signal is `console.warn('[backup] export failed (will retry
  next tick)')` (`:127`); a loop that stops ticking emits nothing.
- `tick` (`:115-129`) is `async` but driven by a bare `setInterval` (`:132`) that never awaits it —
  ticks can overlap — and `exportSnapshot` has no timeout, so a child that never exits leaves that
  tick pending forever while `lastTs` never advances.
- `listBackups()` (`:31-34`) enumerates entries whose name starts with `backup-`; anything new
  written into the backups directory must not match that prefix.

Hard constraint: **a live playtest stack is serving from this tree.** The loop, the emulator and the
tunnel must not be started, stopped or restarted; the real `.firebase/backups/` must not be pruned,
modified or used as a test fixture; `C:\Users\savir\rushpoint-rescue\` (including
`manual-snapshot-current`) is untouchable. All verification is pure-logic and static; runtime
behavior of the new loop is deliberately left unverified and flagged as such.

## Goals / Non-Goals

**Goals:**
- Every emulator session is protected by default; opting out is the explicit act.
- The import decision can never silently replace a substantial dataset with a lesser one.
- Extend the recoverable *state* history from ~20 minutes to days, with a policy that is a **pure
  total function** of (snapshot timestamps, policy) so it can be tested adversarially.
- Make a stopped or failing loop impossible to miss and machine-checkable.
- Bound total disk usage absolutely, evicting oldest-first, never to empty.
- Preserve every existing hard-won behavior: the hub readiness gate, mtime-based success detection,
  `--latest` restore selection.

**Non-Goals:**
- No product code, callables, rules, UI or i18n.
- No external alerting. Local terminal + status file + exit code only.
- No change to snapshot content, naming, or the export mechanism.
- No attempt to make graceful shutdown reliable — the design stops depending on it instead.
- No modification of destructive scripts (`seed:reset`, `emulator-restore.mjs`); the one-shot
  snapshot primitive they should call is built, the wiring is recommended (D9).

## Decisions

### D0 — Backups default ON for every emulator session (the headline)

`RUSHPOINT_BACKUP` inverts from opt-in to opt-out: the loop starts unless `RUSHPOINT_BACKUP` is
`0`/`false`.

*Why:* the loss happened in an unprotected session. No amount of retention tuning helps a session
that takes no snapshots. Everything else in this change is secondary to this line.

*Cost, stated:* one `firebase emulators:export` child every 2 minutes per dev session — about a
second of work and ~700–900 KB written per tick — plus disk bounded by D5. The readiness gate
already prevents the one genuinely dangerous case (an export against a mid-boot emulator).

*Duplicate-loop hazard:* `playtest` already runs its own `BACKUP` process **and** `npm:emulator`, so
a naive default would produce two loops exporting against one emulator — the failure mode
`free-ports.mjs:24-31` exists to clean up. Interlock: `shouldStartBackupLoop({ optOut, status,
nowMs, pidAlive, intervalMs })` is a pure decision over the published heartbeat — skip only when a
heartbeat is *recent* **and** its pid is alive. A stale or orphaned heartbeat never suppresses
protection, because failing open (two loops, noisy) is recoverable and failing closed (no loop,
silent) is what caused this incident.

### D1 — Import selection becomes a guarded decision, not a `>` on two unlike numbers

New pure `selectImportSource({ primary, backup, allowShrink, shrinkRatio })` where each candidate is
`{ present, valid, metaMtimeMs, nameMs, bytes }`, returning
`{ source: 'primary'|'backup'|null, reason, usedFallbackTime, shrink }`.

Rules, in order:
1. **Disqualify** absent, invalid (no export metadata) or empty (`bytes <= 0`) candidates. A
   disqualified candidate can never win regardless of freshness.
2. **Compare like for like**: both candidates' `metaMtimeMs` — the write time of each one's own
   `firebase-export-metadata.json`, an identical measurement for both. `nameMs` is a fallback only,
   flagged via `usedFallbackTime` so it can be surfaced.
3. **Substance guard**: if the freshest valid candidate's `bytes` is below `shrinkRatio` (default
   `0.5`) of the other valid candidate's, select the **substantial** one and report
   `reason: 'shrink-guard'` with both sizes. `allowShrink` (`RUSHPOINT_ALLOW_SHRINK=1`) honours the
   freshest anyway and records `reason: 'shrink-overridden'`.

*Why prefer the larger dataset rather than merely warning:* the harms are asymmetric. Wrongly
keeping a larger dataset costs one loud message and an env var; wrongly adopting a smaller one
destroys work and then rewrites every snapshot from it within 20 minutes. A warning printed into a
`concurrently` terminal is precisely the signal this incident proved nobody reads.

*Alternative considered:* refuse to start and demand a human choice. Rejected — a dev tool that
blocks on a prompt gets bypassed, and `dev:all` is often unattended.

*Compatibility:* `selectFreshestImport` stays exported and tested (back-compat, still correct for
its narrow question); `dev-emulator.mjs` switches to `selectImportSource`.

### D2 — Tier buckets are derived from epoch milliseconds, not the local calendar

`bucketOf(ts, unitMs) = Math.floor(ts / unitMs)`, `unitMs` of `3_600_000` (hour) / `86_400_000`
(day).

*Why:* `new Date(ts).getHours()` / `toDateString()` makes deletion depend on the host timezone and
on DST. Under a fall-back transition, local-hour bucketing merges two real hours into one bucket and
silently deletes an hour of history. Epoch-floor bucketing is monotonic, timezone-free and DST-free
by construction: 01:30 and 01:30-again are different instants and land in different buckets. This is
the decision that makes the DST case trivially correct rather than delicately correct.

*Trade-off:* a "day" is a fixed 86 400 000 ms window offset from the epoch, not local midnight. For
a dev safety net, "one snapshot per day, guaranteed" is what matters; aligning to a human midnight
would reintroduce the timezone dependency.

### D3 — Tier capacity is counted over occupied buckets, never over a window from `now`

The hourly tier keeps the newest snapshot of each of the H most recent distinct hour buckets **that
contain snapshots**, not "every snapshot in the last H hours".

*Why:* if capacity were measured against `Date.now()`, a loop restarted a day later would find every
surviving snapshot outside the window and delete the entire history on its first tick — destroying
the evidence at exactly the moment it is needed. Counting occupied buckets makes the policy a
function of the data alone.

*Consequence:* `planRetention` takes **no `nowMs` parameter at all**. That is deliberate, and is
itself the proof that no clock — forward, backward, or DST-shifted — can influence a deletion.

### D4 — Union-of-tiers keep, keep-biased tie-breaking; defaults recent 10 · hourly 24 · daily 14

A snapshot is kept if it qualifies for **any** tier; within a bucket the **newest** snapshot is the
representative (most data). Unparseable names, pinned snapshots and the single greatest-timestamp
snapshot are kept unconditionally, even with every capacity at zero.

Every ambiguity resolves toward retention: keeping one snapshot too many costs ~900 KB; keeping one
too few is what this change exists to prevent.

*Alternative considered:* strict single-tier assignment consuming a shared budget. Rejected — it
makes tier interaction order-dependent and introduces exactly the off-by-one class that is the whole
correctness risk here.

Defaults: `EMU_BACKUP_KEEP=10` (unchanged — the existing 20 min at 2-minute granularity),
`EMU_BACKUP_KEEP_HOURLY=24` (hourly back one day), `EMU_BACKUP_KEEP_DAILY=14` (daily back two
weeks). Worst case ≤ 48 snapshots ≈ **44 MB** at today's ~900 KB. Under this policy a bad dataset
swap would remain undoable for two weeks instead of 20 minutes.

### D5 — Disk cap: 512 MiB, oldest-first eviction, applied after the tiers

`EMU_BACKUP_MAX_BYTES` defaults to `536_870_912`. Eviction sorts the tier-retained set ascending by
timestamp and drops from the front until the total fits — draining the daily tier first, then
hourly, then recent, i.e. oldest-tier-first. The newest snapshot is never evictable, so the retained
set is never empty even with an absurd cap.

*Why 512 MiB:* ~11× the tier ceiling. It never binds in normal operation (so it cannot become a
silent second retention policy) and exists purely as the "snapshots got 10× bigger" disk backstop.
Sizes are passed in as bytes by the caller (a `fs.statSync` roll-up) so the function stays pure.

### D6 — Health is a pure function; the loop only formats it

`assessLoopHealth({ lastSuccessMs, nowMs, intervalMs, consecutiveFailures })` →
`'starting' | 'ok' | 'degraded' | 'stalled'`. Thresholds are multiples of the interval — `degraded`
past 2 intervals or ≥ 1 failure, `stalled` past 5 intervals or ≥ 3 consecutive failures — because
the interval is configurable and absolute seconds would be wrong for anyone who changes it.
Monotonicity in both inputs is asserted by a sweep in the test.

### D7 — How a human actually notices (the decision the mission asks to be stated)

Three layers, because the incident proves layer 1 alone does not work:

1. **Loud banner (stderr).** On `degraded`/`stalled` the loop writes a boxed multi-line
   `!!! BACKUP LOOP STALLED !!!` block naming the age of the last successful snapshot, repeated
   every tick. Catches someone already watching the terminal.
2. **Status file + failing exit code — the primary mechanism.**
   `.firebase/backups/STATUS.json` (deliberately *not* `backup-*`, per `listBackups()`'s prefix
   filter) is rewritten every tick. `node scripts/emulator-backup.mjs --status` renders it and
   **exits non-zero when stalled or missing**. This is the layer to rely on, because it turns "is
   the net alive?" into a check that fails rather than a line that scrolls.
3. **Next-start disclosure.** The status file outlives the loop, so the next emulator start can
   report "last successful snapshot was 14 h ago" instead of starting quietly on a fresh clock. This
   change writes and exposes the file and consumes it for the D0 interlock; wiring an explicit
   next-start warning is deferred with D9.

The honest answer is **layer 2**: a status command that exits non-zero, callable from
`playtest-forever.mjs`'s supervision cycle or as a manual pre-event check.

### D8 — Kill the silent-stop mechanism, not just its symptom

- **Re-entrancy gate.** Pure `canStartExport({ inFlight, ready, lastTs, nowTs, intervalMs })` wraps
  `canAttemptExport`; the loop holds an `inFlight` flag so overlapping `setInterval` ticks cannot
  stack exports against one emulator.
- **Export timeout.** `EMU_BACKUP_EXPORT_TIMEOUT_MS` (default 90 000, far above a ~1 s real export)
  kills the child and resolves the attempt as a failure, so a wedged export increments
  `consecutiveFailures` → `stalled` → banner instead of pending forever.

### D9 — Event-triggered snapshots: build the primitive, defer the wiring

`node scripts/emulator-backup.mjs --snapshot-now [--pin]` takes one snapshot and exits (non-zero if
the emulator is not ready). `--pin` writes a `PINNED` marker inside the snapshot folder; retention
treats pinned snapshots as tier-exempt (cap-evictable only).

**Recommendation, not built here:** call `--snapshot-now --pin` at the top of
`scripts/emulator-restore.mjs` and `seed:reset`. Both overwrite emulator data and both are exactly
where "I wish I had a snapshot from one second ago" happens — an import-driven overwrite is the
mechanism of this very incident. It is deliberately not wired because those scripts cannot be
executed to verify while the live stack is up, and a half-verified change to a destructive script is
worse than none.

## Test Strategy

**Lane:** pure logic only — a new `scripts/test-emulator-retention.ts`, auto-discovered by
`scripts/run-unit-tests.mjs` and matching the `ok(cond, msg)` / `passed`/`failed` / `process.exit`
house style of `scripts/test-emulator-backup.ts`. No emulator, no vitest, no fixture directory, no
filesystem: every case is a synthetic list of `{name, ts, bytes}`. **The real `.firebase/backups/`
and `C:\Users\savir\rushpoint-rescue\` are never read or written by the tests.**

RED first: the test file is written and run against the un-extended `lib/emulatorBackup.mjs`, where
the new imports do not exist — confirming failure for the right reason before any implementation.

`planRetention`:
- empty list; single snapshot; single snapshot with all capacities zero (still kept)
- recent-tier exactness at `keep`, `keep-1`, `keep+1` (the off-by-one)
- hourly/daily representative is the **newest** in its bucket
- timestamps exactly on an hour/day boundary and one millisecond either side
- input shuffled → identical output (order independence)
- clock-backwards snapshot appended last
- a DST-transition span, unaffected by bucket arithmetic
- a multi-day gap with no snapshots → nothing pruned for age alone
- unparseable name → always kept; a `STATUS.json`-like entry never disturbs the result
- pinned → tier-exempt but cap-evictable
- disk cap: under, exactly at, over, and smaller than one snapshot
- **invariants asserted on every case:** `keep ∪ prune === input`, `keep ∩ prune === ∅`, newest never
  pruned

`selectImportSource`: primary fresher; backup fresher; fresher-but-invalid loses; fresher-but-empty
loses; both invalid → null; single candidate → no guard; the **real incident numbers** (217 KB
primary vs 689 KB backup) with the primary made to look freshest → shrink guard selects the backup;
comparable sizes → no guard; `allowShrink` → freshest wins and is recorded; fallback timestamp
reported.

`assessLoopHealth` / `canStartExport` / `shouldStartBackupLoop`: never-succeeded fresh → `starting`,
then `degraded`, then `stalled`; interval-multiple boundaries (at / just under / just over);
failures alone force `stalled` despite a fresh success; monotonicity sweep; `canStartExport` false
while `inFlight` even when ready and due; loop start suppressed only by a recent heartbeat with a
live pid, never by a stale one or a dead pid, and always suppressed by the explicit opt-out.

**Gates:** `npm run typecheck`, `npm run lint`, `npm test`. `npm run e2e` and every other
emulator-touching gate are **not run** — they require starting or restarting the emulator, forbidden
while the live stack serves. No UI is touched, so `npm run i18n:check` does not apply.

## Risks / Trade-offs

- **[The prune rule deletes data — an off-by-one loses the backup you needed]** → the rule is pure,
  total and clock-free (D3), every ambiguity is keep-biased (D4), and the three structural
  invariants (partition, no overlap, newest-never-pruned) are asserted on *every* test case rather
  than as separate cases.
- **[Runtime behavior is unverified]** → the loop cannot be started here. Mitigated by keeping all
  new decision logic in pure functions that *are* verified and the imperative shell as thin as
  possible. Explicitly flagged in the report; the first real start needs a human to run `--status`
  and confirm `ok`.
- **[Backups-by-default could surprise an existing workflow]** → the only behavioral additions are a
  child process and periodic disk writes, both bounded, both opt-out-able; the heartbeat interlock
  prevents the double-loop wedge that `free-ports.mjs` was written to clean up.
- **[The substance guard could keep a stale dataset when a shrink was intended]** → announced loudly
  with both sizes and a named override (`RUSHPOINT_ALLOW_SHRINK=1`); the ratio is configurable and
  defaults to 0.5, so only *drastic* shrinks engage it.
- **[The status file could be mistaken for a snapshot]** → it is `STATUS.json`, outside the
  `backup-` prefix `listBackups()` filters on, with a test asserting retention is unaffected by such
  a name.
- **[More retained data grows disk usage]** → tier ceiling ~44 MB, absolute cap 512 MiB (D5).
- **[Noisy thresholds train people to ignore the banner]** → `degraded` needs > 2 intervals (> 4 min
  at defaults), `stalled` > 5 (> 10 min); a single slow export never trips them.
- **[Changing loop internals could regress the readiness gate]** → the hub probe, `isEmulatorReady`,
  `didExportSucceed` and `selectFreshestImport` are untouched and their existing tests in
  `scripts/test-emulator-backup.ts` must stay green.

## Migration Plan

No data migration. Existing `backup-<iso>` folders are understood unchanged and `--latest` keeps
working. `RUSHPOINT_BACKUP` changes meaning from opt-in to opt-out; the `playtest*` scripts keep
their explicit `BACKUP` process and the heartbeat interlock stops that becoming a duplicate. New
behavior takes effect on the **next** start — the running loop is not restarted by this change.
Rollback is reverting three script files; the only new state is the additive `STATUS.json`, safe to
delete.

## Open Questions

- Should `playtest-forever.mjs` fail its cycle (or log loudly) when `--status` exits non-zero? That
  is the strongest form of D7 layer 2, but it edits the supervisor of a currently-live stack.
- Should `--latest` prefer a *pinned* pre-destruction snapshot when restoring? It currently means
  "newest valid", which is the safer default.
- Should the substance guard also compare document counts rather than bytes? Bytes are available
  without parsing the export; a doc-count comparison would be more semantically precise ("0 games
  over 14") but requires reading Firestore export internals.
