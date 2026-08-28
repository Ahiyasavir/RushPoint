## 1. Cipher mission

- [x] 1.1 `home.he.json` answer mission: prompt spells `א=1 … ז=7`, numbers `7 · 5 · 2`,
  answer `זהב`, hint reworded, `רמז:` prefix dropped for parity with EN.
- [x] 1.2 `home.en.json` answer mission: prompt spells `A=1 … G=7`, numbers `1 · 3 · 5`,
  answer `ace`, hint reworded. (Old numbers decoded to nonsense in English.)

## 2. Spelling

- [x] 2.1 `home.he.json` subhead: `ומגללת` → `וגוללת`. Sweep the strings this change
  touches; the rest of the file is the owner's own voice and left alone.

## 3. Founder video

- [x] 3.1 Delete `VideoLightbox.astro`. Add `FounderVideo.astro`: inline `<video>`,
  `muted playsinline controls`, no `autoplay` attr; IntersectionObserver play/pause;
  9:16 frame; one `.rp-fv-sound` unmute button (dark text on brand orange);
  `prefers-reduced-motion` branch with no autostart.
- [x] 3.2 `navigation.ts`: `closeVideo` label → `unmuteVideo`; `mediaLabels` updated.
- [x] 3.3 `content.config.ts` + both `home.*.json`: `videoBody`, `videoStoryAction` added;
  `videoLabel` reworded to a heading, `videoDuration` corrected to `1:35`.
- [x] 3.4 `index.astro`: split section, heading + `videoBody` + link to `/story` beside
  `<FounderVideo>`; `mediaLabels` passed through.
- [x] 3.5 `public/admin/config.yml`: the video fields updated for the CMS.

## 4. Two doors

- [x] 4.1 `navigation.ts`: `joinGame` label (he/en) + a tertiary header action to
  `PLAY_ORIGIN`.
- [x] 4.2 `content.config.ts` + both `home.*.json` + `config.yml`: `heroJoinPrompt`,
  `heroJoinAction`.
- [x] 4.3 `HeroField.astro`: optional `join` prop → a line under the CTAs with a
  direction-aware arrow (`border-inline-start-color`).
- [x] 4.4 `index.astro`: pass `join` to `<HeroField>` pointing at `https://rush-point.com/`.

## 5. Story and contact pages

- [x] 5.1 `story/index.astro`: `TopoBackdrop` behind the hero; sections → an `<ol>`
  timeline with numbered pins and a dashed repeating-gradient route connector; closing →
  a bordered pull-quote; CTA on `bg-surface-tint`.
- [x] 5.2 `contact/index.astro`: `TopoBackdrop` behind the hero.

## 6. Tests + gates

- [x] 6.1 `test-marketing-home-cro.ts`: video component path → `FounderVideo.astro`;
  section G rewritten to the inline contract; conversion-keys list gains
  `heroJoinPrompt`, `heroJoinAction`, `videoBody`, `videoStoryAction`.
- [x] 6.2 `npm run verify` — all gates green (exit 0, 12/12 turbo tasks, 256 unit files,
  three builds, marketing output 211 checks, i18n strict).
- [~] 6.3 Preview verification: story timeline (4 stops, route connector, no overflow),
  founder video inline with unmute button, header carries both doors, hero join line — all
  confirmed by measurement. Actual video autoplay NOT verifiable in the headless preview
  pane; confirmed on the deployed site instead.

## 7. Deferred (open questions in design.md)

- [ ] 7.1 Apex domain decision (`rush-point.com` → marketing) — needs the owner.
- [ ] 7.2 Blog cover images / real media on the non-homepage pages — content decision.
