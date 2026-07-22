# Publishing RushPoint (play-web) to Google Play

RushPoint's participant app (`apps/play-web`) reaches Google Play as a **Trusted Web
Activity (TWA)** — a thin native Android wrapper around the deployed PWA. Google
verifies the wrapper against the web origin using a **Digital Asset Links** file at
`/.well-known/assetlinks.json`. This runbook takes you from a fresh checkout to a
live listing.

> **Scope.** Only `play-web` (the participant app) is packaged. `creator-web` has no
> in-app purchases, so Google Play Billing does **not** apply. The archived
> `apps/mobile` Expo app is out of scope and stays out of the workspaces.

Steps marked **🔴 HUMAN STEP** require your Google account, a paid account, a
secret key, or a policy decision — they can't be automated by tooling in this repo.
Everything else is a checked-in script.

---

## 0. One-time prerequisites

- **Node + this repo** installed (`npm install`).
- **JDK 17+** and the **Android SDK build-tools** on `PATH` (Bubblewrap needs them to
  build the `.aab`). Bubblewrap can install a managed JDK/SDK on first `init` if you
  let it.
- 🔴 **HUMAN STEP — Google Play Console developer account.** Register at
  <https://play.google.com/console> and pay the **one-time $25 USD** fee. Business
  accounts now require identity/D-U-N-S verification, which can take a few days —
  start this early.

---

## 1. Confirm the web app is submission-ready (automated)

The web side must be correct before wrapping. Run the gate:

```bash
npm run play:store:check
```

It validates two things against the real files:

1. **`apps/play-web/public/manifest.webmanifest`** meets Play/TWA install criteria
   (name, `short_name`, `standalone` display, theme + background color, a 512 `any`
   icon **and** a 512 `maskable` icon). This should already pass.
2. **`apps/play-web/public/.well-known/assetlinks.json`** is a valid, non-empty
   Digital Asset Links payload. **Until you complete Step 3 this is expected to FAIL**
   with "no statements (empty array)" — that is the correct signal, not a bug. The
   file ships as `[]` because no signing fingerprint exists yet.

Deploy the current `play-web` to its production origin
(`https://rushpoint-play.web.app` by default — see [DEPLOY.md](DEPLOY.md)) so the
manifest, icons, and (later) `assetlinks.json` are actually served over HTTPS.

---

## 2. Generate the signing key & the TWA project

The TWA is configured by [`twa-manifest.json`](twa-manifest.json) at the repo root
(package id `app.rushpoint.play`, origin, colors mirrored from the web manifest,
signing-key alias `rushpoint`).

> ⚠️ **Origin must match exactly.** If `play-web` is served from anything other than
> `https://rushpoint-play.web.app` (e.g. a custom domain like `play.rushpoint.app`),
> update **every** URL in `twa-manifest.json` (`host`, `startUrl`, `iconUrl`,
> `maskableIconUrl`, `webManifestUrl`, `fullScopeUrl`) before initializing, and make
> sure the generated `assetlinks.json` (Step 3) is deployed at **that** origin's
> `/.well-known/`. A mismatch makes verification silently fail — the app then shows a
> browser URL bar instead of running full-screen.

```bash
npm run play:twa:init     # → npx @bubblewrap/cli init --manifest ./twa-manifest.json
```

🔴 **HUMAN STEP — keystore.** During `init` (or via `keytool`), Bubblewrap creates the
signing keystore. Save it as `./android.keystore` with alias `rushpoint` (both are
**gitignored** — never commit a keystore). **Back it up somewhere safe: if you lose
it you can never update the app under the same listing.**

Read the keystore's **SHA-256 certificate fingerprint** — you need it for Step 3:

```bash
keytool -list -v -keystore android.keystore -alias rushpoint
# copy the "SHA256:" line (AA:BB:CC:...:99)
```

---

## 3. Write the Digital Asset Links file (automated, needs the fingerprint)

Feed the fingerprint from Step 2 into the generator. It writes a correct
`apps/play-web/public/.well-known/assetlinks.json`:

```bash
node scripts/gen-assetlinks.mjs --fingerprint=AA:BB:CC:...:99
```

Then re-run the gate — it should now pass:

```bash
npm run play:store:check   # ✓ manifest ready, ✓ assetlinks valid
```

🔴 **HUMAN STEP — deploy the file.** Redeploy `play-web` so the new
`assetlinks.json` is actually served at
`https://<origin>/.well-known/assetlinks.json`. You can confirm it's live by opening
that URL in a browser.

---

## 4. Build the Android App Bundle (automated)

```bash
npm run play:twa:build    # → npx @bubblewrap/cli build  → app-release-bundle.aab
```

This produces a signed `.aab` (also gitignored). The `.aab`, not an `.apk`, is what
Play requires.

---

## 5. Create the Play listing & upload

🔴 **HUMAN STEP — all of this is in the Play Console UI:**

- **Create the app**, choosing **App (not game)** category is your call; select
  default language and "Free".
- **Upload the `.aab`** to a testing track first (Internal testing → Closed →
  Production). Do internal testing before production.
- **Play App Signing.** Google re-signs your app with a Play-managed key. This means
  the *effective* production fingerprint is Google's, **not** your upload key. After
  the first upload, copy the **"App signing key certificate" SHA-256** from
  *Play Console → Setup → App integrity*, then add it alongside your upload key:

  ```bash
  node scripts/gen-assetlinks.mjs \
    --fingerprint=<UPLOAD_KEY_SHA256> \
    --fingerprint=<PLAY_APP_SIGNING_SHA256>
  ```

  Redeploy `play-web` with the updated `assetlinks.json`. **If you skip this, deep
  links / origin verification break for installs from the Play Store** even though
  your local build verified fine.
- **Store listing:** short + full description, screenshots (phone), feature graphic,
  the app icon (reuse `apps/play-web/public/icon-512.png`).

---

## 6. 🔴 HUMAN STEP — Data Safety form

Play requires a Data Safety declaration. Answer it to match our Privacy Policy
([`apps/creator-web/src/pages/LegalPage.tsx`](apps/creator-web/src/pages/LegalPage.tsx),
English sections cited):

| Play question | Answer | Basis (Privacy Policy) |
|---|---|---|
| Location collected? | **Yes — precise location**, collected & **not** shared, only during an active run, for app functionality (routing/geofence). | §3.3 "GPS Location Data" |
| Photos collected? | **Yes**, collected & shared **only with the game's Creator/staff** for task review; not sold. | §3.4 "Photos Uploaded During a Game" |
| Personal info (name/phone/etc.)? | **Only if a Creator adds custom join fields**; participant auth is anonymous. | §3.2, §3.5 |
| App activity / diagnostics? | **Yes — crash logs & diagnostics** (Sentry, when enabled): IP + stack trace, for app functionality only. | §3.6, §5 "Sentry" |
| Data sold or shared for ads? | **No sale, no sharing** for advertising; no tracking cookies/pixels. | §5, §9, §14 (CCPA) |
| Data encrypted in transit? | **Yes** (TLS 1.2+). | §6 |
| Can users request deletion? | **Yes** — account + data deletion (`deleteMyAccount`) and export (`exportMyData`). | §7, §8 |

Also provide the **Privacy Policy URL** (the deployed `/privacy` page) in the listing.

---

## 7. 🔴 HUMAN STEP — Target audience & Families policy (READ THIS)

RushPoint intentionally supports **minor participants** via the guardian-consent
mechanism (youth groups, bar/bat mitzvah events — Privacy Policy §11, Terms §6.1(g)).
Google's **Families / target-audience** policy is **global and stricter** than the
Israeli-law framing in our policy, and getting this wrong risks app removal. You must
decide and declare, in *Play Console → Policy → App content → Target audience*:

- **Target age groups.** If you include under-13 (or under-16 in some regions), the
  app enters the **Designed for Families / mixed-audience** program with extra
  requirements: a neutral age screen, no ads that don't meet Families ad policy, and
  compliant SDKs.
- **Note:** the *account holder* (Creator) is 16+, but *participants* can be younger.
  The app that ships to Play is `play-web` (the participant app), so its declared
  audience should reflect that minors may play. Decide deliberately; don't just pick
  "18+" to avoid the paperwork if minors are a real audience — misdeclaring is itself
  a violation.
- Confirm any analytics/crash SDK (Sentry) settings are acceptable for your declared
  audience.

If you are unsure, get this reviewed by someone familiar with Google Play Families
policy before publishing.

---

## 8. Submit for review

🔴 **HUMAN STEP.** Roll out on a testing track, verify install + full-screen launch
(no URL bar = Asset Links verified correctly), then promote to Production and submit.
First reviews can take several days.

---

## Quick reference — what's in the repo vs. what's on you

| Provided by this repo (automated) | 🔴 You must do (human) |
|---|---|
| `twa-manifest.json` (Bubblewrap config) | Play Console account ($25) |
| `npm run play:store:check` (submission gate) | Generate & back up the keystore |
| `scripts/gen-assetlinks.mjs` (writes assetlinks) | Deploy `assetlinks.json` at the origin |
| `npm run play:twa:init` / `:build` | Upload `.aab`, manage tracks |
| `@rushpoint/shared` validators (unit-tested) | Data Safety form |
| `.gitignore` for keystore/`.aab` | Target-audience / Families declaration |
