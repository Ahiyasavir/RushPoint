## Why

The owner cannot state what RushPoint is in one sentence, and every candidate sentence has failed
for the same structural reason: each concrete noun excludes a real use case. "Field race" excludes
the living room. "Build a game" excludes the ready made template. "Game" excludes a quiz or a chore
list. "For groups" excludes solo play. "Runs itself" overclaims against the live run console. A
sentence engineered to exclude nothing ends up saying nothing, which is where the current homepage
sits: the headline describes a mechanism ("bring stations, navigation and scoring together") rather
than putting a picture in a cold visitor's head.

The resolution is to stop compressing the whole platform into one line. The homepage leads with ONE
culturally anchored line that borrows an image the visitor already holds, and a strip of occasion
cards immediately below lets each visitor self select the door that matches why they came. The
platform stays exactly as broad as it is; only the order in which a stranger meets it changes.

## What Changes

- **Hero copy is replaced with a culturally anchored line.** Hebrew headline "תנו לכל קבוצה מירוץ
  למיליון משלה" with subhead "בלי כל הבלגן שזה בדרך כלל דורש". The anchor does the explaining: a
  visitor pictures the format in one beat, and the subhead answers the "wait, how" without claiming
  a specific feature that some use case would falsify.
- **English is an anchor SWAP, not a translation.** "Give any group their own Amazing Race" with
  "Without all the hassle it usually takes". מירוץ למיליון carries nothing outside Israel; Amazing
  Race is the globally legible equivalent format. This is a deliberate departure from the usual
  literal parity between the two content files, and the i18n checker must still see both as clean.
- **A new occasion strip sits directly under the hero**, with exactly four cards, each carrying a
  deliberate catch all clause so no visitor reads themselves as excluded:
  1. מסיבת יום הולדת · בר מצווה, מסיבת סיום, וכל חגיגה שרוצים שיזכרו
  2. גיבוש קבוצתי · עבודה, צבא, וכל קבוצה שרוצה להכיר את עצמה טוב יותר
  3. פעילויות בבית · משימות לילדים, ערב משפחתי, ערב עם בן או בת הזוג, וכל דבר שקורה בתוך הבית
  4. חינוך · בית ספר, אוניברסיטה, תנועת נוער, וכל מסגרת שרוצה ללמד אחרת
- **The strip is ADDITIVE, never a gate.** A visitor who ignores it keeps scrolling and reaches
  every existing homepage section unchanged, in the existing order. No interstitial, no forced
  fork, no modal.
- **Every card is a real link to a real, indexable page**, so a door can be shared, linked to from
  outside, and found in search on its own. All four behave identically.
- **Two new occasion landing pages are authored** so that all four doors have a destination:
  `home-activities` and `education` join the existing `birthday`, `mitzvah`, `wedding`,
  `team-building` and `youth-group` subjects in `scripts/lib/landingPages.ts`, which already gives
  every subject its hreflang pair, canonical, sitemap entry and structured data by derivation.
- **The stale outdoor only framing on the landing pages is corrected** where it now contradicts the
  product: the general landing page still leads with `המשחק יוצא החוצה`, and the birthday page is
  headlined `יום הולדת שיוצא מהסלון`, which actively excludes the living room birthday that is one
  of the four new doors.
- **The mission ideas generator gains an indoor place and indoor ideas**, so the activities at home
  door is not the one door on the page with nothing behind it.
- All new copy lives in `home.he.json` / `home.en.json` behind `content.config.ts`, never inline in
  a component, so the i18n gate keeps its teeth.

## Capabilities

### New Capabilities

None. This changes how an existing surface presents itself; it introduces no new product behavior.

### Modified Capabilities

- `marketing-home-experience`: the homepage hero requirement changes from a mechanism description to
  a culturally anchored line with a separate English anchor, and a new requirement is added for a
  non gating occasion strip rendered between the hero and the existing first section.
- `seo-landing-pages`: a new requirement that every homepage occasion door has a generated landing
  page, and a new requirement that landing copy does not frame the product as outdoor only on a
  page whose subject is not inherently outdoor.

## Impact

**Surfaces touched:** `apps/marketing` and the static landing page registry in `scripts/`. No shared
types, no callable, no rules, no creator-web, no play-web, no backend of any kind.

- `scripts/lib/landingPages.ts`: two new subjects with full Hebrew and English copy, two new slugs,
  and corrective edits to the `home` and `birthday` copy in both languages.
- `apps/marketing/src/navigation.ts`: `landingPageUrl` already accepts a slug; no change expected.

- `apps/marketing/src/data/pages/home.he.json`, `home.en.json`: `headline`, `subhead` and a new
  `occasionDoors` block.
- `apps/marketing/src/content.config.ts`: schema entry for `occasionDoors`.
- `apps/marketing/src/components/HeroField.astro`: keeps its current structure and its `heroTaste`
  prop. The strip is a new sibling component rendered after it, not a hero rewrite.
- New `apps/marketing/src/components/OccasionDoors.astro`.
- `apps/marketing/src/pages/index.astro` (or the current homepage composition file): renders the new
  sibling in position.
- `scripts/test-marketing-home-cro.ts`: extended, never weakened.
- Gates: `npm run i18n:check:strict` must stay clean with zero new PART B findings;
  `scripts/test-no-dashes.ts` governs every new string in both languages.

## Non-goals

- **The landing pages are not rewritten wholesale.** Only the two places where the copy now
  contradicts the product are corrected: the general page's outdoor only headline, and the birthday
  page's `leaves the living room` framing. The wedding, mitzvah, team building and youth group
  pages keep their copy, where an outdoor setting is a fair description of that occasion rather
  than an accidental narrowing.
- **The landing pages are not moved to the marketing origin.** They are served from the player
  origin by the existing generator. That is now arguably the wrong home for them given the apex is
  the marketing site, but moving indexed URLs is a redirect and sitemap change of its own.
- No analytics instrumentation is added here. The strip is built to be measured by the existing
  site analytics and to be reverted cheaply if it costs conversions; adding an events pipeline is
  out of scope.
- The rest of the homepage keeps its current copy, order and components.
