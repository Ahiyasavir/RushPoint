# RushPoint — Production Deployment & Payments Guide

Everything you need to put RushPoint live on Firebase and start collecting money.
Follow it top to bottom once; afterwards a deploy is just `npm run deploy:all`.

> **Two things you must do yourself** (I can't, and shouldn't, touch your money/credentials):
> enter your own Firebase/Stripe keys into the `.env` files, and connect your **bank account**
> inside the Stripe dashboard for payouts. Steps are spelled out below.

---

## 0. How money flows (read this first)

RushPoint is **creator-funded**: building games is free, and the first **2 participants per run
are free**. Beyond that, the game's creator pays per extra participant/team by topping up a
**wallet** (₪35/extra participant in individual mode, ₪100/extra team in team mode — see
`packages/shared` constants). Those top-ups are **Stripe Checkout** payments that land in **your
Stripe account**, and Stripe pays them out to **your bank account**.

So "connect a card to receive money" means: **you connect your bank to Stripe (for payouts); your
customers pay by card at Stripe Checkout.** You never handle card numbers — Stripe does.

---

## 1. Prerequisites

- **Node 20** and this repo installed (`npm install` at the root).
- **Firebase CLI**: `npm i -g firebase-tools` then `firebase login`.
- A **Firebase project on the Blaze (pay-as-you-go) plan** — required for Cloud Functions and for
  outbound network calls to Stripe. The free Spark plan cannot deploy functions.
  - You can use the existing project id `rushpoint-pwa-7daaa` (in `.firebaserc`) or create your own
    and update `.firebaserc` (`projects.default`) + the project id in your `.env` files.

---

## 2. One-time Firebase setup (Console)

In the [Firebase Console](https://console.firebase.google.com) for your project:

1. **Authentication → Sign-in method** — enable:
   - **Email/Password** (creators sign in with this)
   - **Google** (creator sign-in, optional but recommended)
   - **Anonymous** (⚠️ required — participants & staff use anonymous auth)
2. **Firestore Database → Create database** (Native mode, a region near your users).
3. **Storage → Get started** (this is where photo-mission uploads live).
4. **Hosting** — create **two sites** (Hosting → Add another site):
   - `rushpoint-creator`  → the creator console
   - `rushpoint-play`     → the participant app
   These names are already mapped in `.firebaserc` (`targets`). If you pick different names,
   update `.firebaserc` and re-run `firebase target:apply hosting creator <site>` / `… play <site>`.
5. **Project settings → Your apps → Web app** — register a web app (or two) and copy the config
   (apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId) for the next step.

### 2b. DNS — the four hostnames

Recorded here because it was not written down anywhere and the records are NOT uniform.
`deploy/CLOUDFLARE.md` covers **only** `api.rush-point.com`; these are the rest.

| Hostname | Serves | Records | Cloudflare |
|---|---|---|---|
| `rush-point.com` | **marketing site** (`apps/marketing`) | `A 199.36.158.100` + `AAAA 2620:0:890::100` | DNS-only |
| `www.rush-point.com` | 301 → apex | Cloudflare addresses | proxied |
| `player.rush-point.com` | **participant app** (play-web) | `A 199.36.158.100` + `AAAA 2620:0:890::100` | DNS-only |
| `creator.rush-point.com` | creator console | `A 199.36.158.100` + `AAAA 2620:0:890::100` | DNS-only |
| `api.rush-point.com` | self-hosted API (VPS) | see `deploy/CLOUDFLARE.md` | proxied |

> ⚠️ **The apex and the participant app swapped places** (change: marketing-to-apex).
> `rush-point.com` served play-web until 2026-09-01; the participant app now answers on
> `player.rush-point.com`, and the apex is the marketing site. Three things carry the
> weight of that move and are easy to miss:
> 1. `player.rush-point.com` must be in **Authentication → Settings → Authorized domains**,
>    or anonymous sign-in fails and no participant can join. Nothing else reports this.
> 2. `ALLOWED_ORIGINS` on the VPS must include `https://player.rush-point.com` (§below),
>    or every callable answers 403 while the app itself looks perfectly healthy.
> 3. The Play Store TWA (`com.rushpoint.app`) verifies Digital Asset Links against the
>    host in `twa-manifest.json`. Installed builds older than versionCode 5 still open the
>    apex, which is why `apps/marketing/public/.well-known/assetlinks.json` exists and why
>    the marketing layout carries `PlayerDeepLink.astro` — it forwards `?code=`, `?game=`,
>    `?board=` and `?staff` links to the participant host.

`199.36.158.100` / `2620:0:890::100` are Firebase Hosting's own published custom-domain records,
so a Firebase-served host should carry **both**.

> ✅ **RESOLVED 2026-08-26** — the apex was missing its AAAA record (`creator.` had one, the apex
> didn't), and the failure path was reachable: `www.` resolves over IPv6 (Cloudflare-proxied) and
> 301s to the apex, which then had no IPv6 address to connect to. Most mobile carriers run
> DNS64/NAT64, which is why it never showed up as an outage. Fixed by adding
> `AAAA  @  2620:0:890::100`, DNS-only (grey cloud), matching the existing apex `A` record. Verified
> both by DNS (`1.1.1.1` / Cloudflare DoH — `8.8.8.8` took roughly an hour to pick up the new record,
> which is normal propagation lag, not a sign anything was wrong) and by a live request straight to
> the new address returning `HTTP/1.1 200 OK` over IPv6.
>
> Verifying IPv6 from Windows is misleading — `curl` on schannel fails the handshake against
> Firebase Hosting even when the host is perfectly healthy. Use openssl, which is honest:
> ```bash
> printf 'GET / HTTP/1.1\r\nHost: creator.rush-point.com\r\nConnection: close\r\n\r\n' \
>   | openssl s_client -6 -quiet -connect creator.rush-point.com:443 \
>       -servername creator.rush-point.com 2>/dev/null | head -1   # expect HTTP/1.1 200 OK
> ```
> Also expect the served certificate's CN to be some **unrelated** domain: Firebase Hosting puts
> many customers on one Google Trust Services cert and our hostnames appear in its SAN list, not its
> CN. That is normal and not a misconfiguration.

---

## 3. Environment files

Copy each `.env.example` to `.env` (all are gitignored) and fill in real values.

| File | What goes in it |
|---|---|
| `apps/creator-web/.env` | `VITE_FIREBASE_*` from your Web app config + optional `VITE_MAPTILER_KEY` (see below) |
| `apps/play-web/.env` | same `VITE_FIREBASE_*` values (+ optional `VITE_MAPTILER_KEY`) |
| `functions/.env` | `APP_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (Stripe in §4); optional `RESEND_API_KEY` for run-summary email (§7b) |

- `VITE_*` values are **public** (baked into the web bundle) — that's fine, they're not secrets.
- `functions/.env` holds **server secrets**; it is gitignored and only deployed to your functions.
  (For extra security you can use `firebase functions:secrets:set` instead — see §6.)
- **MapTiler** tiles are optional (maps fall back to keyless OpenTopoMap either way). Get a free key
  (no card) at https://cloud.maptiler.com and set `VITE_MAPTILER_KEY=<your-key>` if you want
  MapTiler's `outdoor`/`hybrid` vector styles instead of the OpenTopoMap raster fallback.
- **Place search** (`apps/creator-web/src/lib/geocode.ts`) is deliberately independent of that key.
  It asks OSM **Nominatim first** — MapTiler's Israeli/Hebrew address coverage is markedly worse (a
  real Jerusalem street returned four wrong towns from MapTiler; Nominatim returned the exact
  address) — and falls back to MapTiler only when Nominatim errors or has nothing. This keeps the
  [Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/) in mind on
  purpose, not by accident: search fires only on an explicit button press (no autocomplete-as-you-type),
  and a client-side gate (`NOMINATIM_MIN_INTERVAL_MS`, `nominatimDelayMs`) enforces the policy's
  documented 1-request-per-second cap regardless of how a creator hammers the button. Setting
  `VITE_MAPTILER_KEY` changes the TILES only — it does not change which geocoder search uses.

---

## 4. Stripe — connect your account (so you get paid)

1. Create/sign in to your account at https://dashboard.stripe.com.
2. **Connect your bank account** for payouts: **Settings → Payouts → Bank accounts**. This is the
   account that receives the money. (Stripe handles the customers' cards; you only provide a bank.)
3. **Get your secret key**: **Developers → API keys → Secret key** (`sk_live_…` for real money, or
   `sk_test_…` to rehearse). Put it in `functions/.env` as `STRIPE_SECRET_KEY`.
4. Set `APP_URL` in `functions/.env` to your creator site, e.g.
   `https://rushpoint-creator.web.app` (Stripe redirects back here after checkout).
5. **Deploy once** (§5) so the `stripeWebhook` function exists, then register the webhook:
   - **Developers → Webhooks → Add endpoint**
   - Endpoint URL: `https://us-central1-<YOUR_PROJECT_ID>.cloudfunctions.net/stripeWebhook`
     (find the exact URL in the deploy output or Console → Functions)
   - Events to send: **`checkout.session.completed`**
   - Save, then copy the endpoint's **Signing secret** (`whsec_…`) into `functions/.env` as
     `STRIPE_WEBHOOK_SECRET`, and **deploy the backend again** (§5) so the function picks it up.

That's the whole money path. The wallet credit is applied **idempotently** by the webhook (Stripe
retries can't double-charge), and every top-up is recorded under `wallets/{uid}/transactions`.

---

## 5. Deploy

From the repo root:

```bash
npm run deploy:backend   # builds shared + functions, deploys functions + Firestore rules/indexes + Storage rules
npm run deploy:hosting   # builds creator-web + play-web, deploys both Hosting sites
# or both at once:
npm run deploy:all
```

> ⚠️ **Deploy indexes FIRST, and let them finish BUILDING, before the functions go out.**
> `deploy:backend` is a single `firebase deploy --only functions,firestore:rules,firestore:indexes,storage`,
> which does not wait for an index to leave the *Building* state. The retention sweep
> (`sweepExpiredRuns`, `functions/src/maintenance/index.ts`) needs the `runs` **COLLECTION_GROUP**
> composite (`status` ASC, `createdAt` ASC) from `firestore.indexes.json`. That query and the
> finished-run query live in the **same** function, and the missing-index error throws before either
> result is used — so if functions ship first, **no run PII is pruned at all**, not even on the
> finished-run path. Sequence it as:
>
> ```bash
> firebase deploy --only firestore:indexes    # then wait: Firestore console → Indexes → all "Enabled"
> npm run deploy:backend
> ```

`firestore.rules` and `storage.rules` both changed in this release (client hard-delete of a game is
now denied, and the Storage prefixes/content-types were tightened). They ship with
`deploy:backend` — the privacy fixes are **not** in effect until that deploy lands.

- `deploy:backend` runs the `predeploy` hook in `firebase.json` (builds `@rushpoint/shared` then
  bundles the functions with esbuild — `@rushpoint/shared` is inlined, so Firebase never tries to
  install it from npm).
- After it finishes you'll have:
  - Creator console: `https://rushpoint-creator.web.app`
  - Participant app: `https://rushpoint-play.web.app`

> ⚠️ **The participant legal pages need a HOSTING deploy — a `git push` is not enough.**
> `/terms` and `/privacy` on the participant origin are client-side routes inside the play-web
> bundle (`resolveLegalPath()` in `apps/play-web/src/lib/playRoute.ts` → lazy
> `screens/LegalScreen.tsx`), served through the `"source": "**" → /index.html` rewrite on the
> **play** Hosting target in `firebase.json`. Until `npm run deploy:hosting` (or `deploy:all`) ships
> a fresh `apps/play-web/dist`, those URLs still resolve to the OLD bundle — which had no legal
> route and fell through to the game. The same applies to `/creator/terms` and `/creator/privacy`
> on the creator target.

---

## 6. (Optional but recommended) Use Firebase Secrets instead of functions/.env

`functions/.env` is simplest and works. For stronger secret hygiene you can store the Stripe keys
in Google Secret Manager:

```bash
firebase functions:secrets:set STRIPE_SECRET_KEY
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
```

…then bind them on the two payment functions (`topUpWallet`, `stripeWebhook`) with
`.runWith({ secrets: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] })`. The code already reads
them from `process.env`, so only that binding needs adding. Keep `APP_URL` in `.env` (not secret).

---

## 7. First admin & staff (optional)

Most of the app needs no admin. Two things use elevated access:
- **Staff console** (photo review / SOS / announcements): the **creator** generates a one-time PIN
  from the live Run Console ("Invite staff"); staff sign in with it. No admin role needed.
- **Admin callables** (`listAuditLogs`, `pruneRunNow`, `backfillPublicTaskCoordinatesNow`,
  `listPlatformUsers` — the `/admin/users` creator activity dashboard) require an `admin` custom
  claim on the caller's Firebase Auth account. To grant it: **first sign in normally** via the
  regular creator-web login (email/password or Google — this is your own account, nobody else's
  credentials are involved), then run:

  ```bash
  GOOGLE_APPLICATION_CREDENTIALS=/abs/path/sa.json \
  node scripts/grant-admin-claim.mjs --project=rushpoint-pwa-7daaa \
       --email=you@example.com --execute --confirm-project=rushpoint-pwa-7daaa
  ```

  Dry-run by default (omit `--execute` to just preview). Against the local emulator, drop
  `--project`/`--confirm-project`/the credentials env var entirely. Sign out and back in (or wait
  for the ~1h token refresh) before the new claim shows up. `--revoke` removes it. See
  `scripts/grant-admin-claim.mjs` for the full flag list.

---

## 7b. Run summary email (optional)

Every finalized run composes an organizer summary (final standings + completion stats + player
feedback digest). It is always shown in the creator Run Console. To also **email** it after each run:

**Self-hosted VPS (current setup):** the flag/sender/recipient
defaults live in `docker-compose.api.yml`; the secret key goes in a gitignored `api.env` next to it
(copy from `api.env.example`):

```
RESEND_API_KEY=re_xxx      # from resend.com (free tier) — enables delivery
```

Then rebuild: `docker compose -f docker-compose.api.yml up -d --build`. With no `RESEND_API_KEY`,
sending is a safe no-op (a log breadcrumb only) — nothing is sent and no network call is made.
Set `RUN_SUMMARY_EMAIL_ENABLED: "false"` in the compose file's `environment:` block to hard-disable.

**Which runs email.** Only *real* runs: not a `testDrive` rehearsal, not a `selfGuided`
instant-play/demo run, and not a run whose owner is an anonymous account (which is what excludes
every simulation and the e2e suite — they create their creator with `signInAnonymously`). A skipped
run logs `runSummary.email.notEligible` naming the rule that fired, so a missing summary is
diagnosable. Demo volume is reported by the daily digest instead.

**Daily digest.** `deploy/rushpoint-digest.{service,timer}` fires at 03:30 local and reports the
PREVIOUS complete day: how many demo runs were played (with the players' display names) plus the real
runs that finished. A fully quiet day sends **nothing** — silence means "nothing happened", so check
`journalctl -u rushpoint-digest` if you want proof the unit ran. Install:

```bash
cp deploy/rushpoint-digest.service deploy/rushpoint-digest.timer /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now rushpoint-digest.timer
```

Its `environment:` knobs in the compose file: `RUN_DIGEST_EMAIL_TO` (falls back to
`RUN_SUMMARY_EMAIL_TO`), `RUN_DIGEST_TIMEZONE` (set explicitly — a container's local time is UTC even
when the host is `Asia/Jerusalem`, which would shift the day boundary), and `RUN_DIGEST_OWNER_UID`, a
comma-separated allowlist of the accounts whose runs get itemized (the operator's real account plus
the seeded accounts owning the platform's demo games). Any other creator's runs appear as a bare
count only, so the digest can't become a cross-tenant leak.

**Post-finalize work needs no trigger runtime.** The summary email, player-profile/badge folds and
the platform-benchmark contribution used to run only from the `onRunFinalized` Firestore trigger,
which this VPS never invokes (it mounts callables only) — so all three silently stopped after the
2026-07-27 migration. `finalizeRunCore` now invokes them inline, guarded by the existing
per-concern transactional claims so a Cloud Functions deployment that fires both paths still does the
work exactly once.

**Cloud Functions (legacy path, not the current deploy target):** add the same three vars to
`functions/.env` and redeploy (§5) so the function picks them up.

---

## 8. Post-deploy smoke test

1. Open the **creator** site, sign up (email), create a game (try a template, or the smart-build path), Launch a run.
2. Open the **participant** site on your phone, join with the access code, play a task.
3. In the creator Run Console: **Start all teams**, push an announcement, **Refresh standings**, **Finalize**.
4. **Payments:** with a `sk_test_…` key, add wallet credit on the Wallet page — Stripe Checkout opens;
   pay with Stripe's test card `4242 4242 4242 4242` (any future date / any CVC). Confirm the balance
   rises (the webhook credited it). Switch to `sk_live_…` when you're ready for real money.

---

## 9. Re-deploying later

> ⚠️ **VERIFY THE PUBLIC PATH AFTER EVERY BACKEND DEPLOY — a healthy container proves nothing.**
> On 2026-08-14 `sudo bash deploy/bootstrap.sh` overwrote the live `/etc/caddy/Caddyfile` with the
> repo TEMPLATE, whose hostname is still the `api.example.com` placeholder. A placeholder hostname
> is valid Caddy syntax, so `caddy validate` passed and the reload "succeeded" — while nothing
> matched `api.rush-point.com` any more. Cloudflare answered every request with an **empty HTTP
> 200**: the creator console showed "loading games failed" and photo upload died, with the API
> container **Up (healthy)** and `100 callables mounted` in its log. Every layer reported fine
> except the one nobody was looking at. `bootstrap.sh` now refuses to install a placeholder
> template over an existing config and smoke-tests the public host itself, but run these two
> anyway — they take 30 seconds and they check what users actually traverse:
>
> ```bash
> # 1. An UNAUTHENTICATED callable must be refused. A 200 means the request never reached the API.
> curl -s -o /dev/null -w '%{http_code}
' -X POST https://api.rush-point.com/listGames >   -H 'Content-Type: application/json' -d '{"data":{}}'      # expect 401
>
> # 2. The whole upload chain a phone walks (sign-in -> PUT -> readback -> abuse guards).
> npm run upload:check                                        # expect 22 checks passed
> ```
>
> And after any **frontend** deploy, confirm the shipped bundle really points at the backend —
> `npm run origin:check` locally before deploying, plus:
> `curl -s https://creator.rush-point.com/ | grep -o 'assets/index-[^"]*\.js'` then fetch that
> file and grep it for `api.rush-point.com`. A matching asset hash only proves you deployed the
> file you built, never that the file was built correctly.

Just run `npm run deploy:all` (or only `:backend` / `:hosting`). Before deploying, it's worth
running the gates locally:

```bash
npm run verify            # typecheck · lint · test · creator:build · play:build · bundle:budget · i18n:check:strict
npm run verify:emulator   # e2e · Firestore rules · 8-team simulate · adversarial simulate (boots its own suite)
```

Run the two **sequentially, never concurrently** — both invoke `shared:build`, which rewrites
`packages/shared/dist` in place. If you touched `storage.rules`, also run the Storage-rules suite
(`npm run test:rules:storage`) against a running emulator; it is not part of either gauntlet.

## 10. Self-hosted events — crash-safe emulator backups

When you run a real game off the local stack (e.g. ~15 players via `npm run playtest`),
the live data is only protected by the emulator's `--export-on-exit`, which fires **only
on a clean Ctrl+C**. A power loss or hard crash would otherwise lose the whole game.

- `npm run playtest` runs a **BACKUP** loop that snapshots the emulator into rotating
  `.firebase/backups/backup-<timestamp>/` folders every ~2 min (keeps the newest 10).
- To enable it on a plain `dev:all`, set `RUSHPOINT_BACKUP=1` — `scripts/dev-emulator.mjs`
  starts/stops the loop with the emulator.
- Tune with `EMU_BACKUP_INTERVAL_MS` (default `120000`) and `EMU_BACKUP_KEEP` (default `10`).

**Recover after a crash:** `npm run emulator:restore` copies the newest *valid* snapshot
(one that carries `firebase-export-metadata.json`, skipping an incomplete newest one) into
`.firebase/emulator-data`; then start the emulator to import it. See
[PLAYTEST.md](PLAYTEST.md) for the full runbook.

---

## 11. Runbook — publicTasks legacy-coordinate backfill (privacy sweep)

**Symptoms that mean you need this:** the creator task-library map is empty and says no task has a
published area, and/or `publicTasks` documents still carry an exact `coordinates` field.

**What it is.** Before the `task-library-map-view` change, `publishGame` copied a task's **exact**
authored `coordinates` into `publicTasks/{gameId}_{taskId}` — a collection whose Firestore rule is
`allow read: if true`, hidden-location tasks included. The fix changed only what is written *from
then on*. Documents published earlier still hold the exact point and hold **no** coarse
`approxLocation` — which is both a location-privacy leak in a world-readable collection and the
reason those tasks draw no circle on the task-library map.

`backfillPublicTaskCoordinatesNow` (admin-only, in `functions/src/maintenance/index.ts`) is the
one-time sweep that repairs them: it deletes `coordinates` and writes the coarse `approxLocation`
today's code would have written — or nothing at all for a `hideLocation` task. The operator entry
point is `scripts/backfill-public-tasks.mjs`.

**Properties you can rely on:**
- **Dry-run is the default.** Nothing is written unless you pass `--execute`.
- **Idempotent.** Each page skips documents that already conform (`hasLegacyCoordinates`), and a
  repaired document conforms — so a second full run repairs `0`.
- **Resumable.** Every page prints its cursor; resume with `--start-after=<cursor>`. Re-running from
  the beginning is equally safe, just slower.
- **Bounded.** A malformed response, a cursor that stops advancing, or a server that never says
  "done" aborts with a non-zero exit instead of looping forever.
- **Non-zero exit on failure**, so it can be used from automation.

### A. Local emulator (rehearse here first)

```bash
# 1. the emulator must be running (npm run dev:all / npm run playtest)
npm run backfill:public-tasks                 # DRY-RUN — reports what it WOULD repair
npm run backfill:public-tasks -- --execute    # actually repair
npm run backfill:public-tasks -- --execute    # again: must report repaired: 0
```

### B. Real project

One-time prerequisites:

1. A **service-account JSON** for the project (Firebase Console → Project settings → Service
   accounts → *Generate new private key*). It is what signs the short-lived admin custom token; no
   persistent admin claim is granted to anyone.
2. The project's **web API key** (Project settings → General → Web API Key). The client SDK needs it
   to exchange that custom token for an ID token.

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
export RUSHPOINT_WEB_API_KEY=AIza...

# 1. DRY-RUN first — read-only, no confirmation flag needed
npm run backfill:public-tasks -- --project=rushpoint-pwa-7daaa

# 2. Execute. --confirm-project must EXACTLY equal --project (retyping it is the guard);
#    without it the script refuses and exits 1.
npm run backfill:public-tasks -- --project=rushpoint-pwa-7daaa \
    --execute --confirm-project=rushpoint-pwa-7daaa
```

The script prints a boxed banner naming the target (`LOCAL EMULATOR` vs `REAL PROJECT (PRODUCTION
DATA)`), the project id and the mode **before** it does anything, then one line per page:

```
[backfill] page   1  scanned   500  repaired    12  skipped   488  cleared     3  orphaned     0  cursor demo-game_task-7
```

…and a final summary: pages · scanned · repaired · skipped · cleared · orphaned.

If it dies mid-sweep (network, timeout), re-run with the last printed cursor:

```bash
npm run backfill:public-tasks -- --project=<id> --execute --confirm-project=<id> \
    --start-after=<last cursor printed>
```

### C. Verify success

1. **Re-run the sweep.** `repaired: 0` on a full pass is the primary proof that no legacy document
   remains (it scans every `publicTasks` doc — there is no "field exists" query in Firestore, so
   scanning *is* the check).
2. **Spot-check a document** in the Firestore console (or `--project` dry-run output): a repaired
   `publicTasks/{id}` has **no** `coordinates` field, and either an `approxLocation` (coarse) or,
   for a hidden-location task, no location field at all.
3. **Look at the map.** Open the creator task library — published tasks now draw their coarse
   circles instead of "no task has a published area".

### D. Tuning

`--limit=N` (1…1000, default 500) documents per page · `--max-pages=N` (default 200) bound per
invocation · `RUSHPOINT_BACKFILL_PROJECT` as an alternative to `--project` (it still requires
`--confirm-project`) · `RUSHPOINT_FUNCTIONS_REGION` (default `us-central1`).

---

## 12. Runbook — the marketing site (`rush-point.com`)

The site at `apps/marketing` is static output on its own Hosting target. Everything in this
section is **off-site configuration**: it cannot be done from the repository, no gate can
check it, and each item has a specific way of failing that looks like something else.

Read the "what stays broken" column before deciding to skip a step. Two of these fail
**silently on the visitor's side while every check we own stays green**, which is the
failure mode that cost us a whole afternoon the last time (see the `.env.local` story in
CLAUDE.md).

### A. Ship it

```bash
npm run verify
npm run deploy:hosting
```

`deploy:hosting` builds all three sites and deploys all three targets. It is the marketing
build too, so never hand-run `firebase deploy --only hosting` against a stale
`apps/marketing/dist`.

To deploy only this site:

```bash
npm run marketing:build && firebase deploy --only hosting:marketing
```

### B. DNS and the Hosting site

| Step | Where | What stays broken until it is done |
|---|---|---|
| A Hosting site named `rushpoint-marketing` exists in the Firebase console | Firebase → Hosting → Add another site | `firebase deploy` fails with a message about **targets**, not about anything you just changed. `.firebaserc` already maps the `marketing` target to that name. |
| `rush-point.com` (the APEX) is added as a custom domain on that site, and its DNS records are in place | Firebase Hosting → custom domain, then the registrar | The site is live only at its `*.web.app` address. Every canonical, every hreflang entry and every sitemap URL says `rush-point.com`, so until DNS resolves, a crawler is being pointed at a host that does not answer, and **the site looks perfectly fine to you** because you are visiting the other address. |
| The apex is **released from the `rushpoint-play` site first** — a custom domain belongs to one Hosting site at a time | Firebase Hosting → the `rushpoint-play` site → remove `rush-point.com` | Firebase refuses to attach the domain here and says it is already in use, naming the other site. Do this only after `player.rush-point.com` is serving play-web, or there is a window with no participant app at all. |
| `www.rush-point.com` is set to **redirect to the apex** | Firebase Hosting → custom domain → redirect | Two live copies of the same site on two hosts, splitting every search signal between them. |

### C. The contact form: allow the site's origin on the API ⚠

**Status as of 2026-08-27: `ALLOWED_ORIGINS` and `CONTACT_NOTIFY_TO` are set correctly on
the running container** (verified: both values read back from `docker exec … printenv`,
container healthy). **This did NOT make the contact form work**, because of a separate and
bigger gap: the VPS is running `main`, which is 18 commits behind `topographic-maps` and
predates the contact feature entirely. `submitContactMessage` returns `404 Not Found` —
there is no CORS problem, there is no code deployed to have one. Confirmed with a direct
`POST` from a shell (not a browser origin check — a 404 needs no Origin header to prove).

**This is a real deploy, not a config edit, so it was not done without asking**: it means
building and shipping 18 commits of backend, Firestore rules (`contactMessages` has no
protection on `main` today) and hosting to production. See the checklist this status leaves
open, folded into section F below.

`functions/server.js` refuses any browser `Origin` that is not in its `ALLOWED_ORIGINS`
environment variable, before the request reaches a callable. This subsection is left in
place for the next time this origin (or a new one) needs adding, independent of the deploy
above.

On the VPS, add the marketing origin to that list and restart the API container:

```bash
ssh root@31.70.107.184
```

Then edit `ALLOWED_ORIGINS` in the API's environment so it contains, comma separated:

```
https://creator.rush-point.com,https://rush-point.com,https://www.rush-point.com,https://player.rush-point.com
```

**What stays broken until it is done:** every contact submission comes back `403` with
`PERMISSION_DENIED`. Worse, the refusal happens at the CORS layer, so the response carries
no `Access-Control-Allow-Origin` header and the browser will not let the page read it at
all. `fetch` throws, exactly as it does when a phone has no signal, and the page therefore
shows its "we could not reach the server" message. That copy is deliberately worded not to
blame the reader's connection, but it still cannot tell you which of the two happened.

Until this is done the contact form is the site's ONLY channel and it is silently
unusable. The site builds, deploys, renders, passes every gate and looks completely
healthy. Nothing in
this repository can detect it, because the check has to be made from a browser on the real
origin. After the restart, confirm from the live contact page rather than from `curl`:
`curl` sends no `Origin` header and is therefore always allowed through, so it will tell you
the endpoint is fine when it is not.

Rebuilding the API container drops the public API to `503` for about forty seconds while
Caddy re-probes. That is expected and self heals.

### D. Where the messages go

**Status as of 2026-08-27: done**, set alongside `ALLOWED_ORIGINS` in §C.

| Setting | Where | Effect |
|---|---|---|
| `CONTACT_NOTIFY_TO` | the API's environment | The address a new contact message is announced to. Falls back to `RUN_SUMMARY_EMAIL_TO`. With neither set, and with no provider key, notification is a **logged no-op** — by design. |

Set explicitly rather than left to the `RUN_SUMMARY_EMAIL_TO` fallback, even though the two
values are the same address today: a future change to who receives run-summary emails
should not silently redirect contact form notifications too.

```
CONTACT_NOTIFY_TO=spendora.tracker@gmail.com
```

This is also the fallback address published on the contact page itself
(`apps/marketing/src/copy/contact.ts`, `CONTACT_FALLBACK_EMAIL`) — a plain `mailto:` link
under the form, with no script and no dependency on the API being reachable. It exists
because it is the one channel that still works in the exact failure mode the form cannot
detect from the browser: §C's origin misconfiguration.

The message itself is stored either way, and is readable at **`/admin/contact`** on the
creator console by an account carrying the `admin` claim (§7). That page is the reason
notification is allowed to be best effort: nothing is lost when an email fails.

### E. The CMS (`/admin/` on the marketing site)

Decap commits content straight to this repository through GitHub. The token that lets it do
so can only be minted with a client secret, and a secret in a static site is not a secret —
so the exchange happens on the API. **That endpoint now exists** (`functions/oauthRoute.js`,
mounted at `/oauth` and `/oauth/callback` by `functions/server.js`); what is left is
off-site, and **none of it affects the site itself**: until it is done the admin page loads
and says the editor is not connected to GitHub yet, while every published page, every post
and every gate is completely unaffected. Content can still be added by editing files in
`apps/marketing/src/data/post/` and committing.

**Step 1 — create the GitHub OAuth application.** GitHub → Settings → Developer settings →
OAuth Apps → New OAuth App. This is the only step that needs a signed-in GitHub session, so
it is the one that cannot be scripted.

| Field | Value |
|---|---|
| Application name | `RushPoint content` (shown to you on the consent screen, nothing else reads it) |
| Homepage URL | `https://www.rush-point.com` |
| Authorization callback URL | `https://api.rush-point.com/oauth/callback` |

The callback URL is compared by GitHub **byte for byte**, including the scheme and the
absence of a trailing slash. A mismatch is refused by GitHub before our code runs, and the
popup can only report it vaguely — so if sign in fails with nothing in the API log, this
field is the first suspect.

Keep the **Client ID** and generate a **Client secret**. The secret is shown once.

**Step 2 — put them on the API.** On the VPS, in `api.env` beside
`docker-compose.api.yml` (that file is gitignored; `docker-compose.api.yml` is not, which is
why the secret goes here and not there):

```
OAUTH_GITHUB_CLIENT_ID=<the client id>
OAUTH_GITHUB_CLIENT_SECRET=<the client secret>
```

Then restart the API. This is an environment change, not a code change, so it does not need
a rebuild:

```bash
docker compose -f docker-compose.api.yml up -d
```

`OAUTH_ALLOWED_ORIGINS` is already set in `docker-compose.api.yml` and needs no edit. It is
deliberately **narrower** than `ALLOWED_ORIGINS`: it lists only the two addresses the admin
page is served from, because it controls which page may be handed a GitHub token that can
write to this repository, and the play and creator apps have no business receiving one.

**Step 3 — confirm.** Two checks, in this order, because they fail differently:

```bash
curl -sI https://api.rush-point.com/oauth | head -1
```

`302` means configured (it is redirecting to GitHub). `503` means the API still has no
client id or secret — the restart did not pick up `api.env`. Then open
`https://rush-point.com/admin/` (or `https://rushpoint-marketing.web.app/admin/` before
the DNS cutover in §B) and sign in: a successful sign in closes the popup and lands on the
post list.

What the endpoint guarantees, so it does not have to be re-derived when reading it: the
`state` is checked against an httpOnly cookie (a CSRF check), the token is posted only to an
origin named in `OAUTH_ALLOWED_ORIGINS`, the requested scope is narrowed to `public_repo`,
and every refusal path returns no token. `scripts/test-decap-oauth.ts` pins all of it and
runs in `npm test`.

Two facts worth keeping in mind while configuring it:

- `config.yml` names the branch content is committed to (`topographic-maps`). Content
  committed to a branch nobody deploys is content nobody sees. If the deployed branch
  changes, change it here in the same commit.
- The admin surface is `Disallow`ed in `robots.txt`, carries `noindex`, and is absent from
  the sitemap. `scripts/check-marketing-output.ts` asserts all three, so it stays that way.

### F. Smoke test after deploying

1. `https://www.rush-point.com/` redirects (302) to `/he/`.
2. A Hebrew page renders right to left; its English counterpart renders left to right and
   the language switch moves between them.
3. `https://www.rush-point.com/sitemap-index.xml` resolves, and a URL taken from it loads.
4. Send a message through the contact form and confirm it appears at
   `https://creator.rush-point.com/admin/contact`. If it fails, §C is the first suspect.
5. A URL that does not exist returns a real **404**, not a page. There is deliberately no
   catch-all rewrite on this target: a soft 200 is indexable, which is worse than an honest
   404 for a site whose whole purpose is being crawled correctly.

### G. What is actually still needed to go live (status: 2026-08-27)

Everything above assumes the code is already on the VPS. It is not, and the two things
should not be confused with each other: the runbook above is config, this list is a deploy.

| Done | Item |
|---|---|
| ✅ | `ALLOWED_ORIGINS` includes `https://www.rush-point.com` (§C) |
| ✅ | `CONTACT_NOTIFY_TO` set (§D) |
| ❌ | **18 commits of `topographic-maps` deployed to the VPS.** It is on `main`, which predates the marketing site, the contact form, and everything in this file past section 11. `submitContactMessage` 404s: the callable does not exist yet on the running server. |
| ❌ | `firestore.rules` deployed. `main`'s copy has no `contactMessages` rule at all — not open, not closed, simply absent, which Firestore treats as denied by default, but it is untested drift rather than the deliberate `allow read, write: if false` this repository ships. |
| ❌ | The `rushpoint-marketing` Hosting site + the apex DNS (§B) — not checked in this pass. |
| ❌ | The GitHub OAuth **app** for the CMS, and its two values in `api.env` (§E). The token exchange **endpoint** is now in the repository and ships with the deploy above; what remains is one GitHub form and one restart. Optional — the site works without it. |

To close the code gap: merge or fast-forward `main` to `topographic-maps` (or deploy
directly from the branch — this repository has done both before, see the merge commits in
`git log --merges`), then on the VPS: `git pull`, `docker compose -f docker-compose.api.yml
up -d --build` (rebuild this time — code changed, not just env), `firebase deploy --only
firestore:rules`, and `npm run deploy:hosting` for the three Hosting targets. This is a real
production release and was deliberately NOT done automatically while investigating the
config — see the session note for 2026-08-27.

### H. Publishing automatically after a CMS commit

`.github/workflows/deploy-marketing.yml` builds and publishes the site whenever anything
under `apps/marketing/` changes on `topographic-maps` — which is exactly what Decap writes
when an author presses Publish (`src/data/post/` for posts, `public/uploads/` for media).

Without it, "Publish" in the CMS means *a file changed in git* and nothing more: the site is
static output, so the post is not on the site until someone builds and deploys. The author
gets no error and no hint, which is the worst kind of broken — it looks like it worked.

The build is a **gate**, not just a step. A post is validated by the Astro content schema
during the build and by `scripts/check-marketing-output.ts` afterwards (language
correctness, the no-dashes rule, alt text, canonicals). A bad post therefore fails in CI and
**the previous site stays live**, instead of a broken page replacing a good one.

**The one thing that must be set up by hand: a deploy credential.**

The workflow reads a Google service-account key from the repository secret
`FIREBASE_SERVICE_ACCOUNT_MARKETING`. Until it exists, the workflow runs, builds, checks —
and then fails at the deploy step with a message pointing here, which is deliberate: a
pipeline that silently skips its own deploy is indistinguishable from one that worked.

Create a **dedicated, least-privilege** account rather than reusing an existing key:

1. [Google Cloud Console → Service accounts](https://console.cloud.google.com/iam-admin/serviceaccounts?project=rushpoint-pwa-7daaa)
   → **Create service account**. Name it `github-deploy-marketing`.
2. Grant it exactly two roles, and no others:
   - **Firebase Hosting Admin** (`roles/firebasehosting.admin`) — publish releases.
   - **Firebase Viewer** (`roles/firebase.viewer`) — read the project and resolve the
     `marketing` Hosting target.
3. Open the account → **Keys** → **Add key** → **Create new key** → **JSON**. Downloads once.
4. Put the whole file contents in the repository secret:

```bash
gh secret set FIREBASE_SERVICE_ACCOUNT_MARKETING --repo Ahiyasavir/RushPoint < ~/Downloads/<the-key>.json
```

**Do NOT reuse `service-account.json` from the VPS for this.** That is the Admin SDK
credential: it carries full read/write access to Firestore and Auth, and putting it in a
GitHub secret would hand the entire database to any workflow — and to anyone able to land a
workflow file. Hosting deploy needs neither of those permissions.

**Confirm it works:** Actions → *Deploy marketing site* → **Run workflow**. A green run ends
with a Hosting release; check the site afterwards rather than trusting the green tick,
because a deploy that publishes the wrong directory also reports success (§12B's base-path
story is the same class of failure).

**If the deployed branch ever changes**, change it in three places in the same commit: this
workflow's `branches:` filter, `backend.branch` in `apps/marketing/public/admin/config.yml`,
and the assertion in `scripts/test-marketing-cms-config.ts` that pins it.
