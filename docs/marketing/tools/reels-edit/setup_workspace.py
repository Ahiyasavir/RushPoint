# -*- coding: utf-8 -*-
"""Create the working tree and the default sound effects. Safe to run again.

    python setup_workspace.py

  <work>/{reel2-stairs,reel3-ai,grandma,reel1-riddles}/{clips,voice,proofs,graphics,build,sfx}
  <work>/<reel>/timeline.json      copied from reels/<reel>/ only if absent (never overwritten)
  <work>/<reel>/sfx/*.wav          synthesised effects, only if absent
  <out>/                           final deliverables

<work> is C:\\Users\\ahiya\\Desktop\\RushPoint-reels-work on Windows, ./_work elsewhere,
or $RP_REELS_WORK. The effects are generated with ffmpeg's own signal sources, so they
carry no licence question; drop a better landing.wav in a reel's sfx/ and it wins.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from lib.common import OUT_ROOT, REELS, SUBDIRS, TEMPLATES_DIR, WORK_ROOT, ffmpeg_bin, run  # noqa: E402

# name → (lavfi source, filter, seconds). Mono 48k, rendered once per reel.
SFX = {
    # a body landing on stone: a 55 Hz thump with a fast decay plus a short noise slap
    "land": ("sine=f=55:d=0.35", "volume=2.2,afade=t=out:st=0.02:d=0.32", 0.35, "anoisesrc=d=0.08:c=brown:a=0.6"),
    # the receipt 'ding': two partials, bell like decay
    "ding": ("sine=f=1760:d=0.5", "afade=t=out:st=0.01:d=0.48,volume=0.6", 0.5, "sine=f=2637:d=0.5"),
    # a cut: band passed noise swelling and falling
    "whoosh": ("anoisesrc=d=0.4:c=pink:a=0.7", "bandpass=f=1400:w=1800,afade=t=in:d=0.18,afade=t=out:st=0.2:d=0.2", 0.4, None),
    "pop": ("sine=f=600:d=0.09", "afade=t=out:st=0:d=0.09,volume=0.8", 0.09, None),
    "hit": ("sine=f=48:d=0.6", "volume=2.5,afade=t=out:st=0.03:d=0.55", 0.6, "anoisesrc=d=0.12:c=white:a=0.4"),
    "riser": ("anoisesrc=d=2.4:c=pink:a=0.5", "highpass=f=600,afade=t=in:d=2.3,afade=t=out:st=2.3:d=0.1", 2.4, None),
    "tick": ("sine=f=2200:d=0.03", "afade=t=out:st=0:d=0.03,volume=0.5", 0.03, None),
}


def make_sfx(folder: Path) -> list[str]:
    ff, made = ffmpeg_bin(), []
    for name, (src, flt, dur, layer) in SFX.items():
        out = folder / f"{name}.wav"
        if out.exists():
            continue
        if layer:
            fc = f"[0:a]{flt}[a];[1:a]afade=t=out:st=0:d={dur}[b];[a][b]amix=inputs=2:normalize=0,atrim=0:{dur}"
            cmd = [ff, "-y", "-v", "error", "-f", "lavfi", "-i", src, "-f", "lavfi", "-i", layer,
                   "-filter_complex", fc, "-ar", "48000", "-ac", "1", out]
        else:
            cmd = [ff, "-y", "-v", "error", "-f", "lavfi", "-i", src, "-af", flt, "-ar", "48000", "-ac", "1", out]
        run(cmd)
        made.append(name)
    return made


def main():
    WORK_ROOT.mkdir(parents=True, exist_ok=True)
    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    for reel in REELS:
        rd = WORK_ROOT / reel
        for sub in SUBDIRS:
            (rd / sub).mkdir(parents=True, exist_ok=True)
        tl = rd / "timeline.json"
        if not tl.exists():
            shutil.copy(TEMPLATES_DIR / reel / "timeline.json", tl)
            print(f"  + {tl}")
        made = make_sfx(rd / "sfx")
        if made:
            print(f"  + {reel}/sfx: {', '.join(made)}")
    print(f"work: {WORK_ROOT}\nout:  {OUT_ROOT}")


if __name__ == "__main__":
    main()
