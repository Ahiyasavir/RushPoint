## 1. RED, assert the anchor and the strip before they exist

- [x] 1.1 In `scripts/test-marketing-home-cro.ts`, add a PART asserting the hero anchor per language:
      `home.he.json.headline` contains `מירוץ למיליון`, `home.en.json.headline` contains
      `Amazing Race`. Run it and confirm it fails against today's mechanism headline.
- [x] 1.2 Assert neither language's `subhead` matches the declared forbidden claim markers
      (`ניקוד אוטומטי`, `בלי שופטים`, `לבד`, `automatic`, `no staff`, `by itself`). Run and confirm
      it fails on today's `הניקוד מסתדר לבד`.
- [x] 1.3 Assert both content files carry `occasionDoors` with exactly four doors, each holding a non
      empty title, examples line and slug. Run and confirm it fails on the missing key.
- [x] 1.4 Assert the catch all marker: every Hebrew examples line contains `וכל`, every English one
      contains `and any`. Run and confirm it fails.
- [x] 1.5 Assert every door's slug is a member of `SUBJECT_SLUGS` imported from
      `scripts/lib/landingPages.ts`, in both languages, and that the two languages of a door carry
      the same slug. Run and confirm it fails.
- [x] 1.6 Assert section order in `src/pages/[lang]/index.astro`: `OccasionDoors` appears after
      `<HeroField` and before the `tryMission` block, and `TryMission`, `Features`, `Steps`,
      `MissionIdeas`, `GamePlanner`, `FAQs` and `CallToAction` all still appear in their current
      relative order. Run and confirm it fails.
- [x] 1.7 Assert the strip is not a gate: the component source has no `<dialog`, no `role="dialog"`
      and no `position: fixed`. Add
      `doors: 'src/components/widgets/OccasionDoors.astro'` to the existing `COMPONENTS` map so the
      no prose, attribute and reduced motion scans all cover it. Run and confirm it fails on the
      missing file.

## 2. RED, assert the landing pages before they exist

- [x] 2.1 In `scripts/test-landing-pages.ts`, add assertions that `LANDING_SUBJECTS` includes
      `home-activities` and `education`. Run it and confirm it fails.
- [x] 2.2 Add a PART asserting the corrective copy rule: the `home` subject's headline, title,
      description and intro contain no outdoor only framing (declared markers `יוצא החוצה`,
      `משחק שדה`, `בשטח`, `outdoor`, `goes outside`), and the `birthday` subject contains no
      `מהסלון` or `living room` framing. Run and confirm it fails on both subjects.

## 3. GREEN, the two new landing pages

- [x] 3.1 Add `home-activities` and `education` to `LANDING_SUBJECTS` and `SUBJECT_SLUGS` in
      `scripts/lib/landingPages.ts`, with slugs `pe-ilut-babayit` and `chinuch`.
- [x] 3.2 Author the Hebrew copy for both subjects: title, description, headline, intro, two body
      sections and a CTA label each, matching the depth and voice of the existing entries. Written
      in Hebrew, not translated. No dash of any kind in any string.
- [x] 3.3 Author the English copy for both subjects, written in English rather than translated from
      the Hebrew. Titles and descriptions must be unique across the whole registry.
- [x] 3.4 Run `npx tsx scripts/test-landing-pages.ts` and confirm task 2.1 passes and the page count
      is now 16, being 8 subjects across 2 languages.

## 4. GREEN, correct the copy that contradicts the product

- [x] 4.1 Rewrite the `home` subject's headline, title, description and intro in both languages so
      the general page reads as general: it must hold for a game played in a neighbourhood, in a
      school and in a living room.
- [x] 4.2 Rewrite the `birthday` subject's headline and any body copy that presumes leaving the
      house, in both languages, so an indoor birthday is included rather than excluded.
- [x] 4.3 Re run the landing page test and confirm task 2.2 passes. Leave `mitzvah`, `wedding`,
      `team-building` and `youth-group` untouched.

## 5. GREEN, the homepage content

- [x] 5.1 Replace `headline` and `subhead` in `home.he.json` with `תנו לכל קבוצה מירוץ למיליון משלה`
      and `בלי כל הבלגן שזה בדרך כלל דורש`.
- [x] 5.2 Replace the same fields in `home.en.json` with `Give any group their own Amazing Race` and
      `Without all the hassle it usually takes`. Re run and confirm 1.1 and 1.2 pass.
- [x] 5.3 Add the `occasionDoors` block to `home.he.json`: the four approved doors, each with title,
      examples line ending in a `וכל` clause, and slug (`yom-huledet`, `gibush-tzevet`,
      `pe-ilut-babayit`, `chinuch`).
- [x] 5.4 Add the English `occasionDoors` block, written in English, each examples line ending in an
      `and any` clause, same four slugs. Re run and confirm 1.3, 1.4 and 1.5 pass.
- [x] 5.5 Add a `home` place and at least four indoor ideas tagged to it in `missionIdeas`, in both
      language files. The ideas must assume no strangers, no shops, no street and no ingredient a
      flat cannot be assumed to have.
- [x] 5.6 Add `occasionDoors` to the `homePages` collection in `content.config.ts` as `.optional()`,
      matching how `tryMission` and `missionIdeas` are declared, with a comment saying why. Run
      `npx astro check` in `apps/marketing` and confirm it is clean.

## 6. GREEN, the component

- [x] 6.1 Create `apps/marketing/src/components/widgets/OccasionDoors.astro`: a heading and four
      `<a>` cards, every string from the `content` prop, no prose literal anywhere in the file.
- [x] 6.2 Style it inside the existing theme: token colours only, logical direction utilities only
      (`ms-`, `text-start`), a visible focus ring, and a tap target no smaller than the site's other
      controls.
- [x] 6.3 Render it in `src/pages/[lang]/index.astro` between `<HeroField/>` and the `tryMission`
      block, guarded by `t.occasionDoors &&`, resolving each href with
      `landingPageUrl(language, door.slug)`, with a comment stating the strip is additive and must
      never become a gate. Re run and confirm 1.6 and 1.7 pass and the file is green.

## 7. Verify what a source scan cannot see

- [x] 7.1 Preview both languages. With the strip present, scroll hero to footer and confirm every
      pre existing section is there, in order, unobstructed.
- [~] 7.2 Click each of the four cards and confirm each lands on its own landing page in the right
      language. PARTIAL: the four resolved hrefs were read out of the live DOM in both languages and
      are correct (`player.rush-point.com/<lang>/<slug>/`), and `test-landing-pages.ts` asserts every
      one of those files exists and matches the generator. NOT clicked through, because the
      destinations are the deployed player origin rather than anything served locally. Worth one
      human click each after deploy.
- [~] 7.3 Keyboard only: tab across the four cards and confirm the focus ring is clearly visible on
      each. PARTIAL: verified structurally (each card is an `<a>` carrying
      `focus-visible:outline-2` with an offset, and measures 122px tall on desktop, 99px on mobile,
      well past the 44px minimum). Not driven from a real keyboard.
- [x] 7.4 Hebrew: confirm the row mirrors correctly and no physical direction class is used. Check
      under `prefers-reduced-motion: reduce` that nothing added here animates.
- [x] 7.5 Record in the design's Open Questions whether the `tryMission` closing occasion question
      now reads as a third ask, without acting on it in this change.

## 8. Gates

- [x] 8.1 Run `npm test` and confirm both lanes are green, including `test-marketing-home-cro`,
      `test-landing-pages` and `test-no-dashes` with its marketing field count risen.
- [x] 8.2 Run `npm run i18n:check:strict` and confirm it is clean with zero new PART B findings.
- [x] 8.3 Run `npm run seo:build` so the generated landing pages include the two new subjects, and
      confirm the sitemap gained their URLs.
- [x] 8.4 Run `npm run verify` in full and confirm all nine gates are green. Report the result
      honestly, including any gate that fails.

## 9. Work the plan did not foresee, found by gates during implementation

- [x] 9.1 `test-no-dashes.ts` PART E and `test-marketing-content.ts` PART F both read `slug` as
      prose, so a correct URL failed as "a dash in copy" and as "English leaking into Hebrew".
      Added `slug` to each scanner's declared `NOT_PROSE` key pattern, with the reason, rather than
      renaming the slugs to satisfy the scan. Renaming would have broken the URL to fix nothing.
- [x] 9.2 `test-apex-deep-link.ts` asserts every landing page slug has a 301 in `firebase.json` so
      the apex does not swallow a link minted for the participant app. The two new subjects had
      none. Added eight redirects, both with and without the trailing slash, in both languages.
      This is precisely the drift that test's own comment predicts, and it caught it.
- [x] 9.3 `test-marketing-cms-config.ts` asserts every stored content field is editable in
      `public/admin/config.yml`. `occasionDoors` was not. Added it to both the Hebrew and English
      home page field sets, with hints that state the catch all requirement and that the slug must
      name an existing landing page rather than an invented one.
- [x] 9.4 `test-source-control-chars.ts` caught a literal NUL byte written into
      `scripts/test-landing-pages.ts` where a spaces separator was intended, which is the exact
      failure mode CLAUDE.md documents. Replaced with a visible separator. Left as a note here
      because it happened again despite being written down.
