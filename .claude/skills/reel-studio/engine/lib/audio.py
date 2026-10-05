# -*- coding: utf-8 -*-
"""Voice preparation: gentle, measured, never a denoiser.

The phone recordings are already clean (noise floor about -63 dB). The first pass ran
afftdn plus a single pass loudnorm over the whole mix, and Ahiya heard it at once:
the voice came out watery and pumping. So: rumble high pass, light compression, then
a TWO pass loudnorm on the voice alone (measured first, applied linear), and the final
mix only limits.
"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

from .common import ffmpeg_bin

import os as _os
TARGET = {"I": float(_os.environ.get("RP_VOICE_LUFS", -16.0)), "TP": -1.5, "LRA": 7.0}
CHAIN = _os.environ.get("RP_VOICE_CHAIN", "highpass=f=75,acompressor=threshold=-26dB:ratio=2.5:attack=8:release=160:makeup=3")


def prep_voice(src: Path, dst: Path, keep: tuple[float, float] | None = None,
               noise: tuple[float, float] | None = None, segments: list | None = None,
               tempo: float = 1.0) -> Path:
    """noise = a stretch of the RAW file with room tone only (the silence before he
    speaks). afftdn LEARNS that exact profile and removes only it, gently (nr 10 dB),
    which is what the blind nf=-28 pass got wrong (it creaked). Then a de-esser and a
    soft 11 kHz roll off so the clean voice is not harsh."""
    den = ""
    if noise:
        den = (f"asendcmd=c='{noise[0]:.2f} afftdn@n sn start;{noise[1]:.2f} afftdn@n sn stop',"
               f"afftdn@n=nr=10:nf=-60:tn=0,deesser=i=0.35,lowpass=f=11000,")
    if segments:
        # tighten pauses: keep only these spans of the raw take, joined with 12 ms fades
        parts = "".join(
            f"[s{i}]atrim={a}:{b},asetpts=PTS-STARTPTS,afade=t=in:d=0.012,"
            f"afade=t=out:st={b - a - 0.012:.3f}:d=0.012[c{i}];" for i, (a, b) in enumerate(segments))
        split = f"asplit={len(segments)}" + "".join(f"[s{i}]" for i in range(len(segments))) + ";"
        joined = "".join(f"[c{i}]" for i in range(len(segments))) + f"concat=n={len(segments)}:v=0:a=1,"
        trim = den + split + parts + joined
        keep = None
    else:
        trim = den + (f"atrim={keep[0]}:{keep[1]},asetpts=PTS-STARTPTS," if keep else "")
    if tempo != 1.0:
        # faster delivery, same pitch (atempo is a time stretch, not a resample)
        trim += f"atempo={tempo:.3f},"
    fade = ""
    if keep:
        d = keep[1] - keep[0]
        fade = f",afade=t=in:d=0.015,afade=t=out:st={max(d - 0.06, 0):.3f}:d=0.06"
    base = f"{trim}{CHAIN}{fade}"
    ff = ffmpeg_bin()
    # always a full filtergraph: the pause tightening splits the stream, which -af cannot
    p1 = subprocess.run([ff, "-hide_banner", "-i", str(src), "-filter_complex",
                         f"[0:a]{base},loudnorm=I={TARGET['I']}:TP={TARGET['TP']}:LRA={TARGET['LRA']}:print_format=json[o]",
                         "-map", "[o]", "-f", "null", "-"], capture_output=True, text=True, encoding="utf-8", errors="replace")
    m = json.loads(re.findall(r"\{[^{}]*\"input_i\"[^{}]*\}", p1.stderr)[-1])
    ln = (f"loudnorm=I={TARGET['I']}:TP={TARGET['TP']}:LRA={TARGET['LRA']}:measured_I={m['input_i']}:"
          f"measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:"
          f"offset={m['target_offset']}:linear=true")
    subprocess.run([ff, "-v", "error", "-y", "-i", str(src), "-filter_complex", f"[0:a]{base},{ln},aresample=48000[o]",
                    "-map", "[o]", "-ac", "1", str(dst)], check=True)
    return dst
