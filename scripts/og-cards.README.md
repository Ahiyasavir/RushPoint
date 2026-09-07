# Open Graph share images (`apps/*/public/og.jpg`)

`og.jpg` is the 1200×630 branded card that WhatsApp / Telegram / Twitter / Facebook
show when someone shares a RushPoint link. It is referenced from each app's
`index.html` (`og:image` / `twitter:image`) as an **absolute** URL — scrapers
require absolute image URLs. `apps/marketing` has no `public/og.jpg` of its own;
it falls back to `apps/marketing/src/assets/images/og.jpg` (Astro's asset
pipeline, wired in `src/config.yaml`'s `METADATA.openGraph.images`) — that file
is a copy of play-web's card, not a separate design.

There is no server-side renderer and no raster image lib in the toolchain, so the
cards are drawn **client-side on a `<canvas>`** (same technique as
`apps/play-web/src/lib/storyCard.ts`) and exported to a static JPEG.

## Regenerating

**`scripts/og-cards.html` is the generator, committed rather than pasted into a
console.** The previous version of this doc described a "paste into the browser
console" ritual with no file behind it — and the cards it was supposed to produce
rotted through two full rebrands (an original "race adventure" era, then a
"field game" era) because there was nothing to re-run, only a memory of a
one-off console session. A file in the repo can be opened, read, and re-run.

Open it directly in a browser (a local `file://` open works — no dev server or
build needed) and click "Download" under each canvas. Then:

```bash
cp ~/Downloads/og.jpg apps/play-web/public/og.jpg
cp ~/Downloads/og.jpg apps/marketing/src/assets/images/og.jpg   # same card, same file
# re-download the creator canvas, then:
cp ~/Downloads/og.jpg apps/creator-web/public/og.jpg
```

Keep the size at 1200×630 and update the `og:image:width/height` tags in the
relevant `index.html` if that ever changes.

## Current design (edit `scripts/og-cards.html` to change either)

- **play card** (used by play-web AND marketing) — warm orange gradient
  (`#FCA855` → `#F97316` → `#DC4F08`), 🧭, headline "המירוץ החי שהקבוצה שלכם
  תזכור" — the same headline as the marketing homepage hero, so a shared link
  and the page it opens say the same thing.
- **creator card** — dark (`#050508`) + an orange glow in the corner, matching
  creator-web's own dark UI theme, 🧭, headline "בונים מירוץ חי משלכם" — the
  same wording as `apps/creator-web/index.html`'s own `<title>`.

Both are Hebrew, right-aligned: the product is Hebrew-first, and the previous
cards were English-only on a Hebrew-first site, in a genre store nobody else
was checking (search-result and app-shell copy have their own gates; a share
card's copy has none, so nothing caught it drifting).
