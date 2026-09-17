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

## 8. Later passes (same change, later decisions)

- [x] 8.1 **Urgency** — a countdown anchored to an absolute instant (Thursday 22 October
      2026, 19:00 IDT), bounded on read so a wrong device clock hides it rather than
      printing an absurd number. The prize AMOUNT came out: it is not fixed, and a number
      we might not keep is the one claim a team could catch us out on.
- [x] 8.2 **The questions read as an interview** — numbered cards, the question as the
      headline, no red asterisks, a badge that becomes a check when answered.
- [x] 8.3 **English** — the page is bilingual and `live` is a STANDING_SUBJECT, so the
      hreflang cluster is symmetric and the language switch lands on the counterpart. It
      was Hebrew only on the reasoning that an English page advertises to people who
      cannot attend; that was half right, because a large part of Israel reads English
      first. WHERE a reader is now decides whether the home page BAND shows
      (`utils/israelAudience.ts`), and the PAGE is never gated — links get shared.
- [x] 8.4 **Follow, without forcing it** — Instagram, TikTok and Facebook. Not a gate and
      not a checkbox: a self-declared box would be true by construction for every
      application, so it would collect nothing and cost a step. The ask carries a REASON
      that serves the applicant (the ten teams are announced there) and the primary
      placement is the success screen, at peak commitment.
- [x] 8.5 **The group photo is OPTIONAL.** A team that cannot get everyone into one
      picture tonight can still apply tonight. Nine required answers, so the progress bar
      counts nine — counting ten would strand a team that skipped it at "9 of 10" while
      the form submitted happily. A photo that IS sent is validated exactly as strictly
      as before: optional means "may be absent", never "may be anything".
      `hasPhoto` is stored explicitly so the admin list can tell "no photo" from "a photo
      I have not fetched", which would otherwise look identical.

## 9. Gate repairs found along the way

- [x] 9.1 `test-marketing-content.ts` asked its regex for literals of 4+ characters, which
      made any SHORTER literal (`'10'`, `'01'`) desynchronise the whole scan: the engine
      resumed at that literal's closing quote, paired it with the next opening one, and
      reported the punctuation BETWEEN two strings as English prose. Fifty findings that
      all described nothing. It matches every literal and filters by length now — and the
      corrected gate immediately found a REAL leak the broken one had buried.
- [x] 9.2 Latin whitelist: `RushPoint Live` (before the bare `RushPoint`, or its first
      word is eaten), the file-format acronyms `JPG/JPEG/PNG/WebP`, and the social handles.
