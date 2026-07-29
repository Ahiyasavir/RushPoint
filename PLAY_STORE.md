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

It validates three things against the real files:

1. **`apps/play-web/public/manifest.webmanifest`** meets Play/TWA install criteria
   (name, `short_name`, `standalone` display, theme + background color, a 512 `any`
   icon **and** a 512 `maskable` icon). This should already pass.
2. **`apps/play-web/public/.well-known/assetlinks.json`** is a valid, non-empty
   Digital Asset Links payload. **Until you complete Step 3 this is expected to FAIL**
   with "no statements (empty array)" — that is the correct signal, not a bug. The
   file ships as `[]` because no signing fingerprint exists yet.
3. **The generated Android project's target API level** meets Play's current floor
   (`PLAY_MIN_TARGET_SDK`, currently **36**). Play rejects uploads below it. Before
   Step 2 there is no generated project, so this check reports *"not checked"* and
   **skips** — re-run it after `play:twa:init` to get a real verdict. Bump the
   constant in [`packages/shared/src/playStore.ts`](packages/shared/src/playStore.ts)
   when Google raises the floor.

Deploy the current `play-web` to its production origin
(`https://rush-point.com` by default — see [DEPLOY.md](DEPLOY.md)) so the
manifest, icons, and (later) `assetlinks.json` are actually served over HTTPS.

---

## 2. Generate the signing key & the TWA project

The TWA is configured by [`twa-manifest.json`](twa-manifest.json) at the repo root
(package id `app.rushpoint.play`, origin, colors mirrored from the web manifest,
signing-key alias `rushpoint`).

> ⚠️ **Origin must match exactly.** If `play-web` is served from anything other than
> `https://rush-point.com` (e.g. a custom domain like `play.rushpoint.app`),
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

**Then re-run the gate** — now that the Android project exists, it can finally check
the target API level, which is what Play actually rejects on:

```bash
npm run play:store:check
```

> **Why the version is pinned.** `@bubblewrap/cli` is an exact devDependency
> (`1.24.1`) rather than a floating `npx` fetch. Bubblewrap chooses the generated
> project's `targetSdkVersion`, so an unpinned "whatever is latest today" made the
> single most rejection-prone property of the build non-reproducible and invisible to
> review. To adopt a newer Bubblewrap, bump the pin deliberately, re-run
> `play:twa:init`, and re-run the gate above.

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
| Photos collected? | **Yes**, collected. ⚠️ **Also shared with other participants** — see the photo-feed note below. Not sold. | §3.4 "Photos Uploaded During a Game" |
| **Audio files collected?** | **Yes** — audio-capture tasks record clips (≤60 s) uploaded for task review, same pipeline as photos. Not sold. | §3.4 |
| **Messages collected?** | **Yes — in-app messages.** The team↔HQ chat stores message text, sender id + display name. Visible to the team's own devices and the run's staff/organizer only; never sold or sent to third parties. | §3.4, §3.5 |
| **User IDs / device IDs?** | **Yes** — anonymous Firebase Auth UIDs, incl. the per-device `deviceUids` list that attaches multiple phones to one team. Used for team attachment + authorization only; not linked to advertising. | §3.2, §3.5 |
| Personal info (name/phone/etc.)? | **Only if a Creator adds custom join fields**; participant auth is anonymous. | §3.2, §3.5 |
| App activity / diagnostics? | **Yes — crash logs & diagnostics** (Sentry, only when `VITE_SENTRY_DSN` is set): stack trace, error message, breadcrumbs + reporter IP. No persistent user identifier is attached. No separate analytics/event SDK ships. | §3.6, §5 "Sentry" |
| Financial info? | **No.** Stripe/wallet code exists but is feature-flagged off (`PAYMENTS_ENABLED = false`, `packages/shared/src/freeMode.ts`) and unreachable in the submitted app. ⚠️ **Re-answer this before ever flipping that flag.** | — (free mode) |
| Contacts / Calendar? | **No** — neither API is used anywhere. The referral flow is a `?ref=` URL parameter only; the device contact list is never read. | — |
| Data sold or shared for ads? | **No sale, no sharing** for advertising; no tracking cookies/pixels. | §5, §9, §14 (CCPA) |
| Data encrypted in transit? | **Yes** (TLS 1.2+). | §6 |
| Can users request deletion? | **Yes** — account + data deletion (`deleteMyAccount`) and export (`exportMyData`). | §7, §8 |

> ⚠️ **Photos are shared between participants, not just with staff.** When a game has
> `photoFeedEnabled` (default on), an approved task photo is broadcast to the **live photo
> feed that every team in the run sees**. On the Data Safety form the Photos row must
> therefore be declared as **shared**, and the app must answer **Yes** to the User Content
> Sharing question in §6b below. Do not describe photos as staff-only.

Also provide the **Privacy Policy URL** (the deployed `/privacy` page) in the listing.

---

## 6b. 🔴 HUMAN STEP — User Generated Content declaration

The live photo feed makes RushPoint a UGC app under Play policy: participant-submitted
photos are broadcast run-wide and other participants can react to them. Answer the **User
Content Sharing** questions as follows:

| Play question | Answer | Why |
|---|---|---|
| Users interact / exchange content (voice, text, images)? | **Yes** | Live photo feed broadcasts a team's photos to every other team in the run, with emoji reactions. |
| Is UGC the app's *primary* content? | **No** | The organizer-authored game (stages + tasks) is the primary content; the feed is a live-ops layer. |
| Permits public sharing of nudity? | **No** | Content stays inside a single access-code-gated run; prohibited by the Terms. |
| Permits graphic violence? | **No** | Same. |
| Ability to **block** users / content? | **Yes** | Per-device mute of an individual item or of a whole team (see the `feed-ugc-safety` change). |
| Ability to **report** users / content? | **Yes** | `reportFeedItem` — any participant can report a feed item; 2 distinct reports auto-hide it pending staff review. |
| Chat moderation? | **Yes** | Team↔HQ chat is team-to-staff only (no team-to-team channel); staff see every message and the run owner can act on it. |
| Interactions limited to invited people only? | **Yes** | A run is reachable only with the organizer's access code — there is no public/open lobby. |

**Before you submit, confirm all three UGC controls are actually deployed** (they ship in the
`feed-ugc-safety` change): the participant report button, the mute/block action, and the
Terms clause naming the live feed. Play reviewers do check that a declared report control
exists in the running app.

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
