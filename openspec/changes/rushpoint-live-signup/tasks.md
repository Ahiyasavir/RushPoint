# Tasks

Written after the fact against what was built, so the record matches the tree. The order
below is the order it was done in, and the RED step really did come first.

## 1. The validator (pure lane, RED first)

- [x] 1.1 RED — `scripts/test-live-application.ts` drives the rules that do not exist yet:
      the 5-8 team-size window, the sector allowlist, the 1-5 camera scale, every spelling
      of one Israeli phone number normalizing to one value, the photo data URL, the field
      bounds, and that each refusal NAMES the field.
- [x] 1.2 GREEN — `functions/src/contact/liveApplicationValidate.ts`. Pure: no Firestore,
      no functions runtime, no network. 91 checks pass.
- [x] 1.3 The photo cap is derived, not chosen: `express.json({ limit: '1mb' })` is mounted
      app-wide in `functions/server.js`, so a body over it is refused by the PARSER before
      any code can name a field. 520 KB of base64 leaves room for the prose.

## 2. The callables

- [x] 2.1 `submitLiveApplication` — reuses `rateKeyFor` from the contact module rather than
      restating it. Wide ATTEMPT budget charged first, tight STORE budget only after
      validation passes, so a team fixing a typo is not locked out.
- [x] 2.2 The photo is written to `liveApplications/{id}/photo/original`, not onto the
      application, so the list query never carries image bytes and the 1 MiB document
      ceiling is spent on the photo alone.
- [x] 2.3 `listLiveApplications` and `getLiveApplicationPhoto` — admin only, audit logged,
      and SEPARATE, so opening a photograph of identifiable people is a deliberate act by a
      named operator rather than a side effect of opening a page.
- [x] 2.4 Fields copied out BY NAME in the projection, so a field added to the stored
      document later cannot reach a response by default.
- [x] 2.5 `sendLiveApplicationNotification` through the existing send seam. The photo is
      deliberately NOT attached to the mail.

## 3. The guards

- [x] 3.1 `PUBLIC_CALLABLES` entry in `scripts/lib/callableHardening.mjs` with its reason —
      47 hardening checks green.
- [x] 3.2 `firestore.rules`: `liveApplications` closed in both directions, INCLUDING a
      recursive wildcard for the photo subcollection. A rule on the parent alone says
      nothing about a subcollection.
- [x] 3.3 Rate budgets in `packages/shared/src/rateLimit.ts`, with the reasoning for why the
      store budget is tighter and the attempt budget wider than the contact form's.
- [x] 3.4 `scripts/e2e-verify.mjs` scenario — the callable coverage guard fails the suite
      otherwise, which is the point: a new callable ships RED until it has a test.

## 4. The marketing surfaces

- [x] 4.1 `LiveEventBanner.astro` on the home page, under the hero, `language === 'he'` only.
- [x] 4.2 `/he/live/` — `getStaticPaths` emits ONE language, so `/en/live/` is a 404 rather
      than an English URL serving Hebrew.
- [x] 4.3 `LIVE_EVENT_PATH` declared in `utils/i18n.ts`, deliberately NOT a `STANDING_SUBJECT`.
- [x] 4.4 Client validation that answers instead of disabling the submit: marks every missing
      field, focuses the first. Verified in a real browser at 375px — 10 fields named, button
      never disabled.
- [x] 4.5 Browser downscale to 1280px with a quality ladder. Measured worst case: an 11.79 MB
      pure-noise 4032x3024 JPEG came out at 398,384 base64 characters, inside the client cap
      (400,000), the server cap (520,000) and the parser's 1 MB.

## 5. The admin surface

- [x] 5.1 `AdminLiveApplicationsPage.tsx` + route `/admin/live-applications` (not
      `/admin/live` — this app already has a creator-facing `/live` for live RUNS).
- [x] 5.2 Dictionary entries in both languages; `tel:` and `wa.me` built from the normalized
      digits while the number as WRITTEN is what is displayed.

## 6. Gates

- [x] 6.1 `npm run verify` — all nine green.
- [x] 6.2 Two whitelist fixes, both with the ordering trap documented: `'RushPoint Live'` is
      a brand name and must be stripped BEFORE the bare `'RushPoint'`, or its first word is
      eaten and a bare "Live" is left to read as an English leak. Added to
      `scripts/lib/i18nLeak.ts` AND to the deliberately re-derived copy in
      `apps/creator-web/src/lib/__tests__/i18nDictionary.test.ts`.
- [x] 6.3 Every dash removed from the new Hebrew copy — hyphen, em dash and maqaf alike, per
      the `ui-no-dashes` standard.
- [x] 6.4 `npm run e2e` against a fresh emulator — ✅ ALL PASS. The new scenario is 25
      checks, 0 failed, and the callable coverage guard introspected **125** deployed
      callables and covered all 125, so the three new ones are genuinely exercised.

## 7. Deployment (NOT done — needs the operator)

- [ ] 7.1 VPS: rebuild the API container so the three new callables exist. Until this lands
      the form posts to an endpoint that returns not-found.
- [ ] 7.2 `firebase deploy --only firestore:rules` for the `liveApplications` closure.
- [ ] 7.3 `npm run deploy:hosting` for the marketing site and the creator console.
- [ ] 7.4 Confirm `CONTACT_NOTIFY_TO` is set on the VPS, or the notification mail is a
      logged no-op and applications are only visible in the admin screen.
