# Playtest — run the full stack and share two links

`npm run playtest` boots the whole v2 stack locally and exposes it through a single
public tunnel URL, so a remote test group can join a seeded run from their phones
over cellular — no deploy, no payment wall (pairs with free mode).

## Run it

```bash
npm run playtest
```

This starts (via `concurrently`, after a port cleanup):

| Name | What |
|---|---|
| **EMU** | Firebase Emulator Suite (Firestore 8080 · Auth 9099 · Functions 5001 · Storage 9199) |
| **SEED** | seeds the demo creator + "Old City Treasure Hunt" game + a live run & access code (idempotent) |
| **CREATOR** | creator-web dev server on `0.0.0.0:5180` |
| **PLAY** | play-web dev server on `0.0.0.0:5181` |
| **PROXY** | single-origin reverse proxy on `:3000` ([scripts/proxy.mjs](scripts/proxy.mjs) → `resolveProxyTarget`) |
| **TUNNEL** | `cloudflared` exposing `http://localhost:3000` at a public `*.trycloudflare.com` URL |

## Share the links

Once `cloudflared` prints its `https://<sub>.trycloudflare.com` URL, turn it into the
two shareable links:

```bash
node scripts/print-playtest-links.mjs https://<sub>.trycloudflare.com
```

It resolves the seeded access code from the emulator and prints:

- **Creator console (you):** `https://<sub>.trycloudflare.com/creator`
- **Join link (testers):** `https://<sub>.trycloudflare.com/?code=<ACCESS_CODE>`

Open the creator link on your laptop; send the join link to the test group. Their
phones connect to the backend through the same tunnel automatically —
`resolveEmulatorHost` ([packages/shared/src/playtest.ts](packages/shared/src/playtest.ts))
detects the remote origin and points the Firebase SDK at the tunnel host (normal
`npm run dev:all` is unchanged — it stays on `127.0.0.1`).

## Reset

```bash
npm run seed:reset   # re-seed a fresh run + access code
```

> Stop with **Ctrl+C** so the emulator persists its data via `--export-on-exit`.
