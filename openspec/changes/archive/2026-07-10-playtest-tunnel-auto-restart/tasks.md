## 1. RED — failing pure-logic tests

- [x] 1.1 Add `scripts/test-tunnel-restart.ts` asserting `restartDelayMs`: `0 → baseMs`; grows `baseMs * 2**n`; caps at `maxMs`; honors custom `{baseMs,maxMs}`.
- [x] 1.2 In the same file assert `isQuickFailure`: `uptime < threshold → true`; `uptime === threshold → false`; `uptime > threshold → false`; default threshold applied when omitted.
- [x] 1.3 Run the file via tsx and confirm it FAILS (module `scripts/lib/tunnelRestart.mjs` not found) — RED.

## 2. GREEN — implement the pure helpers

- [x] 2.1 Create `scripts/lib/tunnelRestart.mjs` with pure `restartDelayMs(consecutiveQuickFailures, { baseMs = 1000, maxMs = 30000 } = {})` and `isQuickFailure(uptimeMs, thresholdMs = 10000)`. No I/O, no `Date.now()`.
- [x] 2.2 Run `node scripts/run-unit-tests.mjs` — new tunnel-restart assertions and all existing pure-logic tests pass (GREEN).

## 3. Wire auto-restart into the tunnel wrapper

- [x] 3.1 In `scripts/ngrok-tunnel.mjs` add a module-level `shuttingDown` flag; the SIGINT/SIGTERM handler sets it before killing the child.
- [x] 3.2 Extract child spawning into `startNgrok()`; on child `exit`, `process.exit` when `shuttingDown`, else compute `uptimeMs` (from a per-child start stamp), update a consecutive-quick-failure counter via `isQuickFailure`, log a reconnect line, and `setTimeout(startNgrok, restartDelayMs(counter))`.
- [x] 3.3 Keep the pre-spawn `config add-authtoken` hard-exit and the missing-config hard-exit unchanged (a real misconfig must still fail fast, not restart-loop).

## 4. Verify + gates

- [x] 4.1 Run `npm run typecheck` and `npm test` (pure-logic lane) — all green. (typecheck 5/5; aggregator 76/76 incl tunnel-restart 14/14; `node --check` on the wrapper parses.)
- [ ] 4.2 Run `npm run playtest:ngrok`; confirm links serve, then simulate a drop (kill the `ngrok` child process) and confirm the wrapper logs a reconnect, the tunnel comes back on the same domain, and the emulator/proxy/apps stay up (no stack teardown, no orphaned Java). — LEFT for the user's fresh-terminal launch (deferred to keep the environment clean before handoff).
