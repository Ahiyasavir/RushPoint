## Why

The crash-safe emulator backup loop fires its **first** `firebase emulators:export` on a
fixed 10-second timer (`setTimeout(tick, 10_000)` in `scripts/emulator-backup.mjs`). When the
emulator suite takes longer than that to finish booting (importing auth accounts + loading the
~66 Cloud Functions), the export hits a **mid-boot** emulator, wedges Firestore, and cascade-kills
the entire `npm run playtest:ngrok` / `npm run playtest` stack — every `concurrently` component
dies and orphaned Java emulator processes are left holding ports, which then poison the next
launch. This is the recurring "launch freezes / backup loop wedging the emulator" failure, and it
is timing-dependent: it stays hidden when boot is fast and reappears whenever the machine is under
load. The backup must never run against an emulator that isn't fully ready.

## What Changes

- The backup loop **gates its first export on a real emulator-readiness signal** (the emulator
  Hub reporting the suite up) instead of a blind 10-second delay. Until the emulator is ready it
  polls with bounded backoff; it takes its first snapshot only once ready.
- A **pure, unit-tested readiness predicate** is added to `scripts/lib/emulatorBackup.mjs` so the
  gating decision (ready? due? attempt export?) is testable without an emulator, matching the
  existing pure-logic lane.
- No change to the snapshot cadence, naming, rotation/retention, or restore selection — only
  *when the first export is allowed to start* changes.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `emulator-data-backup`: the "Periodic crash-safe snapshots" behavior gains a readiness
  precondition — the loop SHALL NOT attempt an export until the emulator stack is fully ready,
  so a snapshot can never wedge a still-booting emulator.

## Impact

- `scripts/emulator-backup.mjs` — replace the fixed 10s first-tick timer with a readiness probe +
  bounded-backoff poll of the emulator Hub before the first export; unchanged periodic cadence after.
- `scripts/lib/emulatorBackup.mjs` — add a pure readiness/gating helper (no I/O, no `Date.now()`).
- `scripts/test-emulator-backup.ts` — extend the existing pure-logic assertions to cover the gate.
- No product code, no callables, no client surface, no Firestore rules. Dev-tooling only; affects
  `npm run playtest` and `npm run playtest:ngrok` reliability.
