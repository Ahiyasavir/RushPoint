# Design — Local playtest with shareable real links

## Current behavior (authoritative refs)

- `npm run dev:all` boots EMU + SEED + CREATOR (:5180) + PLAY (:5181) — `localhost` only.
- `scripts/proxy.mjs` already centralizes emulator paths under one origin (Firestore 8080, Auth 9099,
  Functions 5001, Storage 9199) but its **fallback target is :8081 ("Mobile PWA", v1)** and it does not
  distinguish creator vs play. `dev:all:tunnel` still boots `mobile:web` + `admin` (archived v1).
- Clients hardcode `127.0.0.1` for all four emulator connections
  (`apps/*/src/services/firebase.ts`), so only the host machine can reach the backend.
- Seed creates a demo creator, the "Old City Treasure Hunt" game, a **live run + access code**.

## Approach

### Pure helpers → `packages/shared/src` (the TDD lever)

```ts
resolveEmulatorHost(env: { VITE_EMULATOR_HOST?: string }, origin?: string): string
  // playtest (VITE_EMULATOR_HOST === 'origin') + origin given → the origin's hostname;
  // explicit host → that host; else → '127.0.0.1' (back-compat default).

resolveProxyTarget(url: string): { port: number; label: string }
  // firestore/identitytoolkit|securetoken/functions/storage → emulator ports;
  // '/creator' prefix → 5180 (creator-web); default → 5181 (play-web).

buildPlaytestLinks(baseUrl: string, accessCode?: string): { creatorUrl: string; joinUrl: string }
  // creatorUrl = `${baseUrl}/creator`; joinUrl = `${baseUrl}/?code=${accessCode}` (or `${baseUrl}/` if none)
```

Tested in `scripts/test-playtest-links.ts` (no network): host resolution for the three env cases;
proxy routing for each emulator path + creator prefix + play default; link building with/without a code.

### Orchestration → `npm run playtest`

`concurrently`: EMU + SEED + CREATOR + PLAY (Vite `server.host = true`, 0.0.0.0) + the rewritten
proxy on :3000 + `cloudflared tunnel --url http://localhost:3000`. Once the tunnel URL is up,
`scripts/print-playtest-links.mjs` reads it + the seeded access code and prints:

```
🎮  Creator console : https://<tunnel>/creator
🔗  Join a game     : https://<tunnel>/?code=<ACCESSCODE>
```

### Emulator host wiring

`apps/*/src/services/firebase.ts`: replace the hardcoded `127.0.0.1` with
`resolveEmulatorHost(import.meta.env, window.location.origin)`. In playtest the build sets
`VITE_EMULATOR_HOST=origin`, so remote clients connect to the emulator through the same tunnel origin
(the proxy routes those paths to the local emulator). Local `dev:all` keeps the `127.0.0.1` default.

## Test strategy (TDD)

- **Pure (RED first)** → `scripts/test-playtest-links.ts`: `resolveEmulatorHost`, `resolveProxyTarget`,
  `buildPlaytestLinks` cases above.
- **Manual (runbook)** → `npm run playtest`; open the printed creator link on the laptop and the join
  link on a phone over cellular (not the same WiFi) — the phone joins the seeded run and plays.
- No e2e change (no callable).

## Conventions / footguns respected

- Keeps the `127.0.0.1` default for normal dev (the documented IPv6-safe local path) — playtest only
  overrides it via env.
- One public origin (cloudflared) avoids per-port CORS/cookie issues; the proxy handles WS upgrade
  (already in `proxy.mjs`) for Vite HMR + Firestore streams.
- Pairs with `free-mode` (#63): the test group launches/plays with no payment wall.
