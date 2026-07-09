## Context

`ngrok-tunnel.mjs` spawns `ngrok http <port> --domain <fixed>` and wires
`child.on('exit', code => process.exit(code ?? 0))`. In a `concurrently` group without
`--kill-others`, one command exiting still collapses the run in practice (the parent returns
non-zero and siblings are torn down), and — critically — the detached Firestore/Functions JVMs
survive as orphans that block the next launch. ngrok's session can drop transiently (observed:
`failed to fetch CRL … crl.ngrok-agent.com` over IPv6, "connection forcibly closed"), so a blip
that ngrok would otherwise reconnect from instead ends the whole playtest.

## Goals / Non-Goals

**Goals:**
- A dropped tunnel reconnects automatically on the same fixed domain; the `TUNNEL` wrapper process
  stays alive so `concurrently` never sees it exit.
- Ctrl+C / SIGTERM still stops cleanly (no restart during intentional shutdown).
- Backoff prevents a tight crash loop if ngrok can't connect at all; it resets after a healthy run
  so a single late drop doesn't inherit a huge delay.
- Restart timing is pure and unit-tested.

**Non-Goals:**
- Not changing the cloudflared `npm run playtest` path (single quick tunnel, different lifecycle).
- Not fixing ngrok's CRL/IPv6 fetch itself (an ngrok/network issue we can't control) — we make the
  wrapper survive it.
- No change to the printed links, domain, or proxy routing.

## Decisions

**1. Restart the child on unexpected exit; exit the wrapper only on intentional stop.**
A module-level `shuttingDown` flag is set by the SIGINT/SIGTERM handler. `startNgrok()` spawns the
child and, on its `exit`, either `process.exit` (when `shuttingDown`) or schedules another
`startNgrok()` after a backoff delay. The wrapper process itself never exits on a tunnel drop, so
the `concurrently` `TUNNEL` slot stays occupied and the stack lives.

**2. Capped exponential backoff with a health reset (pure, testable).**
`scripts/lib/tunnelRestart.mjs`:
- `restartDelayMs(consecutiveQuickFailures, { baseMs = 1000, maxMs = 30000 })` → `min(maxMs,
  baseMs * 2 ** consecutiveQuickFailures)`. First restart is quick (~1s), backing off to 30s if
  ngrok keeps failing immediately.
- `isQuickFailure(uptimeMs, thresholdMs = 10000)` → `uptimeMs < thresholdMs`. If the tunnel had
  been up longer than the threshold, the drop is treated as healthy-then-dropped: reset the
  consecutive-failure counter so the reconnect is immediate. Only rapid back-to-back failures grow
  the delay.

**3. Impure orchestration stays in the `.mjs`.**
The `.mjs` tracks `startedAt` per child, computes `uptimeMs` on exit, updates the counter via
`isQuickFailure`, and schedules the next start via `restartDelayMs`. It logs each restart
(`[ngrok] tunnel exited (code N) — reconnecting in Xs…`) so the console shows what happened.

## Risks / Trade-offs

- **Flapping ngrok** (drops every few seconds) yields intermittent 404s while it reconnects, but
  the stack + everyone's session survive — strictly better than the current total collapse.
- **A genuinely bad authtoken/domain** would restart-loop; the cap (30s) bounds the noise, and the
  existing pre-spawn `config add-authtoken` failure still hard-exits before the loop starts, so a
  misconfig is still surfaced immediately rather than masked.
