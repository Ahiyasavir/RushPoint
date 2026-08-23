# Run RushPoint's backend on a VPS (self-hosted Cloud Functions)

**Goal:** move the callable compute off Cloud Functions onto a fixed-cost VPS
(IONOS ~$10–12/mo), keeping Firebase **Auth + Firestore + Storage** exactly as
they are. This removes the surprise-billing risk on compute; the same
`functions/` code runs, unchanged, as a plain Node server.

## Architecture

```
 Phone / browser (play-web, creator-web)
   ├── httpsCallable("...")  ─────────►  VPS Node server  (Dockerfile.api / server.js)
   │                                        └── Admin SDK ─► Firebase Auth + Firestore
   └── Firestore onSnapshot / Auth / Storage  ─────────►  real Firebase (unchanged)
```

Only **callables** move. The live listeners, sign-in and photo uploads keep
talking to Firebase directly, so `firestore.rules` / `storage.rules` still guard
them (see prerequisites).

Proven locally: the server mounts **97 callables** and answers the Firebase
callable wire protocol identically (`test`: an unauthenticated call returns
`401 {"error":{"status":"UNAUTHENTICATED"}}`, exactly as Cloud Functions does).

---

## 1. One-time Firebase setup (console + CLI)

1. **Enable Anonymous sign-in** — Firebase console → Authentication → Sign-in
   method → **Anonymous → Enable**. Participants sign in anonymously; today this
   is disabled on the real project (that's why the app used the emulator), so
   nobody can join until you enable it.
2. **Deploy the security rules + indexes to the real project** (they currently
   only exist locally / in the emulator):
   ```bash
   firebase deploy --only firestore:rules,firestore:indexes,storage
   ```
3. **Create a service account key** — console → Project settings → Service
   accounts → **Generate new private key**. Save the JSON; you'll put it on the
   VPS. Keep it secret (never commit it).

## 2. Deploy the API server on the VPS

```bash
# on the VPS
git clone <your repo>  &&  cd Rushpoint
cp /path/to/downloaded-service-account.json ./service-account.json

# edit docker-compose.api.yml:
#   GCLOUD_PROJECT      = your project id (rushpoint-pwa-7daaa)
#   ALLOWED_ORIGINS     = the exact origins play-web + creator-web are served from
#   QR_SECRET           = the same value you use today (functions/.env)

docker compose -f docker-compose.api.yml up -d --build
curl http://127.0.0.1:8080/healthz        # -> {"ok":true}
```

**HTTPS + Cloudflare (required in production).** The request carries Firebase ID
tokens, so put Caddy (TLS) behind Cloudflare (WAF + DDoS + Israel-only geo-block):

- **`deploy/Caddyfile`** — ready to use: terminates TLS, trusts Cloudflare and
  recovers the real client IP from `CF-Connecting-IP`, and refuses any connection
  that didn't come through Cloudflare. Copy to `/etc/caddy/Caddyfile`, set your
  hostname + the Origin-CA cert paths, `systemctl reload caddy`.
- **`deploy/CLOUDFLARE.md`** — step-by-step for the Cloudflare Free tier: the
  proxied `A` record, `Full (strict)` TLS + Origin certificate, the WAF rule
  `(ip.geoip.country ne "IL") → Block` (with a dev-IP exception), Bot Fight Mode,
  and a `ufw` origin lock.

Now the API is at `https://api.example.com`, reachable only from Israel + your dev
IPs, with the origin IP hidden behind Cloudflare. (PM2 alternative: `pm2 start
functions/server.js --name rushpoint-api` after `npm ci && npm --prefix
packages/shared run build && npm --prefix functions run build`, with the same env
vars exported — but Docker is the simpler, reproducible path.)

## 3. Point the clients at the VPS (the only code change)

Already wired (guarded by `VITE_API_ORIGIN` — until you set it, nothing changes):
`apps/*/src/services/firebase.ts` now does
`getFunctions(app, VITE_API_ORIGIN)` when that env var is present.

For each app's **production** `.env` (`apps/play-web/.env`, `apps/creator-web/.env`):
```
VITE_API_ORIGIN=https://api.example.com
# and the REAL Firebase project values (NOT emulator placeholders):
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=rushpoint-pwa-7daaa.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=rushpoint-pwa-7daaa
VITE_FIREBASE_STORAGE_BUCKET=rushpoint-pwa-7daaa.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```
Then build the **production** bundles (NOT `playtest` — production points
Auth/Firestore at real Firebase, which is what you want now):
```bash
npm run play:build      # apps/play-web/dist
npm run creator:build   # apps/creator-web/dist
```
Deploy those static bundles wherever you host the front-end (Firebase Hosting,
or the same VPS behind Caddy). `VITE_API_ORIGIN` must be reachable over HTTPS
from the browser, and its origin must be in the server's `ALLOWED_ORIGINS`.

## 4. Verify end to end

- `curl https://api.example.com/healthz` → `{"ok":true}`.
- Open play-web, join a run with a code → the call hits the VPS (check
  `docker compose -f docker-compose.api.yml logs -f api`), and Firestore live
  updates still flow from real Firebase.

---

## Known items to handle before you rely on it (be honest, not surprised)

- **Two functions are NOT HTTP and are not served here:**
  - `onRunFinalized` (a Firestore trigger). Confirm what it does post-finalize
    (player-profile/badge recording, benchmark contribution). If your app needs
    that work, it must be moved inline into `finalizeRun` or hosted by a
    Firestore-trigger runner — a plain HTTP server can't receive it.
  - `pruneExpiredRunData` (daily pubsub schedule, 90-day retention). **Handled:**
    `functions/prune-cron.js` (built by `npm run build:cron`, shipped in the
    image) runs the SAME sweep with Admin privileges; install the systemd timer
    `deploy/rushpoint-prune.service` + `deploy/rushpoint-prune.timer`
    (`systemctl enable --now rushpoint-prune.timer`) to fire it daily.

**Verify the server ↔ Firebase link before you rely on it.**
`scripts/test-api-live.mjs` boots the server, mints a real anonymous Firebase
token, and calls a read-only callable through it. Run it green against the
emulators today, and against your LIVE project once the service account is on the
box:
```bash
# emulator (no creds): proves the exact wiring
npx firebase emulators:exec --only auth,firestore --project rushpoint-pwa-7daaa "node scripts/test-api-live.mjs"
# live (on the VPS): your service account + Web API key
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json GCLOUD_PROJECT=rushpoint-pwa-7daaa \
  FIREBASE_WEB_API_KEY=<web-api-key> node scripts/test-api-live.mjs
```
- **Rate limiting still works** — it's Firestore-counter based, and this server
  talks to the same Firestore.
- **Payments** are behind `PAYMENTS_ENABLED` (off by default); set the Stripe env
  only if you turn them on. `stripeWebhook` is mounted at `/stripeWebhook`.
- **Cost note (unchanged from the earlier analysis):** this caps *compute*.
  Firestore itself still bills per read/write and cannot be hard-capped — you're
  accepting that for now under the existing security + rate-limit layers.
- **Scaling:** one process, one box. Fine for a single event's load; for
  concurrent large events add instances behind the proxy (the server is
  stateless — all state is in Firestore).
