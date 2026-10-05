# -*- coding: utf-8 -*-
"""Caption engine check: does libass draw the Hebrew line in the right order?

    python test_captions.py            → writes build/_caption_test.png and asserts

Ground truth is a Pillow + python-bidi render of the same sentence (the toolkit's known
good path). Both are reduced to the left→right sequence of ink columns per word and
compared, and the active word must be the amber one. A side by side image is written
so a human can look at it too.
"""
from __future__ import annotations

import shutil
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).parent))
from lib.captions import build_ass, visual_order  # noqa: E402
from lib.common import CFG, FONTS_DIR, ROOT, ffmpeg_bin, font_file, run  # noqa: E402

SENTENCE = "ההוצאה הבאה: 1,250 ₪"
WORDS = SENTENCE.split()


def word_spans(img: Image.Image, y0: int, y1: int, gap: int = 18) -> list[tuple[int, int]]:
    a = np.asarray(img.convert("RGB")).astype(int)[y0:y1]
    ink = (np.abs(a - a[0, 0]).sum(axis=2) > 120).any(axis=0)
    spans, start, last = [], None, -999
    for x, on in enumerate(ink):
        if on:
            if start is None or x - last > gap:
                if start is not None:
                    spans.append((start, last))
                start = x
            last = x
    if start is not None:
        spans.append((start, last))
    return spans


TEST_SIZE = 96


def main() -> int:
    tmp = Path(tempfile.mkdtemp())
    shutil.copytree(FONTS_DIR, tmp / "fonts")
    # active word = logical index 1 ("הבאה:") for the whole second
    entry = {"start": 0, "end": 1, "style": "big", "size": TEST_SIZE, "words": [[w, 0.0, 0.0] for w in WORDS]}
    entry["words"][1] = [WORDS[1], 0.0, 1.0]
    entry["words"][2] = [WORDS[2], 1.0, 1.0]
    entry["words"][3] = [WORDS[3], 1.0, 1.0]
    build_ass([entry], tmp / "t.ass")
    run([ffmpeg_bin(), "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x1C1917:s=1080x1920:d=1:r=30",
         "-vf", "ass=t.ass:fontsdir=fonts", "-ss", "0.5", "-frames:v", "1", "ass.png"], cwd=tmp)
    got = Image.open(tmp / "ass.png")

    y = CFG["captions"]["big_center_y"]
    size = TEST_SIZE   # one line: this test is about word ORDER, wrapping has its own check
    ref = Image.new("RGB", (1080, 1920), "#1C1917")
    d = ImageDraw.Draw(ref)
    # BASIC layout + get_display: python-bidi orders, Pillow draws as given. (With raqm,
    # Pillow would run bidi itself and the pre-ordered string would be reversed twice.)
    # ASS font size is not a pixel em, so compare word width RATIOS, not pixels.
    # The caption font is the configured Hebrew fallback (the brand fonts have no Hebrew),
    # a SYSTEM font: Arial Bold on Windows. Otherwise the bundled display font.
    cap = CFG["captions"].get("font")
    sysfont = {"Arial": ["C:/Windows/Fonts/arialbd.ttf", "/usr/share/fonts/truetype/msttcorefonts/Arial_Bold.ttf",
                         "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"]}.get(cap or "", [])
    ref_font = next((p for p in sysfont if Path(p).exists()), None) or         str(font_file(CFG["fonts"]["display"], CFG["fonts"]["display_weight"]))
    from lib.captions import EM_RATIO
    f = ImageFont.truetype(ref_font, int(size * EM_RATIO), layout_engine=ImageFont.Layout.BASIC)
    from bidi.algorithm import get_display
    d.text((540, y), get_display(SENTENCE, base_dir="R"), font=f, fill="white", anchor="mm",
           stroke_width=8, stroke_fill="#000000")

    band = (y - size, y + size)
    # word gap ≈ 35px at this size, the gap inside 'הבאה:' (Arial's colon) ≈ 20px
    gap = max(18, int(size * 0.27))
    gs, rs = word_spans(got, *band, gap=gap), word_spans(ref, *band, gap=gap)
    out = ROOT / "build"
    out.mkdir(exist_ok=True)
    pair = Image.new("RGB", (1080, 2 * (band[1] - band[0])))
    pair.paste(got.crop((0, band[0], 1080, band[1])), (0, 0))
    pair.paste(ref.crop((0, band[0], 1080, band[1])), (0, band[1] - band[0]))
    pair.save(out / "_caption_test.png")

    ok = True
    if len(gs) != len(WORDS) or len(rs) != len(WORDS):
        print(f"FAIL word count: libass {len(gs)}, reference {len(rs)}, expected {len(WORDS)}")
        ok = False
    else:
        widths_g = [(b - a) / sum(b - a for a, b in gs) for a, b in gs]
        widths_r = [(b - a) / sum(b - a for a, b in rs) for a, b in rs]
        if any(abs(g - r) > 0.04 for g, r in zip(widths_g, widths_r)):
            print(f"FAIL word order differs: libass {[round(x, 3) for x in widths_g]} vs reference {[round(x, 3) for x in widths_r]}")
            ok = False
        # the amber word must sit where the logical word 1 sits visually
        vis = [i for i, _ in visual_order(WORDS)]
        a0, a1 = gs[vis.index(1)]
        px = np.asarray(got.convert("RGB"))[band[0]:band[1], a0:a1].reshape(-1, 3)
        amber = ((px[:, 0] > 220) & (px[:, 1] > 150) & (px[:, 1] < 200) & (px[:, 2] < 60)).sum()
        if amber < 200:
            print("FAIL active word is not amber")
            ok = False
    print(("PASS" if ok else "FAIL") + f": {SENTENCE!r} → {out / '_caption_test.png'}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
