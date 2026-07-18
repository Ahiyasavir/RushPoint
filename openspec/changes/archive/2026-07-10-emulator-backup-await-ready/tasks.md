## 1. RED — failing pure-logic tests

- [x] 1.1 In `scripts/test-emulator-backup.ts`, add assertions for a new pure `isEmulatorReady(hubJson)`: null → false; `{}` → false; JSON missing `functions` → false; JSON with both `firestore` and `functions` present → true.
- [x] 1.2 In the same file, add assertions for a new pure `canAttemptExport({ ready, lastTs, nowTs, intervalMs })`: not ready → false even when due; ready + never-snapshotted → true; ready + within interval → false; ready + interval elapsed → true.
- [x] 1.3 Run `npm test` and confirm the new assertions FAIL (helpers not yet exported) — RED confirmed.

## 2. GREEN — implement the pure gate

- [x] 2.1 In `scripts/lib/emulatorBackup.mjs` add `isEmulatorReady(hubJson)` — returns true iff `hubJson` is an object whose emulator map/list includes both `firestore` and `functions`; false for null/undefined/partial.
- [x] 2.2 In the same lib add `canAttemptExport({ ready, lastTs, nowTs, intervalMs })` returning `ready === true && isSnapshotDue(lastTs, nowTs, intervalMs)` (reuse the existing `isSnapshotDue`).
- [x] 2.3 Run `npm test` — the new assertions and all existing emulator-backup assertions pass (GREEN).

## 3. Wire the readiness gate into the loop

- [x] 3.1 In `scripts/emulator-backup.mjs` add `probeHubReady()` — GET `http://<host>:<port>/emulators` (host/port from `FIREBASE_EMULATOR_HUB` env, else `127.0.0.1:4400`) via global `fetch` (fallback `node:http`), returning parsed JSON or null on any error.
- [x] 3.2 Replace the fixed `setTimeout(tick, 10_000)` first-fire with a bounded-backoff poll (~2s) that calls `probeHubReady()` + `isEmulatorReady(...)` until ready, emitting at most one "waiting for emulator…" line, then starts the cadence.
- [x] 3.3 Have each `tick` consult `canAttemptExport({ ready, lastTs, nowTs, intervalMs })` (re-probing readiness) so a not-ready blip skips the export instead of running it; keep the existing `setInterval` cadence, export, prune, and log unchanged after readiness.

## 4. Verify end-to-end + gates

- [x] 4.1 Run `npm run playtest:ngrok` (full stack WITH the backup component) and confirm the emulator reaches "All emulators ready", the fixed ngrok links serve (play/creator 200, functions reachable), the stack stays up, and after ~one interval a `[backup] wrote …` snapshot line appears with no stack crash.
- [x] 4.2 Run the required gates: `npm run typecheck`, `npm test`, `npm run lint` — all green.
- [x] 4.3 Stop the stack with Ctrl+C (clean exit) and confirm no orphaned Java emulator processes remain.
