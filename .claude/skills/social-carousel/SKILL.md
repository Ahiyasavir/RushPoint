---
name: social-carousel
description: Build Instagram carousel / social post images for RushPoint (Hebrew RTL, brand palette, Pubity structure). Use when asked for a carousel, social slides, Instagram post images, or any branded static for the feed. Encodes the pipeline and every hard-won rule from the first carousel build (2026-09-15).
---

# Social carousel — pipeline and rules

The first carousel took ~30 review rounds. Almost every round was one of five
failure types, and each now has a tool or a rule. Follow this in order.

## 0. Before designing "in the style of X": LOOK at X

Open the reference account in the Browser pane and screenshot 4–6 real posts
before writing a line of layout code. The first Pubity attempt assumed "centred
type on a plain background"; the real formula (full-bleed visual on top, solid
bottom bar with heavy type edge to edge, small channel mark on the seam, SWIPE
badge in the corner) was only learned by looking, and it cost a full rewrite.

## 1. Before writing the closing CTA: state WHY people follow this account

One sentence, confirmed with the founder. Generic research says "content
predictability"; for this account the real motive is **watching whether the app
succeeds** (narrative investment). A close that assumes success kills the
tension. Read `memory/carousel-post-playbook.md` first.

## 2. Copy rules (non-negotiable)

- **No hyphens or dashes anywhere.** Write around them: "לארבע", "מאפס", separate sentences.
- Blunt over clever. Teasers = label + one surprising fact, big enough to read.
- Type FILLS the frame: fit every block to width AND height (`fit_block`), never a hand-picked size. Centre it.
- One tool, one job. Overlapping roles muddy the "each has a role" premise.
- Uncertainty goes on the outcome or the person, never on the product.
- Ask for help ("תעזרו לי") is weak in a headline; "בואו נ…" puts the reader inside.

## 3. Build with the reference implementation

`docs/marketing/graphics/carousel/build_carousel.py` is the working pipeline (PIL + python-bidi,
2× supersampling, one global sheet cropped per slide so the route crosses seams).
Copy it as the starting point. Helpers in `scripts/`:

| script | job | replaces |
|---|---|---|
| `layout_guard.py` | registers every drawn bbox, **fails the build on any overlap** | eyeballing PNGs; this caught a route-through-headline the eye missed |
| `fetch_logo.py` | simple-icons → site scan fallback (finds SVGs in JSON blobs too) | hand-scraping Gamma and Luma |
| `fetch_font.py` | any Google Font by family name from the google/fonts repo | guessing raw GitHub paths |
| `svgpath.py` | SVG path → recolourable alpha mask (M/L/H/V/C/S/Q/T/A/Z, even-odd, multi-path) | cairo, which this machine does not have |

For a **faithful, full-colour** SVG (gradients, opacity), `skia-python` is installed
and `skia.SVGDOM` renders it. For a **monochrome recolourable** mark, `svgpath` is
the right tool. Pillow has NO raqm/fribidi: Hebrew is reordered by `python-bidi`
(`get_display(s, base_dir="R")`) on every string; fine for Hebrew, watch mixed
Latin/digit runs.

## 4. Gate before showing anything

1. `python build_carousel.py` must print `no collisions` for every slide. If the guard fails, fix the layout — do not allow-list the pair unless one element is opaque and drawn on top.
2. Open the contact sheet **and** every slide individually at full size. The 1/5 contact sheet hides label-level defects.
3. Centre glyphs with `getbbox` (`draw_glyph_centred`), never a line-height fraction.
4. Check the last slide's route/badge/photo separately — it has different geometry.

## 5. Caption

Hook in the first 125 chars, no emoji on line 1. Keywords in the caption body
(search reads the body, not hashtags). 3–5 niche hashtags; Mosseri: hashtags do
not boost reach. End on a real question, never "comment YES".
