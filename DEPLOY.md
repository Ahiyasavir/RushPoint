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
- **Audit-log reading** (`listAuditLogs`) requires an admin custom claim. To mint the first admin,
  set `RUSHPOINT_ADMIN_BOOTSTRAP=<your-email-or-uid>` in `functions/.env`, deploy, call the admin
  bootstrap once, then remove it.

---

## 7b. Run summary email (optional)

Every finalized run composes an organizer summary (final standings + completion stats + player
feedback digest). It is always shown in the creator Run Console. To also **email** it after each run,
add a mail provider key to `functions/.env`:

```
RESEND_API_KEY=re_xxx                            # from resend.com (free tier) — enables delivery
RUN_SUMMARY_EMAIL_TO=you@example.com             # optional — override recipient (else the owner's account email)
RUN_SUMMARY_EMAIL_FROM=onboarding@resend.dev      # optional — sender (default is Resend's sandbox address)
RUN_SUMMARY_EMAIL_ENABLED=false                   # optional — set to hard-disable (default ON)
```

Then **deploy the backend again** (§5) so the function picks it up. With no `RESEND_API_KEY`, sending
is a safe no-op (a log breadcrumb only) — nothing is sent and no network call is made.

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
