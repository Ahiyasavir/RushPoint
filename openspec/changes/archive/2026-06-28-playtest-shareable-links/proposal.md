# Proposal — Local playtest with shareable real links

## Why

To validate this release with a real test group, the whole app must **run on the developer's own
computer** yet be reachable by other people's phones via a **real link** — one for the game creator
and one to join a game. Today `npm run dev:all` serves the v2 apps only on `localhost` (unreachable
from other devices), and the existing tunnel script (`dev:all:tunnel` + `scripts/proxy.mjs`) is
**stale** — it still boots the archived v1 `mobile`/`admin` apps and routes its fallback to port 8081,
not the v2 `creator-web` (:5180) / `play-web` (:5181). The clients also **hardcode `127.0.0.1`** for
the Firebase emulator connections, so a remote device can never reach the backend.

This change delivers a **one-command playtest**: the full v2 stack runs locally, is exposed through a
single public HTTPS origin (cloudflared), and prints **two real links** a test group can open — the
**creator console** and a **join-a-game** page — all powered by the local emulator with seed data.

## What Changes

> Observable behavior. A DevEx/runtime capability; no game/scoring logic changes.

- `npm run playtest` boots the v2 stack (emulator + seed + creator-web + play-web) behind a reverse
  proxy on one origin and a cloudflared tunnel, then **prints a creator link and a join link**.
- The Firebase emulator host becomes **configurable** (`VITE_EMULATOR_HOST`, default `127.0.0.1`); in
  playtest the clients connect to the emulator **through the same tunnel origin**, so remote phones
  reach Firestore/Auth/Functions/Storage.
- The reverse proxy (`scripts/proxy.mjs`) is updated to route the **v2** apps (creator + play) and the
  emulator paths under one origin — replacing the stale v1 mobile/admin routing.
- Vite dev servers bind to `0.0.0.0` (LAN-reachable) so a same-WiFi fallback works without a tunnel.
- The printed **join link** carries `?code=<accessCode>` (from the seeded live run) so testers land
  directly on the join screen; the **creator link** opens the creator console.

## Capabilities

### New Capabilities
- `playtest-links`: a one-command local playtest that runs the full v2 stack on the developer's
  machine and exposes a real public creator link + join link for a remote test group.

### Modified Capabilities
<!-- The client emulator-connection becomes host-configurable instead of hardcoded 127.0.0.1. -->

## Surfaces touched

- **Scripts:** new `npm run playtest` orchestrator; rewrite `scripts/proxy.mjs` route table for the v2
  apps; a `scripts/print-playtest-links.mjs` that resolves the tunnel URL + seeded access code and
  prints the two links.
- **Clients:** `apps/*/src/services/firebase.ts` read `VITE_EMULATOR_HOST` (default `127.0.0.1`) and,
  in playtest, derive the emulator host from the page origin. Vite `server.host = true` (0.0.0.0).
- **shared:** pure helpers `resolveEmulatorHost(env, origin)`, `resolveProxyTarget(url)`,
  `buildPlaytestLinks(baseUrl, accessCode?)` — the TDD lever.
- **Docs:** a short `PLAYTEST.md` runbook (run it, share the links, reset seed data).
- **No callable, no Firestore rules, no game logic** changes. Best paired with `free-mode` (#63) so
  the test group can launch/play with no payment.

## Non-goals

- **No production deploy** — this is a local-first playtest, not the `firebase deploy` path (that
  Firebase-Hosting staging remains a separate, documented option for longer/stable tests).
- **No custom domain / stable URL** — cloudflared quick-tunnel URLs are ephemeral per session.
- **No multi-developer shared backend** — the emulator data is local to the one machine running it.
- **No auth-provider change** — creators sign up against the emulator auth (any email works locally).
