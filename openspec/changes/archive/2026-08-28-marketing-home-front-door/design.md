## Context

Follow-up to `marketing-home-cro-redesign` (archived, deployed). The homepage shipped and
the owner gave five pieces of feedback, listed in the proposal. All fixes stay in
`apps/marketing`. The archived `marketing-home-experience` spec has two requirements this
round contradicts, so this is a proper MODIFIED-requirements change rather than a set of
loose edits.

## Decisions

### D1 — The cipher mission carries its own key

The old puzzle (`17 · 20 · 15` → פרס) was technically correct and practically a trap: the
visitor has to count the alphabet, an off-by-one gives a plausible wrong word, and the
demo's whole job is to feel effortless. The fix is not a better hint, it is removing the
counting: the prompt now lists `א=1 … ז=7` and the answer uses only those letters
(`7 · 5 · 2` → זהב). English gets the same treatment (`1 · 3 · 5` → ace); its old numbers
had never been localised and decoded to nonsense. The two languages decode to different
words on purpose, as the demo's missions already differ between languages.

### D2 — Inline autoplay, not a modal

The reported problems were all properties of the lightbox: a poster to press, a modal
sliding from an edge, a dismiss control off screen. A founder talking to camera does not
need any of that. `FounderVideo.astro`:

- `muted playsinline preload="metadata" controls`, no `autoplay` attribute.
- An `IntersectionObserver` at threshold 0.5 calls `play()` on enter and `pause()` on
  exit. This is strictly better than `autoplay`: the file is 95 seconds, and a video that
  is scrolled past should not keep decoding into an empty viewport.
- Shown at the file's real 9:16 (720x1280) in a frame whose `aspect-ratio` matches, so
  `object-fit` has nothing to crop. The old frame was `16/9` with `object-fit: cover`,
  which is exactly what produced the "top of a head" poster.
- One `.rp-fv-sound` button, dark text on the brand orange (white on it is 3.16:1 and this
  label is small; near-black is ~6:1). It sets `video.muted = false` and retires itself,
  and also retires if the viewer unmutes through the native control.
- `prefers-reduced-motion: reduce`: no observer, the button becomes a play control.

The `VideoLightbox.astro` file and its `showModal` / focus-trap / `<dialog>` machinery are
deleted. `test-marketing-home-cro.ts` section G is rewritten from the modal contract to
the inline one.

### D3 — Two doors

`navigation.ts` `headerData` gains a `joinGame` action (tertiary variant) pointing at
`PLAY_ORIGIN` beside `startBuilding`. `HeroField.astro` gains an optional `join` prop
rendering a "here to join a game?" line with a direction-aware arrow (a border triangle on
`border-inline-start-color`, correct in both LTR and RTL from one rule). Both are content
strings (`heroJoinPrompt` / `heroJoinAction` in the JSON; `joinGame` in the nav label
registry, which is where control labels live).

### D4 — The story page is a route, not a wall of text

The story is four chronological sections. They become an `<ol>` timeline: a numbered pin
per stop, a dashed repeating-gradient connector (not a dashed border, which cannot fix its
dash length and would never match the map's line), a `TopoBackdrop` behind the hero, and
the closing line as a bordered pull-quote. No component extracted; it is ~40 lines of
scoped CSS on the page. The contact page gets the same `TopoBackdrop`.

## Test Strategy

UI + content only. Proven by `npm run verify`, which for this change exercises:

- `marketing:build` — the four new content keys are required in the schema, so a key
  missing from one language fails here.
- `test-marketing-home-cro.ts` — updated: the video component path is now `FounderVideo.astro`,
  section G asserts the inline contract (real `<video>`, `muted`, IntersectionObserver, no
  `autoplay` attribute, an unmute path, a reduced-motion branch, no `<dialog>`), and the
  conversion-keys list gains the four new keys plus checks they exist in both languages.
- `test-marketing-content.ts` — the new Hebrew strings are Hebrew, the English ones
  English; the story timeline copy is unchanged so it still passes.
- `test-no-dashes.ts` — new copy is dash-free.
- `check-marketing-output.ts` — the story and contact pages still render static, still one
  h1, still language-correct after the restructure.
- Preview: story timeline renders four stops with the route connector and no overflow;
  the founder video is a plain inline `<video>` with the unmute button; the header carries
  both doors. Actual autoplay cannot be verified in the headless preview pane (it does not
  composite video); the code path is asserted structurally and confirmed on the deployed
  site.

## Risks / Trade-offs

- **[Muted-autoplay talking head]** → it does not loop, and the IntersectionObserver
  pauses it off screen, so it is not a perpetual silent mouth. Under reduced motion it
  does not start at all.
- **[Headless preview cannot play video]** → same limitation hit last round; verified by
  code path plus the deployed site.
- **[Two languages decode the cipher to different words]** → acceptable and already the
  norm for this demo's missions; each content file is independent.

## Open Questions

- **The apex.** `rush-point.com` currently serves the participant app; the marketing site
  is on `www`. Making the marketing site the apex front door is a DNS + hosting +
  `LANDING_ORIGIN` + deep-link + printed-QR change with live-event impact. Not done here.
  Needs the owner's decision on where the participant app then lives (`play.` / `app.`).
- **Blog and richer media.** The blog still has no cover images and the other pages are
  now structured but still text-first. Real photography or commissioned illustration is
  the actual fix and is a content decision, not a code one.
