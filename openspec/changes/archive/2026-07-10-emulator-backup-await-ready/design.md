## Context

`scripts/emulator-backup.mjs` runs as the `BACKUP` component of the `playtest` / `playtest:ngrok`
concurrently stacks. It starts after `wait-on tcp:8080` (Firestore port open) and then schedules
its first export with `setTimeout(tick, 10_000)`. But an open Firestore port is **not** the same
as a ready emulator: the suite still has to import auth accounts and load ~66 Cloud Functions,
which routinely takes longer than 10s under load. `firebase emulators:export` against that
mid-boot state wedges Firestore, and because the sibling components share the concurrently group,
the whole stack collapses and leaves orphaned Java processes on the ports.

`wait-on tcp:8080` fires too early precisely because the port opens before the suite is ready. The
authoritative "everything is up" signal is the **emulator Hub** (default `127.0.0.1:4400`), which
serves `GET /emulators` — a JSON map of every running emulator once the suite has finished
starting. That is the same host/port `firebase emulators:export` itself talks to.

## Goals / Non-Goals

**Goals:**
- The first export never runs against a not-yet-ready emulator (eliminates the cascade-kill).
- Preserve the crash-safe periodic snapshot behavior, cadence, naming, rotation, and restore
  selection exactly as they are today.
- Keep the readiness/gating decision in the pure, unit-tested lib so it is covered by `npm test`
  without needing a live emulator.

**Non-Goals:**
- No change to snapshot interval, folder naming, retention count, or restore logic.
- Not fixing the sibling teardown behavior of concurrently (out of scope; the root cause is the
  premature export, and that is what we remove).
- No product code, callables, client, or Firestore-rules changes.

## Decisions

**1. Readiness signal = emulator Hub `/emulators` returns the expected emulators.**
Before the first export the loop polls `http://<HUB_HOST>:<HUB_PORT>/emulators`. Ready is defined
as: HTTP 200 **and** the parsed JSON contains the `firestore` and `functions` emulators (functions
being last to load, its presence means boot is effectively complete). Host/port come from
`FIREBASE_EMULATOR_HUB` if set, else default `127.0.0.1:4400` (matches the emulator defaults and
`firebase.json`). This mirrors what `emulators:export` connects to, so if the probe passes the
export is safe.

**2. Pure gating predicate in `scripts/lib/emulatorBackup.mjs` (testable).**
Add `canAttemptExport({ ready, lastTs, nowTs, intervalMs })` → boolean:
`ready === true && isSnapshotDue(lastTs, nowTs, intervalMs)`. Also add a pure
`isEmulatorReady(hubJson)` that takes the parsed Hub response (or null) and returns whether the
required emulators are present. Both are pure (no I/O, no `Date.now()`), so they extend the
existing `scripts/test-emulator-backup.ts` assertion lane directly.

**3. Impure orchestration stays in the `.mjs`.**
`emulator-backup.mjs` gains a small `probeHubReady()` (a `fetch`/`http.get` to the Hub returning
parsed JSON or null on any error) and a bounded-backoff wait loop that calls `isEmulatorReady`
until true before the first `tick`. After readiness, the existing `setInterval` cadence is
unchanged; each `tick` additionally consults `canAttemptExport` so a not-ready blip is skipped
rather than exported. The 10s blind `setTimeout` is removed.

**4. Backoff is bounded and quiet.**
Poll every ~2s; on each failed probe do nothing (no export, no noisy log). Emit a single
"waiting for emulator…" line at most once so the console isn't spammed. There is no hard timeout —
if the emulator never comes up the loop simply never exports, which is strictly safer than the
current crash.

## Risks / Trade-offs

- **Hub host/port drift.** If a future `firebase.json` moves the Hub, the probe must follow. Mitigated
  by reading `FIREBASE_EMULATOR_HUB` first and defaulting to the documented `127.0.0.1:4400`.
- **Readiness heuristic.** Requiring `firestore` + `functions` in `/emulators` is a heuristic for
  "fully booted." It is conservative (functions load last); worst case it waits slightly longer,
  which only delays the first snapshot — it never causes the crash it replaces.
- **`fetch` availability.** Node 20+ has global `fetch`; the repo already targets Node 20. Fall back
  to `node:http` `get` if needed to avoid any runtime assumption. Pure logic is unaffected either way.
