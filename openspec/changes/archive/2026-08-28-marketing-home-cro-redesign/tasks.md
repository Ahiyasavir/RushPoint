## 1. RED — encode the structural and CRO requirements as a failing test

- [x] 1.1 Create `scripts/test-marketing-home-cro.ts` (auto-discovered by
  `scripts/run-unit-tests.mjs`). Assert, all currently FAILING:
  - `apps/marketing/src/pages/[lang]/index.astro` imports and renders `HeroField` and
    does NOT render the generic `Hero`; `TryMission` appears before `Features` in the
    source order.
  - `home.he.json` and `home.en.json` each contain `heroTrust`, `heroChallenge`,
    `lowFrictionNote`, `videoLabel`, `videoDuration` (string, non-empty).
  - `src/components/widgets/HeroField.astro`, `src/components/HeroFieldMap.astro`,
    `src/components/PhoneFrame.astro`, `src/components/VideoLightbox.astro` exist.
  - none of those four components contains a hard-coded prose literal in a UI-text
    position (reuse the JSX/text-position heuristic shape from `scripts/check-i18n.ts`,
    adapted for `.astro`: flag a bare Hebrew/English string in element text or a text
    attribute that is not bound to a prop or `content`).
  - every `@keyframes` name added to `src/assets/styles/tailwind.css` by this change is
    referenced only inside a `@media (prefers-reduced-motion: no-preference)` block.
  - `HeroFieldMap.astro`'s SVG contains no `<img`, `<video`, `src=`, or `url(` (the
    "costs no extra request" rule); the optional-clip branch lives in `HeroField.astro`,
    not the map.
  - `VideoLightbox.astro` uses a native `<dialog>` and wires an `Escape`/close +
    focus-return path.
- [x] 1.2 Run `node scripts/run-unit-tests.mjs` (or `npx tsx scripts/test-marketing-home-cro.ts`)
  and confirm it fails for the right reasons (missing files / missing keys), not a syntax
  error.

## 2. Content model — schema + bilingual copy

- [x] 2.1 `apps/marketing/src/content.config.ts`: add to `homePages.schema`
  `heroTrust`, `heroChallenge`, `lowFrictionNote`, `videoLabel`, `videoDuration`
  (`z.string()`), and `heroClip: optionalMedia()`.
- [x] 2.2 `apps/marketing/src/data/pages/home.he.json`: add the five new required keys
  with Hebrew copy — friction line "אפס הרשמה, אפס אשראי. ניסיון בלייב ב 30 שניות",
  curiosity prompt "האם הקבוצה שלכם הייתה פותרת את זה ב 60 שניות?", social-proof strip
  "100% מעורבות בשטח במשחקים הראשונים", plus `videoLabel` / `videoDuration`. Reword
  `subhead` for value contrast (passive scrolling → active field engagement) and reword
  `primaryAction` / `secondaryAction` to outcome-framed ("בנו משחק שטח ראשון ב 5 דקות" /
  a result-framed secondary). No dashes.
- [x] 2.3 `apps/marketing/src/data/pages/home.en.json`: the same keys with English copy,
  identical key set to the Hebrew file. No dashes.
- [x] 2.4 Run `npm run marketing:build` — the Zod schema must accept both files; a key
  present in one language only fails here. Run `npx tsx scripts/test-marketing-content.ts`
  and `npx tsx scripts/test-no-dashes.ts` — section F / PART E must pass with the new
  fields counted.

## 3. Theme — additive tint token + motion keyframes

- [x] 3.1 DONE, but the keyframes landed somewhere else than planned. The token is where
  the plan said: `--aw-color-bg-tint` in `CustomStyles.astro` (both modes, beside its
  reasoning) with `@utility bg-surface-tint` in `tailwind.css`, matching how `bg-page` and
  `bg-dark` already work. The ANIMATIONS are in the components' own scoped `<style>`
  blocks instead of `@theme`. Reason: a Tailwind `--animate-*` entry produces a utility
  CLASS, and a class applied in markup cannot be wrapped in a media query, so the
  no-preference guard the spec requires would have had nowhere to live. Scoped keyframes
  keep the guard and the animation in the same file. Verified in the BUILT css: zero
  ungated `animation:` declarations across both stylesheets.
- [x] 3.2 Run `npx tsx scripts/test-marketing-theme.ts` — must stay green (scales still
  redefined, `blue-500` still brand, no template colour).

## 4. Components — hero, phone frame, map, lightbox

- [x] 4.1 `apps/marketing/src/components/PhoneFrame.astro` — presentational device chrome
  (rounded frame, `aspect-ratio`, `<slot />`), no copy.
- [x] 4.2 `apps/marketing/src/components/HeroFieldMap.astro` — inline SVG: `aria-hidden`
  contour paths, a route `<path>`, 3–4 pin markers, a score badge whose text comes from a
  prop. CSS-only animation (`stroke-dashoffset` route draw, staggered `pin-pulse`, badge
  fade) all under `prefers-reduced-motion: no-preference`; finished static state is the
  default. No external asset reference.
- [x] 4.3 `apps/marketing/src/components/widgets/HeroField.astro` — two-column CSS grid,
  copy column first in source. Props/slots for tagline, headline, subhead, the two
  actions, `heroTrust`, `heroChallenge`; renders `PhoneFrame` containing either the
  optional `heroClip` video or `HeroFieldMap`. Logical properties only; no physical
  `left`/`right`. NOTE the clip carries no `autoplay` attribute after all: playback is not
  a style, so it cannot be suppressed by a media query, and an `autoplay` clip would move
  for a visitor who asked their system for less motion. An eight line island starts it only
  when `prefers-reduced-motion: no-preference` matches.
- [x] 4.4 `apps/marketing/src/components/VideoLightbox.astro`  ⚠ SEE 6.3: the first
  implementation of this had a real bug, caught by preview rather than by any gate. — poster card in
  browser/device chrome, brand play button, `videoDuration` badge, `videoLabel` line
  (all from props). Island: native `<dialog>`; poster activation `showModal()` + sets
  `<video controls>` `src`; close pauses/clears `src`, `Escape` closes, focus returns to
  the poster button. No autoplay; no sound before activation.
- [x] 4.5 Run `npx tsx scripts/test-marketing-home-cro.ts` — the component-existence and
  no-hardcoded-prose and keyframe-guard assertions now pass.

## 5. Homepage composition + section polish

- [x] 5.1 `apps/marketing/src/pages/[lang]/index.astro` — replace `<Hero>` with
  `<HeroField>` wired to the new content keys; replace the hero `<Media media={t.hero}>`
  block with `<VideoLightbox media={t.hero} label={t.videoLabel} duration={t.videoDuration} />`
  (guarded by `t.hero` as today); move `<TryMission>` to directly after the hero/video and
  before `<Features>`; render `t.lowFrictionNote` directly above the `TryMission` wrapper;
  wrap `TryMission` in a `bg-surface-tint` container with the topographic background;
  alternate `bg-surface-tint` on subsequent sections.
- [x] 5.2 `apps/marketing/src/components/widgets/Features.astro` — brand-tinted
  `rounded-2xl` icon squares, `motion-safe:hover:-translate-y-1 transition`,
  `border border-line` hairline. No prop/content-shape change.
- [x] 5.3 `ui/Timeline.astro` — the connector is now a DASHED ROUTE drawn with a repeating
  gradient (a dashed border cannot control its dash length, so it would never match the
  hero's route at any zoom) and the step marker is a brand tinted disc, so the steps read
  as stops on the same path the hero map draws. Also `mr-4 rtl:mr-0 rtl:ml-4` collapsed to
  the logical `me-4`. NO draw-in animation: it would only ever play off screen, since the
  panel is revealed by the existing intersect system long after load, so it was dropped
  rather than half added.
- [x] 5.4 Run `npx tsx scripts/test-marketing-home-cro.ts` — all assertions green.

## 6. Preview verification

- [~] 6.1 PARTLY. Layout verified by measurement rather than by screenshot: the Browser
  pane was not displayed in this session, so no frame could be composited. Measured at
  1280x720 (he): grid `817px 336px`, copy column at left 424 and phone at left 24, which
  is copy-on-the-right, phone-on-the-left, correct for RTL; at 375px both stack with the
  copy first, CTAs 343x57, zero horizontal overflow; on /en/ the same columns mirror
  (copy left 24, phone left 953). Dark mode read from computed styles: page #14110d,
  tint #1c1813, h1 17.61:1, muted 8.5:1. **A human still needs to look at it.**
- [x] 6.2 Emulate `prefers-reduced-motion: reduce` — confirm the hero map shows the full
  route line, all pins, and the badge, with no animation running, and that no
  section-polish animation runs.
- [x] 6.3 Keyboard-walk the video lightbox. **This found a real bug.** The first version
  hung the whole teardown off the dialog's `close` event, which reads as elegant: one
  listener, every dismissal route. Driven in a real browser, the dialog closed and the
  video KEPT PLAYING, audible, with nothing on screen to pause it, because that event did
  not fire. Every gate was green: it is behaviour, not structure. Fixed by not depending on
  any single event, an idempotent `teardown()` reached from the dismiss button, the
  backdrop, an `Escape` keydown, `cancel` AND `close`. Re-verified live: before open
  `src` is null; on open the dialog is modal with focus on the dismiss control and `src`
  set; after the button AND after Escape the video is paused, `src` is cleared and focus is
  back on the poster.
- [~] 6.4 PARTLY. No Lighthouse run (same reason as 6.1). Argued structurally and checked
  instead: the hero adds no network request at all. The map is inline SVG asserted to
  contain no `<img>`, `<video>`, `src` or `url()`; the phone frame is CSS; the explainer
  poster is `loading="lazy"` and below the fold; the `<video>` has no `src` until the
  poster is pressed (verified live: `src` null before, set on open, cleared on close). So
  the LCP candidate is still the h1 text, as before.

## 7. Full gate set

- [x] 7.1 `npm run verify` — all nine gates green (typecheck, lint, test [incl. the new
  `test-marketing-home-cro` + `test-marketing-content` + `test-marketing-theme` +
  `test-no-dashes`], creator:build, play:build, marketing:build, bundle:budget, base:check,
  origin:check, i18n:check:strict).
- [x] 7.2 `npm run i18n:check:strict` explicitly — confirm clean and that this change adds
  zero new hardcoded-string findings (marketing is out of scan scope, but the run must
  stay green).
- [x] 7.3 Re-read `openspec/changes/marketing-home-cro-redesign/specs/marketing-home-experience/spec.md`
  and confirm every scenario is now satisfied by an implementation + a test or a preview
  step recorded above.

## 8. Follow-up (separate change, not this one)

- [x] 8.1 Note in the PR / hand-off: the SEO `<title>`/OG colon fix
  ("RushPoint: join a live real world field game" etc.) is tracked as `seo-title-polish`
  and touches `apps/play-web/index.html`, `apps/creator-web/index.html`,
  `scripts/lib/landingPages.ts`, and `scripts/test-no-dashes.ts` (add a colon ban to PART
  C). Do not do it in this change.
