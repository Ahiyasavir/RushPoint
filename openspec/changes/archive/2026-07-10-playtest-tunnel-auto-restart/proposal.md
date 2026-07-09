## Why

The ngrok tunnel process (`scripts/ngrok-tunnel.mjs`, the `TUNNEL` component of `npm run
playtest:ngrok`) exits whenever the underlying `ngrok` child exits — and `child.on('exit', code
=> process.exit(code))` propagates that straight up. Because the `TUNNEL` command is one member of
the `concurrently` group, its exit tears down the ENTIRE playtest stack (emulator, seed, proxy,
both Vite servers), which also strands orphaned Java emulator processes on their ports. ngrok on
some networks drops its session intermittently (e.g. a failed CRL fetch over IPv6), so a transient
tunnel blip that should self-heal instead kills a live playtest — dropping every tester mid-game.
The tunnel must be resilient: a dropped tunnel should reconnect, not collapse the stack.

## What Changes

- `ngrok-tunnel.mjs` **auto-restarts the `ngrok` child** on unexpected exit instead of exiting the
  wrapper, with capped exponential backoff, so a transient drop reconnects on the same fixed domain
  and the `concurrently` stack never sees the `TUNNEL` component die.
- The wrapper still exits cleanly on an intentional stop (SIGINT/SIGTERM) — Ctrl+C tears everything
  down as before.
- A pure, unit-tested backoff/decision helper (`scripts/lib/tunnelRestart.mjs`) so the restart
  timing and "quick-failure" reset logic are covered by `npm test` without spawning ngrok.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `playtest-links`: add a resilience requirement — the single-origin tunnel SHALL survive a dropped
  tunnel connection by restarting it, rather than exiting and tearing down the playtest stack.

## Impact

- `scripts/ngrok-tunnel.mjs` — replace `process.exit` on child exit with a backoff restart loop
  guarded by an intentional-shutdown flag.
- `scripts/lib/tunnelRestart.mjs` (new) — pure `restartDelayMs` + `isQuickFailure` helpers.
- `scripts/test-tunnel-restart.ts` (new) — pure-logic assertions (auto-picked up by the aggregator).
- Dev-tooling only: affects `npm run playtest:ngrok` reliability. No product code, callables,
  client, or Firestore rules. (The cloudflared `npm run playtest` tunnel is a single long-lived
  quick tunnel and is out of scope here.)
