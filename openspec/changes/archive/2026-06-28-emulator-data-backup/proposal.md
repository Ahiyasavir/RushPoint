## Why

When a creator self-hosts the full RushPoint stack on their own machine to run a real
game (e.g. ~15 participants via `npm run playtest`), the only thing protecting the live
game/run/team data is the emulator's `--export-on-exit`, which **only fires on a clean
Ctrl+C**. A power loss, OS crash, or killed process during the event loses every write
since the last clean shutdown — i.e. the entire game. There is currently no periodic
safety net.

## What Changes

- Add a **periodic, crash-safe snapshot loop** that exports the running emulator's data
  into rotating, timestamped backup folders (e.g. `.firebase/backups/<timestamp>/`) on a
  fixed interval while the stack is up — independent of the clean-exit export.
- Add **rotation** so only the most recent N snapshots are kept (older ones pruned),
  bounding disk use.
- Add a **documented restore path**: a command/flag that points the next emulator boot at
  the most recent good snapshot (or a chosen one) so an event can resume after a crash.
- Wire the snapshot loop into the dev/playtest run so it starts and stops with the stack;
  surface a log line each time a snapshot is written.
- Cover the pure timing/rotation/selection logic with unit tests (TDD): interval gating,
  "keep newest N / prune the rest", and "pick the most recent valid snapshot".

## Capabilities

### New Capabilities
- `emulator-data-backup`: periodic crash-safe snapshotting of local emulator data,
  bounded retention/rotation of snapshots, and selection of the most recent good snapshot
  for restore.

### Modified Capabilities
<!-- None. No spec-level behavior of existing capabilities changes; this is dev/ops tooling. -->

## Impact

- **Surfaces touched:** dev/ops scripting only — no callable, no shared types consumed by
  the backend at runtime, no creator-web/play-web, no `firestore.rules` change.
- **New code:** a `scripts/emulator-backup.mjs` (snapshot loop + rotation + restore-target
  selection), pure helpers it imports, and a `scripts/test-emulator-backup.ts` assertion
  script (auto-picked up by the `npm test` aggregator).
- **Wiring:** `scripts/dev-emulator.mjs` / the `playtest` flow start & stop the loop; a new
  npm script (e.g. `emulator:restore`) documents recovery. DEPLOY.md / the playtest docs
  note the backup + restore procedure.
- **No production impact:** this guards the **local emulator** only; Firebase Cloud already
  persists durably. Non-goal: replacing cloud hosting, backing up cloud Firestore, or
  changing any game/run/scoring behavior.
