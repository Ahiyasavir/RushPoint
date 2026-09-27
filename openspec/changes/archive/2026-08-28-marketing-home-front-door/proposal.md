## Why

Feedback on the shipped homepage, from the person whose site it is:

- The cipher demo mission was unsolvable in practice. It asked the visitor to count to 17,
  20 and 15 in the Hebrew alphabet with no reference; a consistent off-by-one, which is
  easy, produced a plausible looking wrong word ("עקן") and the demo felt broken. The
  English version's numbers had never been adjusted for the English alphabet at all, so it
  decoded to "QTO".
- The explainer video "did not look good": it did not start on its own, the poster was an
  awkward crop of a face, and the modal slid in from the top edge with its dismiss control
  half off screen.
- Spelling: "ומגללת" for "וגוללת", and a request to sweep for others.
- The pages that are not the homepage carry no media and nothing for the eye to hold.
- The site is meant to become the front door at `rush-point.com`, so it must make both
  paths obvious: a creator who builds a game, and a participant who just has a code.

## What Changes

- **The cipher mission is rebuilt to be solvable.** The prompt spells out the key it needs
  (`א=1 … ז=7`) and uses small numbers. HE decodes to "זהב", EN to "ace". Both are inside
  the key that is given, so there is nothing to count.
- **The explainer video plays inline, muted, on its own.** `FounderVideo.astro` replaces
  the poster-and-modal `VideoLightbox.astro`. It starts muted when it scrolls into view
  (IntersectionObserver, not the `autoplay` attribute, so it only ever runs on screen and
  pauses when it leaves), does not loop, is shown at the file's real 9:16 ratio beside a
  short written version and a link to the full story, and carries one large "turn on
  sound" control. Under `prefers-reduced-motion` it does not autostart. No modal.
- **Two doors, always visible.** The header gains a "יש לי קוד" / "I have a code" link to
  the participant app beside "build a game", and the hero adds a "here to join a game?"
  line under its CTAs. So a participant who followed a link to the marketing site is one
  click from entering their code.
- **The story page is drawn as a route.** Its chronological sections become a timeline
  with numbered pins and the same dashed-route connector the homepage map and steps use,
  plus a contour backdrop and a pull-quote closing. No photography is invented; the
  structure is the visual. The contact page gains the same contour backdrop.
- **Spelling fixes** in the Hebrew homepage copy.

## Non-goals

- Moving the marketing site to the `rush-point.com` apex (currently the participant app).
  That is a DNS, hosting, landing-page-origin and deep-link change with live-event impact
  and is left as an open question for the owner.
- Blog redesign; real photography; any backend or app change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `marketing-home-experience`: two requirements change. "The explainer video is presented
  as a poster card that opens a player" is replaced by an inline autoplay contract. "The
  homepage carries explicit conversion elements" gains the participant door as a required
  element, and the demo-mission solvability becomes a stated requirement.

## Impact

- **Surface:** `apps/marketing` only.
- **New:** `src/components/FounderVideo.astro`. **Removed:** `src/components/VideoLightbox.astro`.
- **Modified:** `src/components/widgets/HeroField.astro`, `src/pages/[lang]/index.astro`,
  `src/pages/[lang]/story/index.astro`, `src/pages/[lang]/contact/index.astro`,
  `src/navigation.ts`, `src/content.config.ts`, `src/data/pages/home.{he,en}.json`,
  `public/admin/config.yml`, `scripts/test-marketing-home-cro.ts`.
- **Content model:** `home.*.json` gains `heroJoinPrompt`, `heroJoinAction`, `videoBody`,
  `videoStoryAction`; `videoLabel` / `videoDuration` keep their names, new meaning.
- **Gates:** `npm run verify` (green). No new gate; `test-marketing-home-cro.ts` updated
  to the inline-video contract and the new keys.
