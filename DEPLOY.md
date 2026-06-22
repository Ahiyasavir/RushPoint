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
| `apps/creator-web/.env` | `VITE_FIREBASE_*` from your Web app config (+ optional `VITE_MAPTILER_KEY`) |
| `apps/play-web/.env` | same `VITE_FIREBASE_*` values (+ optional `VITE_MAPTILER_KEY`) |
| `functions/.env` | `APP_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (Stripe in §4) |

- `VITE_*` values are **public** (baked into the web bundle) — that's fine, they're not secrets.
- `functions/.env` holds **server secrets**; it is gitignored and only deployed to your functions.
  (For extra security you can use `firebase functions:secrets:set` instead — see §6.)
- **MapTiler** is optional: free tier, no card, https://cloud.maptiler.com. Without it maps fall
  back to keyless OpenTopoMap tiles.

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

- `deploy:backend` runs the `predeploy` hook in `firebase.json` (builds `@rushpoint/shared` then
  bundles the functions with esbuild — `@rushpoint/shared` is inlined, so Firebase never tries to
  install it from npm).
- After it finishes you'll have:
  - Creator console: `https://rushpoint-creator.web.app`
  - Participant app: `https://rushpoint-play.web.app`

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
npm run typecheck && npm run creator:build && npm run play:build && npm run e2e
```
