# -*- coding: utf-8 -*-
"""A copy of a finished reel that fits through to his phone.

    python phone_copy.py <master.mp4> <out.mp4> [--mb 26]

SendUserFile reaches the phone (Remote Control) only under 30 MiB, and a master is ~80 MB
(reel 17, 2026-10-13: "שלח לי את זה לפלאפון" and the master bounced). The video bitrate is
computed from the duration so the file lands at about --mb, two pass free (one encode at
preset slow); the audio is copied as it is, since the build already mastered it.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--mb", type=float, default=26.0)
    a = ap.parse_args()
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", a.src],
                               capture_output=True, text=True).stdout)
    abps = 192_000
    vbps = int(max((a.mb * 8 * 1024 * 1024 / dur) - abps, 1_500_000) * 0.96)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", a.src, "-c:v", "libx264", "-preset", "slow", "-b:v", str(vbps),
                    "-maxrate", str(int(vbps * 1.25)), "-bufsize", str(vbps * 2), "-pix_fmt", "yuv420p",
                    "-color_range", "tv", "-colorspace", "bt709", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", a.dst],
                   check=True)
    size = Path(a.dst).stat().st_size / 1024 / 1024
    print(f"{a.dst}: {size:.1f} MiB, {vbps // 1000} kb/s video, {dur:.1f} s")
    if size >= 29.5:
        sys.exit("still over the 30 MiB phone limit: run again with a smaller --mb")


if __name__ == "__main__":
    main()
