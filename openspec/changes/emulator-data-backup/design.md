## Context

`scripts/dev-emulator.mjs` boots the Firebase Emulator Suite with
`--export-on-exit "<DATA_DIR>"` and `--import "<DATA_DIR>"` where
`DATA_DIR = .firebase/emulator-data`. The export **only runs on a clean shutdown** (the
script forwards SIGINT/SIGTERM so Ctrl+C triggers it). If the process is `kill -9`'d, the
OS crashes, or power is lost mid-event, nothing since the last clean exit is on disk.

Firebase exposes `firebase emulators:export <dir> --force` which snapshots a **running**
emulator's data to an arbitrary directory without stopping it. That is the primitive this
change builds on: call it on a timer into rotating folders.

This is dev/ops tooling. It touches no callable, no `firestore.rules`, no shared runtime
types, and neither web app — so the server-write-only / FIRESTORE_PATHS / answer-key-secrecy
/ merge-array footguns do not apply here. The one hard rule that does: keep the snapshot
loop from interfering with the clean-exit export (don't write into `DATA_DIR` itself).

## Goals / Non-Goals

**Goals:**
- A timer-driven snapshot of the live emulator into `.firebase/backups/<timestamp>/` so a
  crash loses at most one interval of writes.
- Bounded retention: keep newest N, prune the rest.
- A documented, default-newest restore path to boot the next session from a snapshot.
- Pure timing/rotation/selection logic unit-tested (TDD) before any wiring.

**Non-Goals:**
- Backing up or restoring **cloud** Firestore (cloud already persists durably).
- Replacing cloud hosting for paid/real events — this only hardens the local-server case.
- Continuous/streaming WAL-style backup; interval snapshots are sufficient for ~15 users.
- Any change to game/run/scoring behavior or to the clean-exit export already in place.

## Decisions

**1. Snapshot via `firebase emulators:export … --force` on a `setInterval`, not a filesystem copy of `DATA_DIR`.**
The live emulator holds data in memory and only flushes on export; copying `DATA_DIR`
mid-run would capture a stale/partial snapshot. The official export is the correct,
consistent primitive. Alternative considered (raw `cp -r`) rejected for inconsistency.

**2. Snapshots go to a separate `.firebase/backups/` tree, never into `DATA_DIR`.**
Keeps the periodic backups orthogonal to the clean-exit export so the two can't corrupt
each other, and makes rotation a simple "list/sort/prune the backups dir" operation.

**3. Split into pure helpers + a thin runner, so the logic is unit-testable without a clock, FS, or emulator.**
New `scripts/lib/emulatorBackup.mjs` exports pure functions:
  - `isSnapshotDue(lastTs, nowTs, intervalMs)` → boolean (interval gating)
  - `snapshotName(nowTs)` → sortable timestamp folder name (caller passes the time — no
    `Date.now()` inside, mirroring the workflow-script discipline so tests are deterministic)
  - `selectSnapshotsToPrune(names, keepN)` → string[] (oldest beyond N)
  - `selectRestoreTarget(entries)` → name | null, where each entry is `{name, valid}`;
    returns the newest `valid` one (validity = presence of
    `firebase-export-metadata.json`, matching the import check already in dev-emulator.mjs)
The runner `scripts/emulator-backup.mjs` owns the impure shell: `setInterval`, spawning the
export, reading the backups dir, deleting pruned folders, logging each snapshot path.

**4. Wire start/stop into `scripts/dev-emulator.mjs` rather than a separate concurrently lane.**
The backup loop must start only after the emulator is up and stop when it goes down; owning
it in the same parent process that already spawns/forwards-signals to the emulator is the
simplest correct lifecycle. Gate it behind an env flag (e.g. `RUSHPOINT_BACKUP=1`, on by
default for `playtest`, off for plain `dev:all` to avoid noise) so day-to-day dev isn't
spammed with snapshots.

**5. Restore = a new `emulator:restore` npm script** that runs `selectRestoreTarget` over
`.firebase/backups/`, copies the chosen snapshot into `DATA_DIR` (so the existing
`--import` path picks it up), and prints what it restored — or exits non-zero if none found.

## Test Strategy

Pure logic is the whole testable core, per the proposal. **TDD via a new
`scripts/test-emulator-backup.ts`** (auto-discovered by `scripts/run-unit-tests.mjs`, so
`npm test` runs it). RED first — write these failing assertions, then implement the helpers:
- `isSnapshotDue`: false when `now - last < interval`; true at/after the interval; true when
  `lastTs` is null (no snapshot yet).
- `snapshotName`: produces lexicographically sortable names that sort in chronological order
  for increasing timestamps; deterministic for a fixed input.
- `selectSnapshotsToPrune`: returns the oldest `len - keepN` names when over the limit;
  returns `[]` when at/under the limit; handles `keepN` ≥ count.
- `selectRestoreTarget`: newest valid entry; skips newest-but-invalid in favor of an older
  valid one; returns null when none valid / empty list.

No emulator, clock, or FS needed — time and directory listings are passed in as arguments.
The runner/wiring (`emulator-backup.mjs`, dev-emulator hook, restore script) is impure I/O
verified by a manual run: start the stack with the flag, confirm timestamped folders appear
and rotate, `kill -9` the process, run `emulator:restore`, reboot, confirm data is back.
Standard gates (`typecheck`, `lint`, `npm test`, `creator:build`, `e2e`) must stay green;
`e2e` is unaffected since no callable changes.

## Risks / Trade-offs

- **Export under load briefly competes with the live emulator for I/O.** → ~15 users +
  a multi-minute interval is negligible; interval is configurable if it ever bites.
- **A snapshot could be interrupted mid-write (crash during export), leaving a partial folder.**
  → `selectRestoreTarget` validates via `firebase-export-metadata.json` and falls back to
  the previous good snapshot, so a torn newest snapshot never blocks restore.
- **Windows file locking / path quoting** (primary dev OS). → reuse the same quoting and
  `shell: true` spawn pattern already proven in `dev-emulator.mjs`; prune by deleting whole
  folders, not individual locked files.
- **Flag defaults could surprise.** → document the `RUSHPOINT_BACKUP` flag and the restore
  procedure in DEPLOY.md / playtest docs; log clearly on each snapshot and on restore.

## Migration Plan

Additive, no rollback concern: new scripts + an opt-in flag. To roll back, unset the flag
(loop never starts) — the existing clean-exit export is untouched. No data migration; the
backups directory is created on first snapshot.

## Open Questions

- Default interval and `keepN` (proposed: 2 min interval, keep 10 — ~20 min of history).
  Confirm during apply or leave as documented defaults overridable by env.
