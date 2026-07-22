# RushPoint — Launch Runbook (Blaze → Web → Google Play)

The single sequenced path from today's local-emulator setup to a live app on Google Play.

> **Why this file exists.** [DEPLOY.md](DEPLOY.md) is still written around Stripe payments, but
> the app now ships in **free mode** (`PAYMENTS_ENABLED = false` in
> [packages/shared/src/freeMode.ts](packages/shared/src/freeMode.ts)). **Skip DEPLOY.md §0** (money
> flow), **§4** (Stripe setup), **§6** (Stripe secrets), and the `functions/.env` Stripe rows in
> **§3** — none of it applies to this launch. Follow *this* file; use DEPLOY.md as the deeper
> reference for the sections it points to, and [PLAY_STORE.md](PLAY_STORE.md) for full TWA detail.

**Legend:** 🔴 = only you can do it (your account / your money / your key). ⚙️ = a script in this repo.

---

## Hosting decision: Firebase Hosting — *not* Netlify or Vercel

Use **Firebase Hosting**. Netlify/Vercel would add work and risk here without saving anything:

| | Firebase Hosting | Netlify / Vercel |
|---|---|---|
| Config | **Already done** — both targets in [firebase.json](firebase.json), sites mapped in [.firebaserc](.firebaserc) | Build 2 new projects from scratch |
| Deploy | **Already scripted** — `npm run deploy:all` ships hosting + functions + rules + indexes in one command | Separate pipeline; Functions still deploy via Firebase anyway |
| TWA origin | [twa-manifest.json](twa-manifest.json) already pins `rushpoint-play.web.app` | Must rewrite **every** URL in twa-manifest + re-issue assetlinks |
| Backend link | Same project as Functions/Firestore — no CORS setup | Cross-origin frontend → Functions |
| Cost | Free tier on Blaze is generous; effectively ₪0 at your scale | Also free, but you still pay Blaze for Functions regardless |

Netlify/Vercel can't host your backend either way — Functions + Firestore must live on Firebase.
Adding a second host means two dashboards and two deploy steps for zero benefit.

---

## Phase 0 — 🔴 Upgrade to Blaze, then immediately cap it

1. [Firebase Console](https://console.firebase.google.com) → your project `rushpoint-pwa-7daaa`
   → ⚙️ **Usage and billing** → **Modify plan** → **Blaze**. Requires a credit card.
2. **Do this in the same sitting — set a budget alert.** Blaze is pay-as-you-go with no
   built-in hard stop. Google Cloud Console → **Billing → Budgets & alerts → Create budget**
   → set e.g. **$5/month** with alerts at 50/90/100%.
   *Why:* the free quota is generous (2M function calls/month) and you will almost certainly pay
   ₪0, but a runaway loop or abuse without a budget alert is the one way this bites you.

> **This is the only step that costs money and the only one requiring a card.** Everything from
> here is free.

---

## Phase 1 — 🔴 One-time Firebase Console setup

1. **Authentication → Sign-in method** — enable all three:
   - **Email/Password** — creators
   - **Google** — creators (recommended)
   - **Anonymous** — ⚠️ **required**; participants and staff cannot join without it
2. **Firestore Database → Create database** — Native mode, region near your users
   (`europe-west1` or similar for Israel).
3. **Storage → Get started** — photo-mission uploads land here.
4. **Hosting → Add another site** — create **both**, names must match [.firebaserc](.firebaserc):
   - `rushpoint-creator`
   - `rushpoint-play`
5. **Project settings → Your apps** — confirm the web app config matches your `.env` files.
   (Both `apps/*/.env` already hold real values — verified, no action expected.)

---

## Phase 2 — ✅ Env files (already done)

`VITE_MAPTILER_KEY` was missing and **has now been added** to both `apps/creator-web/.env` and
`apps/play-web/.env`. Verified live against MapTiler: both the **geocoding** API (returns real
Hebrew, IL-biased results) and the **tiles** API return HTTP 200 — and the captured screenshots
show MapTiler tiles rendering. No action needed.

*Why it mattered:* without a key, the creator's location-picker geocoder falls back to the public
**Nominatim** service, which violates the
[Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/) for production
use. (Tiles have a keyless OpenTopoMap fallback; the geocoder was the real problem.)

> **Ignore `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`** in `functions/.env` — they're
> placeholders and stay that way. Free mode never calls Stripe.

> ⚠️ `.env` files are **gitignored**. If you build from another machine or a CI runner, copy them
> across — they don't travel with `git push`. Consider adding a domain restriction to the MapTiler
> key in their dashboard once your final origins are known.

---

## Phase 3 — ⚙️ Deploy the web app

> **Status 2026-07-22 — hosting is LIVE; the backend is NOT.** `deploy:hosting` succeeded for both
> sites and is verified serving real content (privacy policy live at
> `https://rushpoint-creator.web.app/privacy`). `deploy:backend` **fails** until Phase 0 (Blaze)
> and Phase 1 step 3 (Storage) are done — Functions cannot deploy without Blaze.
>
> ⚠️ **Both sites had been overwritten by a stale `playtest:ngrok` redirect stub**, which returned
> HTTP 200 on *every* path (SPA rewrite) including `manifest.webmanifest` and `icon-512.png`. A
> status-code check looks healthy against that stub. **Always verify deploy by inspecting content**,
> e.g. confirm `manifest.webmanifest` is real JSON and `icon-512.png` really is `image/png`.

From the repo root, gates first, then ship:

```bash
npm run verify
```

```bash
npm run deploy:all
```

`deploy:all` = `deploy:backend` (functions + Firestore rules + indexes + Storage rules) then
`deploy:hosting` (builds shared + both apps, deploys both sites).

You'll end up with:
- Creator console → `https://rushpoint-creator.web.app`
- Participant app → `https://rushpoint-play.web.app`

**Smoke test before going further:** sign up on the creator site, create a game from a quick-start
template, launch a run, join from your phone on the play site with the access code, complete a
task, then Finalize from the Run Console.

---

## Phase 4 — 🔴 Google Play Console account

Register at <https://play.google.com/console> — **one-time $25 USD**.
Business accounts need identity/D-U-N-S verification which can take **several days** — start this
early, in parallel with Phase 3.

---

## Phase 5 — Build the Android app (TWA)

The participant app reaches Play as a **Trusted Web Activity** — a thin native wrapper around the
deployed PWA. Only `play-web` is packaged; `creator-web` is web-only.

### 5a. ⚙️🔴 Generate the signing key + TWA project

```bash
npm run play:twa:init
```

🔴 During init Bubblewrap creates the signing keystore — save as `./android.keystore`, alias
`rushpoint` (both gitignored).

> ⚠️ **Back the keystore up somewhere safe and permanent. If you lose it you can never publish an
> update under the same listing — ever.**

Read its fingerprint:

```bash
keytool -list -v -keystore android.keystore -alias rushpoint
```

Copy the `SHA256:` line.

### 5b. ⚙️ Write the Digital Asset Links file

```bash
node scripts/gen-assetlinks.mjs --fingerprint=AA:BB:CC:...:99
```

```bash
npm run play:store:check
```

Both checks should now pass. (Before this step, `assetlinks.json` failing with *"no statements
(empty array)"* is **expected and correct** — not a bug.)

### 5c. 🔴 Redeploy so the file is actually served

```bash
npm run deploy:hosting
```

Confirm live: open `https://rushpoint-play.web.app/.well-known/assetlinks.json` in a browser.

### 5d. ⚙️ Build the bundle

```bash
npm run play:twa:build
```

Produces a signed `app-release-bundle.aab` (gitignored) — `.aab`, not `.apk`, is what Play requires.

---

## Phase 6 — 🔴 Upload, and fix the fingerprint trap

Upload the `.aab` to **Internal testing** first, not Production.

> ⚠️ **The #1 thing that breaks TWAs.** Google re-signs your app with its **own** key (Play App
> Signing), so the effective production fingerprint is **not** your upload key. After the first
> upload: Play Console → **Setup → App integrity** → copy the **App signing key certificate
> SHA-256**, then regenerate with **both** fingerprints:

```bash
node scripts/gen-assetlinks.mjs --fingerprint=<UPLOAD_KEY_SHA256> --fingerprint=<PLAY_SIGNING_SHA256>
```

```bash
npm run deploy:hosting
```

Skip this and the store-installed app shows a **browser URL bar instead of running full-screen**,
even though your local build verified perfectly.

**Verify on a real device from the testing track:** install, launch — **no URL bar = correct**.

---

## Phase 7 — 🔴 Play policy forms

Three forms, all required, all easy to get wrong:

1. **Data Safety** — answers are pre-derived from your Privacy Policy in the table in
   [PLAY_STORE.md §6](PLAY_STORE.md). Copy them across. Provide the deployed `/privacy` URL.
   ⚠️ Photos must be declared as **shared** — the live photo feed broadcasts them to every
   team in the run, not just to staff. Audio, in-app messages and device IDs are also
   collected; they are all in the table.
1b. **User Generated Content** — the live photo feed makes this a UGC app.
   [PLAY_STORE.md §6b](PLAY_STORE.md) has the answers. Before submitting, confirm the
   report button, the mute/block action and the Terms clause are actually live in the
   deployed app — reviewers check.
2. **Target audience & Families policy** — ⚠️ **read [PLAY_STORE.md §7](PLAY_STORE.md) properly.**
   RushPoint deliberately supports minors (youth groups, bar/bat mitzvah). Google's Families policy
   is global and stricter than the Israeli-law framing in your policy. Declaring "18+" just to dodge
   the paperwork is **itself a violation** when minors are a real audience. If unsure, get this
   reviewed by someone who knows Play Families policy before publishing.

Then roll out to Production and submit. First review can take several days.

---

## After launch — the daily update loop

```bash
npm run verify && npm run deploy:all
```

- **Web changes** are live the moment the deploy finishes — no Play review, no user action.
  This is the big win of the TWA approach: your day-to-day updates never touch the store.
- **A new `.aab` upload is only needed** when the native wrapper itself changes (app name, icon,
  package id, target origin, Bubblewrap version) — rare.

---

## Cost summary

| Item | Cost |
|---|---|
| Firebase Blaze | Card required; **₪0 expected** within free quota — cap it with a budget alert (Phase 0) |
| Firebase Hosting | Free tier, both sites |
| MapTiler key | Free, no card |
| Google Play Console | **$25 one-time** |
| Netlify / Vercel | Not used — skipped deliberately |
