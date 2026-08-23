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

## ⚡ Fast mode (recommended for real events) — `npm run playtest:prod`

`npm run playtest` / `playtest:ngrok` tunnel the **Vite dev servers**, which ship the
app as hundreds of unbundled ES modules — one HTTP request each. Over a free tunnel
(ngrok/cloudflared) every one of those hundreds of requests pays the relay latency, so
first load crawls.

`npm run playtest:prod` instead serves **pre-built** bundles with `vite preview` behind
the same proxy + the fixed **ngrok** domain. That collapses hundreds of round-trips into
~10 hashed, gzipped, cacheable bundles — dramatically faster over the tunnel, same
backend, same links.

It does **not** build for you. Build first:

```bash
npm run playtest:build       # → apps/*/dist-playtest  (mode: playtest)
npm run playtest:prod        # serve those bundles + ngrok
```

`playtest:prod` (and `playtest:ngrok`) tunnel through **ngrok**, which needs a repo-root
`.tunnel.env` (never committed) with `NGROK_AUTHTOKEN=…` and
`NGROK_DOMAIN=<your reserved domain>`. A missing file is not fatal: the tunnel retries
and picks the file up as soon as it appears, without restarting the stack
([scripts/ngrok-tunnel.mjs](scripts/ngrok-tunnel.mjs)).

Or let the supervisor do both: `npm run playtest:forever`
([scripts/playtest-forever.mjs](scripts/playtest-forever.mjs)) compiles functions, runs
`playtest:build` when `apps/*/dist-playtest/index.html` is missing, launches
`playtest:prod` and restarts it forever. `npm run playtest:stop` asks it to stop cleanly
so `--export-on-exit` still fires.

Trade-off: **no hot reload** — re-run `npm run playtest:build` (and restart the preview)
to pick up code changes. That's the right call for a live event where you're running,
not editing. `playtest:prod` uses the fixed ngrok domain (`.tunnel.env`), so the links
stay stable across restarts. Keep `npm run playtest` for iterating on the app locally.

## ⚠ Build isolation — a gate build must never touch what the playtest serves

The always-on playtest (`npm run playtest:prod`, supervised by
`scripts/playtest-forever.mjs`) serves **pre-built** bundles through `vite preview`.
`npm run verify` builds the same two apps. Those builds are **not interchangeable**,
so they are kept in **separate output directories**:

| You want | Command | Writes | Mode |
|---|---|---|---|
| A gate run / a Firebase deploy | `npm run creator:build` · `npm run play:build` (both inside `npm run verify`) | `apps/*/dist` | `production` |
| To refresh the live playtest | `npm run playtest:build` | `apps/*/dist-playtest` | `playtest` |

`playtest:creator:preview` and `playtest:play:preview` pin `--outDir dist-playtest`, so
the live site is served from a directory the gate never writes.

**Why this matters** (it broke a live event once, and left no trace):
`npm run verify` used to overwrite the exact bytes the tunnel was serving, and both
resulting breakages are **completely silent** — every process stays healthy and every
request returns `200`:

1. **Blank creator console.** creator-web only gets `base: '/creator/'` under
   `--mode playtest`. A gate build emits `/assets/index-*.js`; the single-origin proxy
   routes only `/creator*` to creator-web, so those requests go to **play-web**, which
   answers `200` with its own HTML. The creator's JavaScript never loads.
2. **Nobody can join.** `isEmulatorBuild` (`packages/shared/src/env.ts`) is
   `DEV || MODE === 'playtest'`, so only the playtest bundle keeps the local-emulator
   wiring. A gate build points participants' phones at real Firebase, where anonymous
   auth is disabled (`auth/admin-restricted-operation`).

Two guards make a regression loud instead of invisible:

```bash
npm test           # scripts/test-build-artifact-guard.ts — the build/serve wiring in package.json
npm run base:check # scripts/check-build-base.mjs — each built index.html's asset base vs. its serve path
```

`base:check` runs inside `npm run verify` right after the builds. If it ever fails,
rebuild the named artifact with the mode from the table above; nothing else is needed.

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

## Crash recovery (emulator-data-backup)

`npm run playtest` also runs a **BACKUP** loop that snapshots the live emulator data
into rotating, timestamped folders every ~2 minutes — independent of the clean-exit
export — so a power loss or crash mid-event loses at most a couple of minutes, not the
whole game. Only the newest 10 snapshots are kept.

- Interval / retention: `EMU_BACKUP_INTERVAL_MS` (default `120000`) and
  `EMU_BACKUP_KEEP` (default `10`).
- Snapshots live under `.firebase/backups/backup-<timestamp>/`.

After a crash, find the newest valid snapshot and resume from it:

```bash
SNAP=$(npm run --silent emulator:restore-latest)   # prints the newest valid snapshot path
npx firebase emulators:start --project rushpoint-pwa-7daaa \
  --import "$SNAP" --export-on-exit .firebase/emulator-data
```

`emulator:restore-latest` picks the most recent snapshot that actually carries the
emulator's `firebase-export-metadata.json` import gate, skipping a newest-but-incomplete
one in favor of an older good snapshot.
