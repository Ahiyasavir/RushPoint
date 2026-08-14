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

---

## 3. Environment files

Copy each `.env.example` to `.env` (all are gitignored) and fill in real values.

| File | What goes in it |
|---|---|
| `apps/creator-web/.env` | `VITE_FIREBASE_*` from your Web app config + **required** `VITE_MAPTILER_KEY` (see below) |
| `apps/play-web/.env` | same `VITE_FIREBASE_*` values (+ optional `VITE_MAPTILER_KEY`) |
| `functions/.env` | `APP_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (Stripe in §4); optional `RESEND_API_KEY` for run-summary email (§7b) |

- `VITE_*` values are **public** (baked into the web bundle) — that's fine, they're not secrets.
- `functions/.env` holds **server secrets**; it is gitignored and only deployed to your functions.
  (For extra security you can use `firebase functions:secrets:set` instead — see §6.)
- **MapTiler** tiles are optional (maps fall back to keyless OpenTopoMap), but
  `VITE_MAPTILER_KEY` is **REQUIRED for `apps/creator-web` in production**: the location-picker
  geocoder falls back to the public **Nominatim** service without it, which violates the
  [Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/) for production
  use. Get a free key (no card) at https://cloud.maptiler.com and set:
  ```
  VITE_MAPTILER_KEY=<your-key>   # REQUIRED — without it the public Nominatim geocoder is used,
                                  # which violates the Nominatim Usage Policy for production use.
  ```

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

1. Open the **creator** site, sign up (email), create a game (try a Quick-start template), Launch a run.
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
