# -*- coding: utf-8 -*-
"""hit_sheet.py <reel> [<reel> ...]: one sheet per reel with a frame of EVERY reaction hit, taken from the
BUILT video (never from _seg/, which keeps every old render beside the current one).

Why (2026-10-16): two of eleven freezes in v2 of the street reels were aimed at the wrong person, one at
the back of a head, one at the boy beside the persuader. The face detector picks the largest face near
hint_x; in a group shot that is often whoever stands in front. QA cannot know whose face matters, so a
person has to look, and this makes looking take ten seconds. Each tile is labelled with the cut index,
the source second and the face it aimed at, so a fix is one line: face=(x, y) in cuts.py.

Writes <reel>/build/<reel>_hits.jpg and prints its path. Run from anywhere."""
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

WORK = Path(__file__).resolve().parent.parent
TILE_W = 300


def frame(video: Path, t: float) -> Image.Image:
    out = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", str(video), "-frames:v", "1",
                          "-vf", f"scale={TILE_W}:-1", "-f", "image2pipe", "-vcodec", "png", "-"],
                         capture_output=True, check=True).stdout
    from io import BytesIO
    return Image.open(BytesIO(out)).convert("RGB")


def sheet(reel: str) -> Path | None:
    rd = WORK / reel
    M = json.loads((rd / "measured.json").read_text(encoding="utf-8"))
    video = rd / "build" / f"{reel}_A.mp4"
    segs = M["segs"]
    ends = [g["t"] for g in segs[1:]] + [M["take_end"]]
    hits = [(g, e) for g, e in zip(segs, ends) if g.get("hit")]
    if not hits:
        print(f"{reel}: no hits")
        return None
    # the face each hit aimed at, as cuts.py / the detector left it (street.assemble writes it back into the cut)
    faces = {}
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location(f"cuts_{reel}", rd / "cuts.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        faces = {k: c.get("face") for k, c in enumerate(mod.CUTS) if c.get("hit")}
    except Exception as e:  # a label is a convenience; the frames are the point
        print(f"{reel}: could not read cuts.py ({e}); tiles carry no face label")
    tiles = []
    for g, end in hits:
        t = g["t"] + min(0.45, (end - g["t"]) * 0.6)   # after the punch in and the flash have landed
        im = frame(video, t)
        d = ImageDraw.Draw(im)
        face = faces.get(g.get("cut"))
        label = f"cut {g.get('cut')} · src {g.get('a')}s" + (f" · face {tuple(round(v, 2) for v in face)}" if face else " · face: detector")
        d.rectangle((0, 0, im.width, 26), fill=(0, 0, 0))
        d.text((6, 6), label, fill=(255, 220, 0), font=ImageFont.load_default())
        tiles.append(im)
    w, h = tiles[0].size
    out = Image.new("RGB", (w * len(tiles), h), "black")
    for i, im in enumerate(tiles):
        out.paste(im, (i * w, 0))
    dst = rd / "build" / f"{reel}_hits.jpg"
    out.save(dst, quality=88)
    print(f"{reel}: {len(tiles)} hits -> {dst}")
    return dst


if __name__ == "__main__":
    for r in sys.argv[1:]:
        sheet(r)
