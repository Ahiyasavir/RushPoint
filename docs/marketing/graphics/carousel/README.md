# Carousel — "5 כלים שעזרו לי ויעזרו לכם" (8 slides)

```bash
PYTHONUTF8=1 python docs/marketing/carousel/build_carousel.py
```

Outputs `slide-1.png` … `slide-8.png` at **1080×1350** (Instagram carousel 4:5), rendered at 2×
and downsized with LANCZOS, plus `_contact-sheet.png` for QA. Rebuild it after any change.

## Three ideas hold it together

**1. Narrative.** The five tools are ordered as the journey they were used in — research, code,
branding, decks, video — because the promise is "from zero to marketing" and a stranger can only
follow that if the slides walk it in order. This deliberately gave up the earlier twist (the
quiet research tool was secretly first); it is openly first now. Comprehension beat the twist,
because a twist nobody follows is not a twist.

**2. Structure, adapted from @pubity.** Looked at the account rather than guessing: a full-bleed
visual on top, a solid bar under it carrying heavy type set **edge to edge**, a channel mark on
the seam, a SWIPE badge in the corner. The critical detail is that type is never "placed at a
size" — every line is fitted to the column width **and** the height it is allowed
(`fit_block`). Width-only fitting overflowed the bar, because two full-width lines of a heavy
face are taller than the bar and nothing in a width-only fit can know that.

**3. Continuity.** Slides 1–7 are crops of ONE 8640×1350 survey sheet: contours and the ORANGE
route are plotted in global coordinates and drawn with an x-offset, so the route crosses every
seam unbroken. One device doing three jobs — Contour Kinetics' central gesture
(`../poster/contour-kinetics.md`), the bleed-across-the-seam retention technique, and a
re-enactment of the product's own loop, since the tools are **stations** on the route. Slide 8
switches the route off: it is the destination, and the alternative (a photo tall enough to cover
it) shrank the slogan that slide exists to deliver.

## Slide map

| # | Slide | Job |
|---|---|---|
| 1 | Hook | Underdog opener, then the promise: 5 tools, anything, from zero |
| 2 | What this even is | The product in one sentence, plus five unknowns as a 3+2 block |
| 3 | Perplexity | Research, before there was a project |
| 4 | Claude | Wrote all the code |
| 5 | Gemini | Logo, icons, banners |
| 6 | Gamma | Decks. Carries the soft "save this" |
| 7 | Luma AI | Video. Pattern break: the sheet inverts to ink |
| 8 | Close | "I don't know how this ends", the **אתם כאן** map marker, then the proof photo |

### The close, and the research that did not apply

Published research puts *content predictability* at the top of the follow-driver list — people
follow accounts that reliably deliver a known thing. That is right for a tips account and wrong
for this one. The founder's own read: people follow to watch the journey and find out whether
the app works. Narrative investment, not content utility. So the close promises no cadence and
no "more posts like this".

The original close ("in a year people will ask how this was built, you'll already know") had the
right instinct — early knowledge as social currency — but **assumed the outcome**. A settled
ending is not a story anyone needs to watch, so the line quietly destroyed the tension it
existed to create. The current copy keeps the social currency and reopens the outcome.

The visual is the payoff of the route device: the line arrives at a marker reading **אתם כאן**
and carries on off the frame, dashes lengthening and fading, no destination drawn. It is a map
convention every reader decodes instantly, it is the brand's own language (Contour Kinetics: the
contours "run off as though the land continues"), and it makes "the journey is still going and
you are joining now" visible instead of claimed.

Every station slide ends on one blunt teaser: a label plus one surprising fact
("הבא: לא כותב שורת קוד."). Earlier versions were riddles set small in a corner, and a riddle
nobody reads is not an open loop, it is noise.

**No hyphens or dashes anywhere in the copy**, by instruction — the copy is written around them
("מאפס", not "מ-0"; separate sentences instead of an em-dash clause).

## Two badge layouts, on purpose

Slide 2 shows the five unknowns as the **subject**: 3 over 2, large. The station slides show
them as a **progress rail**: one row, small. They were briefly the same component, and two rows
of badges plus a 350px mark does not fit the top zone — the rail landed on top of the tool's own
name.

Glyphs inside the badges are centred with `draw_glyph_centred`, which uses the glyph's own
`getbbox` ink bounds. Centring by `textlength` plus a hand-tuned fraction of line height is a
guess that ignores side bearings, and it visibly sat the question marks low in their circles.

## Tooling built for this

- `svgpath.py` — a minimal SVG `<path>` rasteriser (M/L/H/V/C/S/Q/T/A/Z, even-odd fill) plus
  `render_multi` for multi-path marks. Written because this machine has no cairo DLL, so
  cairosvg and reportlab's `renderPM` both fail at import.
- `assets/*.svg` — official marks. Claude, Gemini and Perplexity come from simple-icons; **Gamma
  and Luma are not in simple-icons** and were taken from the products' own sites. Neither is a
  single-path icon: Gamma wraps its glyph in a gradient disc (path 0 is skipped, or it renders as
  a filled circle) and Luma is six translucent facets, flattened to a solid silhouette so all
  five marks read as one family.
- `assets/*.ttf` — Hebrew display faces evaluated for the caption bar. **Rubik Black won** —
  heaviest of the candidates and already the brand's video face.

## Known gap

The closing photo is `../poster/src_2.jpg`, an illustrative frame from the מירוץ למיליון
campaign, not documentation of a real run. It reads correctly (a group walking a trail, which is
exactly what המשחק יוצא החוצה means) but the slide's job is *proof*. Swap the path in `slide8()`
when a real run photo exists.
