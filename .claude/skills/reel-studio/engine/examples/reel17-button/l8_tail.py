# -*- coding: utf-8 -*-
"""Line 8 ends on "בחינם": give the picture half a second more of him after the word, so the stamp
has time to land. Re-cuts clips/l8.mp4 with a longer tail (the voice file is unchanged)."""
import json
import subprocess
import sys
from pathlib import Path

RD = Path(__file__).resolve().parent
sys.path.insert(0, "C:/Users/savir/Projects/Rushpoint/.claude/skills/reel-studio/engine")
from lib import whitebg  # noqa: E402
from lib.portrait import GRADE  # noqa: E402

TAIL = 0.62          # raw seconds of him after the last word
take, a, b = json.loads((RD / "plan.json").read_text(encoding="utf-8"))["l8"][0]
src = RD / "src" / f"20261013_{take}.mp4"
tmp = RD / "clips" / "_l8_w.mp4"
whitebg.clean_room_rvm(src, tmp, proof=RD / "proofs" / "clean_l8.jpg", a=a, b=b + TAIL, retouch=True)
out = RD / "clips" / "l8.mp4"
subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(tmp), "-i", str(RD / "voice" / "l8.wav"),
                "-filter_complex", f"[0:v]setpts=(PTS-STARTPTS)/1.12,fps=30,{GRADE}[v];[1:a]apad[a]", "-map", "[v]", "-map", "[a]",
                "-c:v", "libx264", "-crf", "14", "-preset", "fast", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-shortest", str(out)], check=True)
tmp.unlink()
print("l8 with tail", subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(out)],
                                     capture_output=True, text=True).stdout.strip())
