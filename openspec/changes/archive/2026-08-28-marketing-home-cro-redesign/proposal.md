## Why

The marketing homepage (`apps/marketing`, served at `www.rush-point.com`) reads as a
generic template: the fold is centred text on flat beige with no product visual, the
explainer video is a naked `<video controls>` that looks like a broken embed, and the one
asset that actually sells a field game, the playable `TryMission` widget, is buried below
six feature cards. The page describes the product competently but never lets a visitor
*feel* it, and it carries no deliberate conversion structure, no friction-reduction
microcopy, no curiosity gap, no outcome-framed calls to action.

This change rebuilds the homepage around one idea, "the map comes alive", and threads
conversion-rate-optimization and psychological triggers through the copy and layout, while
staying entirely inside `apps/marketing`.

## What Changes

- **New homepage hero** (`HeroField.astro`, used only by `src/pages/[lang]/index.astro`;
  the generic `Hero.astro` is untouched so the blog and other pages are unaffected):
  - Two-column, RTL-mirrored. Left: a small tagline chip, a larger headline with more
    weight contrast, a value-contrast subhead (passive phone scrolling → 100% active field
    engagement), two **outcome-framed** CTAs (e.g. "בנו משחק שטח ראשון ב 5 דקות" instead of
    "בונים משחק"), and a **quality social-proof strip** framed on engagement depth rather
    than raw counts (e.g. "100% מעורבות בשטח במשחקים הראשונים").
  - Right: a new `PhoneFrame.astro` containing an animated, inline-SVG contour map: a
    dashed route line that draws itself between three or four pins that pulse in sequence,
    plus a floating score badge ("משימה נפתרה +40"). Pure SVG + CSS, **no new media
    assets**. A **curiosity-gap** caption frames it as a live challenge
    ("האם הקבוצה שלכם הייתה פותרת את זה ב 60 שניות?").
  - An optional `heroClip` content field (mirroring the existing optional `hero` field) so
    a real muted screen-capture of play-web can later be dropped in as a content edit with
    no code change.
- **`TryMission` promoted** to immediately after the hero, before `Features` ("play before
  you read"), wrapped in a styled container with a soft topographic background. A
  **friction-reduction** line sits directly above it: "אפס הרשמה, אפס אשראי. ניסיון בלייב ב
  30 שניות".
- **New `VideoLightbox.astro`** replaces the bare `Media` render for the hero explainer
  only (`Media.astro` stays as-is for the gallery grid): a designed poster card in
  device/browser chrome, a large brand play button, a duration badge, and a one-line
  label; clicking opens a modal that plays the video large **with sound, user-initiated**.
  The existing "no autoplay with sound" principle is kept.
- **Visual rhythm pass** (all within `apps/marketing`): alternating section background
  tints via a new warm-tint token in `tailwind.css`; stronger heading weight/size
  contrast and smaller, letter-spaced taglines; `route-draw` and `pin-pulse` keyframes,
  all `prefers-reduced-motion`-aware; `Features` cards upgraded (brand-tinted icon
  squares, hover-lift, `--color-line` hairlines); the `Steps` timeline gains a
  route-line-with-pins motif tying into the map metaphor.
- **Copy rewrite** in `src/data/pages/home.he.json` and `home.en.json` (full HE + EN
  parity) to carry the new hero, CTA, social-proof, friction, and curiosity strings.

## Non-goals

- **The Google-result `<title>` / OG copy the user complained about** ("RushPoint: join a
  live real world field game", "RushPoint: build your own real world field game") is
  **not** served by `apps/marketing`. It lives in `apps/play-web/index.html`,
  `apps/creator-web/index.html`, and the generated landing pages in
  `scripts/lib/landingPages.ts`, and fixing it means touching those apps plus tightening
  `scripts/test-no-dashes.ts` to also ban a colon in shipped page metadata. That is a
  separate concern on a different surface and is proposed as its own change
  (`seo-title-polish`), so this one can stay cleanly inside `apps/marketing`.
- No new dependency, no framework runtime on the page, no backend or callable changes.
- No redesign of the blog, story, or contact pages; no change to `Header`/`Footer`.
- No change to the brand palette itself (`CustomStyles.astro` tokens stay; only additive
  tint/keyframe utilities are added to `tailwind.css`).

## Capabilities

### New Capabilities

- `marketing-home-experience`: what the marketing homepage must present and in what order,
  the conversion elements it must carry (friction-reduction microcopy, a curiosity-gap
  hero prompt, outcome-framed CTAs, engagement-depth social proof, value-contrast
  messaging), the interactive hero map and its reduced-motion fallback, the
  video-lightbox behaviour, and the accessibility and bilingual-parity constraints on all
  of it.

### Modified Capabilities

None. The homepage components add new concerns rather than changing existing
`marketing-site` behaviour, so they are captured as ADDED requirements in the new
`marketing-home-experience` spec. The existing `marketing-site` requirements (static
output, no framework runtime, one-origin URLs, bilingual language purity) continue to
apply unchanged and are re-asserted by the same tests.

## Impact

- **Surface touched:** `apps/marketing` only (Astro static site). No shared types, no
  callable, no `creator-web` / `play-web` / rules changes.
- **New files:** `src/components/widgets/HeroField.astro`,
  `src/components/PhoneFrame.astro`, `src/components/HeroFieldMap.astro`,
  `src/components/VideoLightbox.astro`.
- **Modified files:** `src/pages/[lang]/index.astro` (compose the new hero, reorder
  sections), `src/assets/styles/tailwind.css` (additive tint + keyframe utilities),
  `src/data/pages/home.he.json` + `home.en.json` (copy), `src/components/widgets/Features.astro`
  and `src/components/widgets/Steps.astro` (card + timeline polish),
  `src/components/Media.astro` (unchanged behaviour; the hero call site switches to
  `VideoLightbox`).
- **Content model:** `home.*.json` gains `heroTrust`, `heroChallenge`, `videoLabel`,
  `videoDuration`, `lowFrictionNote`, and optional `heroClip`; `content.config.ts` schema
  updated to match.
- **Tests / gates:** `npm run verify` already covers `marketing:build`,
  `check-marketing-output`, `test-marketing-theme` (the `slate`/`gray`/`blue` scale
  redefinitions must stay), `test-marketing-content` (HE-is-HE / EN-is-EN over the content
  files), `test-no-dashes` PART E, and `i18n:check:strict`. Plus preview screenshots at
  desktop / mobile / dark and an LCP sanity check on the new hero.
- **Risk:** the hero is the LCP element; the animated map must be an inline SVG with no
  blocking asset, and `prefers-reduced-motion` must resolve to the finished static frame.
