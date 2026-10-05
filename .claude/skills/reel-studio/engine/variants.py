# -*- coding: utf-8 -*-
"""Render every opening (A, B, C) of a reel, its covers, QA each, and deliver.

    python variants.py reel2-stairs              # preview quality, no delivery
    python variants.py reel2-stairs --final      # master quality; copies to the out folder
                                                 # ONLY the variants whose QA passed --final
    python variants.py all                       # every reel

Per variant:  build/<reel>_<X>.mp4 · build/<reel>_<X>_cover.png · build/<reel>_<X>.qa.json
Delivered:    <out>/<reel>/<reel>_<X>.mp4 (crf from config, ~0.7 MB/s) + _cover.png
Nothing is sent or uploaded anywhere.
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import build as builder  # noqa: E402
import qa  # noqa: E402
from lib import graphics  # noqa: E402
from lib.common import CFG, OUT_ROOT, REELS, ffmpeg_bin, load_timeline, reel_dir, run  # noqa: E402


def cover_for(reel: str, op: str, video: Path) -> Path:
    tl = load_timeline(reel)
    rdir = reel_dir(reel)
    at = float(tl.get("cover", {}).get("frame_at", 1.0))
    frame = rdir / "build" / f"{reel}_{op}_coverframe.png"
    run([ffmpeg_bin(), "-v", "error", "-y", "-ss", f"{at:.2f}", "-i", str(video), "-frames:v", "1", str(frame)])
    return graphics.cover(rdir, tl, op, frame, rdir / "build" / f"{reel}_{op}_cover.png")


def deliver(reel: str, op: str, video: Path, cover: Path) -> Path:
    dst = OUT_ROOT / reel
    dst.mkdir(parents=True, exist_ok=True)
    out = dst / video.name
    run([ffmpeg_bin(), "-v", "error", "-y", "-i", str(video), "-c:v", "libx264", "-preset", "medium",
         "-crf", str(CFG["video"]["crf_delivery"]), "-profile:v", "high", "-level", "4.1",
         "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", str(out)])
    shutil.copy(cover, dst / cover.name)
    return out


def run_reel(reel: str, final: bool) -> list[tuple[str, str]]:
    tl = load_timeline(reel)
    ops = sorted(tl.get("openings", {})) or [tl.get("default_opening", "A")]
    results = []
    for op in ops:
        print(f"\n▶ {reel} · opening {op}")
        video = builder.build(reel, op, final, quiet=True)
        cov = cover_for(reel, op, video)
        code = qa.check(reel, op, final)
        status = "PASS" if code == 0 else "FAIL"
        if final and code == 0:
            print(f"  delivered → {deliver(reel, op, video, cov)}")
        results.append((f"{reel}_{op}", status))
    return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("reel", help="a reel id or 'all'")
    ap.add_argument("--final", action="store_true")
    a = ap.parse_args()
    reels = REELS if a.reel == "all" else [a.reel]
    res = [r for reel in reels for r in run_reel(reel, a.final)]
    print("\n── summary")
    for name, st in res:
        print(f"  {st}  {name}")
    raise SystemExit(0 if all(st == "PASS" for _, st in res) else 1)


if __name__ == "__main__":
    main()
