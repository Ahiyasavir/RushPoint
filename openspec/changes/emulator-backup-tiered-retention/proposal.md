## Why

A real creator's game was lost from the local emulator and could not be recovered. The forensic
answer is not "the backups were too short" — it is that **for most sessions there were no backups at
all**, and that the import path can silently replace the whole database with a smaller dataset.

Verified in this working tree:

1. **`npm run dev:all` runs with ZERO backup protection.** `scripts/dev-emulator.mjs:98` starts the
   snapshot loop only when `RUSHPOINT_BACKUP` is `1`/`true`. `package.json`'s `dev:all` is
   `concurrently … EMU,SEED,CREATOR,PLAY` — no `BACKUP` process, and it never sets that variable.
   Only the `playtest*` scripts (`EMU,SEED,BACKUP,…`) enable it. Every ordinary dev session has been
   unprotected. **This is the headline.**
2. **The last clean export is 13 days old.** `.firebase/emulator-data/firebase-export-metadata.json`
   is dated **2026-07-09 18:52**, so `--export-on-exit` has not fired successfully since. The export
   path itself is fine (a manual `firebase emulators:export` against the live emulator succeeds) —
   sessions simply do not end with Ctrl+C. People close terminals. Cross-session continuity has
   therefore rested entirely on the rotating snapshots, which most sessions did not have.
3. **The import chooser can swap the entire dataset.** `selectFreshestImport`
   (`scripts/lib/emulatorBackup.mjs:94-101`) picks whichever of the primary export dir and the
   newest backup is "newer", comparing the primary's **file mtime** against the backup's **name
   timestamp** — two different events, not like for like — and applies **no substance check
   whatsoever**. Right now the primary dir holds 217 KB (`firestore_export` 170 KB, `auth_export`
   41 KB) against the newest backup's 689 KB (622 KB / 61 KB). Any event that touches the primary
   dir's mtime makes a dataset roughly a quarter the size win, and it silently becomes the new
   baseline. This is the mechanism by which games *and their creator identities* disappear together:
   a browser cache holds game docs under three creator uids present in **no** Auth export and **no**
   Firestore export on disk, and `deleteGame` never touches Auth — so those records were not
   deleted, they were **replaced**.
4. **Retention then destroys the recovery path — not the data.** Snapshots are *full* exports
   (`firebase emulators:export`), so `EMU_BACKUP_KEEP=10` does not age out old *data*: a game from
   hours earlier lives on in the newest snapshot as long as it is still in the live DB. What
   retention discards is old *states*. That is exactly what makes it fatal **after a swap**: within
   20 minutes (10 × 2 min) every snapshot has been rewritten from the replacement dataset and the
   originals `fs.rmSync`'d — no Recycle Bin, no undo. Retention did not cause the loss; it closed
   the only door out of it.
5. **The loop stops silently.** Directly observed twice. `.firebase/backups/` holds exactly ten
   folders, `backup-2026-07-22T18-20-05-188Z` … `backup-2026-07-22T18-38-05-390Z`, and nothing after
   — and during the investigation itself the loop went 16+ minutes without a snapshot while
   `emulator-backup.mjs` (PID 14756) was alive and the emulator was up. Its only failure signal is
   one grey `console.warn` (`scripts/emulator-backup.mjs:127`); a loop that stops ticking says
   nothing at all. This repo already killed orphaned backup loops by cmdline for wedging the
   emulator (`scripts/free-ports.mjs:24-31`).

So: unprotected sessions, a 13-day-stale baseline, an import that can silently swap the dataset, and
a 20-minute window in which the evidence is shredded — with no signal when the net is down.

## What Changes

**Backups are on for every emulator session, not just playtests.**
- The snapshot loop starts by default whenever the emulator starts. Opting *out* becomes the
  explicit act, instead of opting in being a thing nobody remembered to do.
- Starting an emulator when a snapshot loop is already running does not start a second one — the
  loop's own published heartbeat is the interlock, so `playtest` (which starts its own `BACKUP`
  process) does not end up with two loops racing exports against one emulator.
- Cost, stated plainly: one `firebase emulators:export` child every 2 minutes per dev session
  (~1 s, ~700–900 KB written), plus bounded disk. That is the price of the safety net existing.

**Importing can no longer silently replace the database with a lesser dataset.**
- The choice between the primary export and the newest backup uses **like-for-like** timestamps, and
  a candidate that is absent, invalid or empty can never win.
- A **substance guard**: when the freshest candidate is dramatically smaller than the other valid
  candidate, the system refuses to silently adopt it — it announces the discrepancy loudly and
  prefers the substantial dataset, with an explicit override for the case where the shrink is real.
  "You are about to import a dataset with 0 games over one with 14" becomes something you are told,
  not something you discover days later.

**Snapshot history becomes tiered (grandfather-father-son), not a flat 20-minute window.**
- Recent, hourly and daily tiers coexist, so a *state* from hours or days ago survives — meaning a
  bad swap can still be undone tomorrow rather than only within 20 minutes.
- This is a **recovery-window** improvement, deliberately not sold as the fix for the loss itself:
  the fixes for that are backups-by-default and the import guard.
- Retention is decided by a **pure function of (snapshot timestamps, policy)** — no clock reads, no
  filesystem — because an off-by-one in a prune rule silently deletes the one backup that mattered.
  Retention is computed relative to the snapshots themselves, never to "now", so a long gap with no
  snapshots can never age out history.

**The loop's liveness becomes observable.**
- The loop publishes a status/heartbeat file with its last-success timestamp, consecutive-failure
  count and a self-assessed health level (`ok` / `degraded` / `stalled`).
- A degraded or stalled loop announces itself with a loud repeated banner, and its state is
  machine-readable through a status command that **exits non-zero** when the net is down.
- A hung export can no longer freeze the loop: exports are bounded by a timeout and overlapping
  ticks are refused, so "process alive, no snapshots" becomes self-reporting instead of invisible.

**Disk footprint is explicitly bounded.**
- Deeper history keeps more states, so the total is capped; when the cap is hit the oldest snapshots
  are evicted first (draining the coarsest, oldest tier before recent ones), and the newest snapshot
  is never evictable. The safety net can neither fill the disk nor empty itself.

**Event-triggered snapshots become possible.**
- A one-shot "snapshot now" mode (optionally *pinned*, i.e. exempt from tier pruning) so a
  destructive operation can capture state immediately before it runs, instead of hoping a timer tick
  landed recently.

### Non-goals

- **No product behavior changes.** No callables, no Firestore rules, no `packages/shared` types, no
  creator-web, no play-web, no UI, no i18n.
- **Not a production backup system.** Local/dev + playtest emulator safety net only.
- **Does not change what a snapshot contains** or how it is produced. `firebase emulators:export`
  stays the mechanism, and the hub readiness gate that stops mid-boot exports from wedging Firestore
  is preserved exactly.
- **Does not make graceful shutdown work better.** `--export-on-exit` stays as-is; the design simply
  stops depending on it, because terminals get closed.
- **Does not add external alerting** (email/Slack/push). Local: loud banner, status file, exit code.
- **Does not modify the destructive scripts** (`seed:reset`, `emulator-restore.mjs`). The one-shot
  snapshot primitive they should call is built; wiring it is recommended, not done, because those
  scripts cannot be executed to verify while the live stack is serving.
- **Does not recover the lost game.** Those snapshots are gone.

## Capabilities

### New Capabilities
- `emulator-backup-liveness`: The snapshot loop continuously publishes its own health — last
  successful snapshot, consecutive failures, and a self-assessed `ok`/`degraded`/`stalled` level —
  and makes a stopped or failing safety net impossible to miss, both to a human watching the
  terminal and to a script that asks for its status. It also covers the loop running by default for
  every emulator session, with the heartbeat acting as the single-instance interlock.
- `emulator-import-safety`: Choosing which dataset to boot the emulator from is a guarded decision:
  like-for-like freshness comparison, invalid/empty candidates disqualified, and a substance guard
  that refuses to silently replace a substantial dataset with a dramatically smaller one.

### Modified Capabilities
- `emulator-data-backup`: the **Bounded snapshot retention** requirement changes from "keep the
  newest N" to a tiered recent/hourly/daily policy with an absolute disk cap, so a recoverable
  *state* history extends to days rather than ~20 minutes while total footprint stays bounded. Adds
  an event-triggered (one-shot, optionally pinned) snapshot alongside the interval-driven ones. The
  readiness gate and restore-selection requirements are unchanged.

## Impact

- **Surfaces touched:** `scripts/` only — dev/ops infrastructure. **No** shared types, **no**
  callables, **no** Firestore rules, **no** creator-web/play-web, **no** i18n.
- **Files:** `scripts/lib/emulatorBackup.mjs` (new pure retention / health / import-choice
  functions), `scripts/emulator-backup.mjs` (loop wiring, status file, banner, CLI modes),
  `scripts/dev-emulator.mjs` (backups on by default, guarded import), and a new
  `scripts/test-emulator-retention.ts` picked up by the `npm test` aggregator.
- **New env vars (all optional, defaulted):** `EMU_BACKUP_KEEP_HOURLY`, `EMU_BACKUP_KEEP_DAILY`,
  `EMU_BACKUP_MAX_BYTES`, `EMU_BACKUP_EXPORT_TIMEOUT_MS`, `RUSHPOINT_ALLOW_SHRINK`.
  `RUSHPOINT_BACKUP` inverts meaning: it is now an opt-**out** (`0`/`false`), and
  `EMU_BACKUP_KEEP` / `EMU_BACKUP_INTERVAL_MS` keep their current meaning (the recent tier).
- **Backwards compatibility:** snapshot folder naming (`backup-<iso>`) is unchanged, so snapshots
  already on disk are understood by the new policy and `--latest` restore keeps working.
- **Risk:** the prune rule deletes data. Mitigated by making it pure and total (every input maps to
  an explicit keep/prune decision), by biasing every ambiguity toward *keep*, and by hard invariants
  the tests assert: the newest snapshot is never pruned, an unparseable name is never pruned, and
  keep ∪ prune is exactly the input with no overlap.
- **Testing:** pure-logic lane only (`scripts/test-emulator-retention.ts`, no emulator, synthetic
  fixtures only — the real `.firebase/backups/` is never touched). The loop's runtime behavior
  cannot be exercised here because a live playtest stack is serving from this tree and must not be
  restarted; that is called out explicitly rather than assumed.
