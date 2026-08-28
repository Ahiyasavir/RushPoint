## Context

`apps/marketing` is a vendored AstroWind template themed to RushPoint. It is a **static**
Astro site: no framework runtime on the page, copy lives in per-language JSON content
files (`src/data/pages/home.{he,en}.json`) validated by a Zod schema in
`src/content.config.ts`, and the palette/typography is repointed to the product in
`src/components/CustomStyles.astro` + `src/assets/styles/tailwind.css` (the `slate`,
`gray`, `blue` Tailwind scales are redefined to a warm ramp; `test-marketing-theme.ts`
guards that). The homepage (`src/pages/[lang]/index.astro`) currently composes
`Hero` → optional `Media` (the explainer video) → `Features` → `Steps` → `TryMission` →
`MissionIdeas` → `GamePlanner` → `FAQs` → gallery → `CallToAction`.

Constraints that shape the design:

- **No `t.*` dictionary here.** Every visible string must come from the content JSON, and
  both language files must carry it (the Zod schema fails the build if a required key is
  missing in one language; `test-marketing-content.ts` fails if a Hebrew field leaks
  English or vice versa).
- **No dashes** in any copy (`test-no-dashes.ts` PART E scans `src/data/pages/*.json`).
- **Static-first.** `marketing-site` spec: headings/body/links must be in the initial HTML
  with scripting disabled; any script must be page-confined and not a prerequisite for
  reading the page. Astro islands (`<script>` in an `.astro` file, or `client:*`
  directives) are the sanctioned pattern — `TryMission`, `MissionIdeas`, `GamePlanner` are
  all vanilla-JS islands already.
- **The hero is the LCP element.** Whatever goes in the visual column must not add a
  render-blocking or large async asset.
- `www.rush-point.com` is the origin (`config.yaml`); the marketing site is the only thing
  this change touches.

## Goals / Non-Goals

**Goals:**

- A homepage that lets a visitor *feel* a field game within the first screen and the first
  interaction, with deliberate conversion structure (friction reduction, curiosity gap,
  outcome-framed CTAs, engagement-depth social proof, value contrast).
- A modern visual system (living-map metaphor, section rhythm, motion) built only from the
  existing theme tokens plus additive utilities.
- Zero new runtime dependencies, zero new media assets, full HE/EN parity, full
  reduced-motion and keyboard support.

**Non-Goals:**

- The SEO `<title>`/OG colon problem (`apps/play-web`, `apps/creator-web`,
  `scripts/lib/landingPages.ts`) — separate change `seo-title-polish`.
- Blog / story / contact / header / footer redesign.
- Brand palette changes; changes to `Hero.astro`, `Media.astro` behaviour, or other pages'
  use of them.
- A/B testing infrastructure or analytics events (none exist on the site today).

## Decisions

### D1 — New `HeroField.astro`, homepage-only; leave `Hero.astro` alone

`Hero.astro` is used by other pages via slots. Rather than branch it, add a dedicated
`src/components/widgets/HeroField.astro` and swap only the homepage's `<Hero>` for it in
`src/pages/[lang]/index.astro`. Two-column with CSS grid; RTL handled by logical
properties and source order (copy column first in the DOM, which is also the correct
mobile stack order and the correct RTL reading order).

*Alternative considered:* a `variant="field"` prop on `Hero.astro`. Rejected — it would
put homepage-specific markup and a homepage-specific island inside a component five other
pages render, and every future edit would have to reason about all six.

### D2 — Hero visual is an inline-SVG animated contour map in `PhoneFrame.astro`

`HeroFieldMap.astro` renders an inline `<svg>`: a few contour paths (decorative,
`aria-hidden`), a `<path>` route line, and 3–4 pin markers. Animation is CSS only:
`stroke-dasharray`/`stroke-dashoffset` transition on the route line (`route-draw`
keyframe), staggered `pin-pulse` on the pins, and a `score-badge` fade/slide. All
keyframes are wrapped:

```css
@media (prefers-reduced-motion: no-preference) { /* animations here */ }
```

so `reduce` gets the finished static state by default (dashoffset 0, pins at rest, badge
visible). `PhoneFrame.astro` is a presentational wrapper (rounded device chrome, notch,
`aspect-ratio`) reused by the optional real-clip path.

*Why not a muted autoplay `<video>` loop:* it needs an asset the user would have to
record, it competes for LCP, and mobile data cost is exactly the concern `Media.astro`'s
comment documents. The SVG is a few KB inline, costs no request, and animates for free.

*Content hook:* `home.*.json` gets an **optional** `heroClip` (`optionalMedia()` shape).
`HeroField.astro`: `heroClip ? <PhoneFrame><video muted loop playsinline autoplay
preload="metadata" .../></PhoneFrame> : <PhoneFrame><HeroFieldMap/></PhoneFrame>`. Dropping
in a real clip later is a content edit, mirroring the existing optional `hero` field.

### D3 — `VideoLightbox.astro` for the hero explainer; `Media.astro` unchanged

New `src/components/VideoLightbox.astro`: renders the poster (`media.poster`) inside
browser/device chrome with a brand play button, a `videoDuration` badge, and a `videoLabel`
line. A small island wires a `<dialog>` element (native, focus-trapping, `Escape` to
close, `::backdrop`): on poster activation it `showModal()`s and sets the `<video
controls>` `src` (so nothing is fetched until open); on close it pauses/clears and returns
focus to the poster button. `index.astro` swaps the hero's `<Media media={t.hero} eager>`
call for `<VideoLightbox media={t.hero} .../>`. The gallery keeps `<Media>`.

*Alternative considered:* enhance `Media.astro` with an optional `lightbox` prop. Rejected
for the same reason as D1 — the gallery grid genuinely wants the inline element; the hero
wants a poster-and-modal. Two components, each simple.

### D4 — Section rhythm via one additive tint token + a shared section wrapper

Add to `tailwind.css` `@theme`: `--color-surface-tint` (light: a warm ~`#f7f1e8` off the
existing ramp; dark: a lifted `#1b1712`), plus a `@utility bg-surface-tint`. `index.astro`
alternates plain page surface and `bg-surface-tint` per section. `test-marketing-theme.ts`
section E only asserts the `slate`/`gray`/`blue` scales are still ≥10 steps and that
`blue-500` is the brand — a new token does not disturb it; section C only bans the named
template colours. New keyframes (`route-draw`, `pin-pulse`, `score-badge`, a `timeline
route` draw for `Steps`) go in the same `@theme` block, each used only inside a
`prefers-reduced-motion: no-preference` media query.

### D5 — `Features.astro` and `Steps.astro` polish is class-only

`Features.astro`: wrap each icon in a `rounded-2xl` brand-tinted square, add
`hover:-translate-y-1 transition`, a `border border-line` hairline, `motion-safe:`
guarded. `Steps.astro` / `Timeline.astro`: add a vertical route line with pin dots down
the timeline (pseudo-element or an inline SVG spine), `motion-safe` draw-in. No prop or
content-shape changes, so no schema or parity impact.

### D6 — Copy changes are additive keys in the schema

`content.config.ts` `homePages.schema` gains: `heroTrust: z.string()`,
`heroChallenge: z.string()`, `lowFrictionNote: z.string()`, `videoLabel: z.string()`,
`videoDuration: z.string()`, `heroClip: optionalMedia()`. The two existing CTA strings
(`primaryAction`, `secondaryAction`) are **reworded** in place (outcome-framed), not
renamed, so `CallToAction` at the page bottom picks up the same improved labels. `subhead`
is reworded for value contrast. All new required keys are added to **both**
`home.he.json` and `home.en.json` in the same commit.

## Test Strategy

This change is **UI + content only** — no pure logic, no callable, no shared types. It is
proven by:

1. **`npm run verify`** (the nine-gate gauntlet), which for this change exercises:
   - `marketing:build` — the Zod schema accepts the new keys; a key missing from one
     language fails here.
   - `check-marketing-output` — built homepage still static, canonical/alternates intact,
     no framework runtime, no language leak in the built HTML.
   - `test-marketing-content` (section F) — every new Hebrew string is Hebrew, every new
     English string is English (shared `i18nLeak` predicate).
   - `test-marketing-theme` — `slate`/`gray`/`blue` scales still redefined, `blue-500`
     still the brand, no template colour, faces still carry Hebrew.
   - `test-no-dashes` (PART E) — new homepage copy is dash-free and counted.
   - `i18n:check:strict` — unaffected (marketing is out of its scan scope) but must stay
     green.
2. **A new `scripts/test-marketing-home-cro.ts`** (auto-discovered by
   `run-unit-tests.mjs`) asserting the structural/CRO requirements that a build cannot:
   - the homepage source composes `HeroField` (not `Hero`) and orders `TryMission` before
     `Features`;
   - `home.{he,en}.json` both contain `heroTrust`, `heroChallenge`, `lowFrictionNote`,
     `videoLabel`, `videoDuration`;
   - `HeroField.astro` / `HeroFieldMap.astro` / `PhoneFrame.astro` / `VideoLightbox.astro`
     contain no hard-coded prose literal (every visible string arrives as a prop / from
     content), matched the way `check-i18n` PART B detects UI-text positions;
   - every `@keyframes` added to `tailwind.css` in this change is referenced only within a
     `prefers-reduced-motion: no-preference` block;
   - `VideoLightbox.astro` uses a native `<dialog>` and wires `Escape` + focus return;
   - the SVG hero map markup contains no `<img>`, `<video>`, `src=`, or `url(` outside the
     optional-clip branch (the "costs no extra request" scenario).
3. **Preview verification** (browser tools): screenshots at desktop / mobile / dark;
   `prefers-reduced-motion` emulation showing the finished static map; keyboard walk of the
   video lightbox (open, `Escape`, focus return); a Lighthouse/PerformanceInsights LCP
   check on the new hero (must not regress vs the current text hero).

## Risks / Trade-offs

- **[LCP regression from the hero visual]** → the map is inline SVG, no asset, no request;
  the phone frame is CSS. The `test-marketing-home-cro.ts` "no external ref in the SVG"
  assertion + the manual LCP check guard it. The optional `heroClip` video, if ever added,
  uses `preload="metadata"` and is not the LCP candidate (the headline is).
- **[Animation reads as busy / distracting]** → motion is short, runs once (route draw,
  badge), pins pulse subtly; everything is `prefers-reduced-motion` off by default in that
  path. Tunable in one keyframe block.
- **[`test-marketing-theme.ts` false failure from the new tint token]** → verified against
  its actual assertions (sections C and E): it checks named template colours are absent
  and the three scales are ≥10 steps with `blue-500` == brand. An additive
  `--color-surface-tint` touches none of that. If a future assertion tightens to "no
  colour outside the ramp", this token is derived from the ramp and can be added to its
  allowlist.
- **[Hebrew RTL breakage in the two-column grid]** → source order is copy-first (correct
  for RTL reading and mobile stacking); the grid uses `grid-template-columns` with no
  physical float; tested with the dark + Hebrew screenshot and the existing
  `check-marketing-output` language-direction assertions.
- **[Copy reword changes an indexed `<title>`]** → the homepage `<title>` comes from
  `home.*.json` `title` via the `%s, RushPoint` template and is **not** reworded by this
  change (only `subhead`, the CTAs, and the new keys change). Meta `description` is
  likewise left unless explicitly improved, to keep the SEO surface stable while
  `seo-title-polish` handles titles holistically.

## Migration Plan

Pure static-site change. Deploy is the normal `apps/marketing` build + publish
(`deploy-marketing.yml`). No data migration, no flag. Rollback = revert the commit and
redeploy; the content JSON changes revert cleanly with the code.

## Open Questions

- **Split or not:** proposal treats the SEO-title/colon fix as a separate change
  (`seo-title-polish`). Confirm that split is what you want, or say to fold it in here and
  accept edits outside `apps/marketing`.
- **Real hero clip now vs later:** default plan ships the SVG animation and leaves
  `heroClip` empty. If you want a real ~10s muted play-web capture from day one, that is a
  recording task on your side and a one-line content edit after.
- **Exact social-proof wording:** the spec fixes the *shape* (engagement depth, not
  counts). Final HE/EN phrasing to be settled in `tasks.md` copy step — "100% מעורבות
  בשטח במשחקים הראשונים" is the working line; flag if the number should be softer.
