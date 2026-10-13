# -*- coding: utf-8 -*-
"""Reel 14 takes → clips/<id>.mp4 (talking) + voice/<id>.wav (every line), 1.12x, cleaned voice.

    python assemble.py            (from anywhere; writes measured.json + said.json)

TAKES maps each script line to the take that says it (Ahiya's 11 takes of 2026-10-05, ingested
to ingest/ingest.json). Start = the first VOICE-band onset (cuts the breath, founder rule 34),
end = the last word + air, clamped before the next onset. Captions = what he SAID (rule 21).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

RD = Path(__file__).resolve().parent
sys.path.insert(0, r"C:\Users\savir\Projects\Rushpoint\.claude\skills\reel-studio\engine")
os.environ.setdefault("RP_VOICE_LUFS", "-19")
from lib.audio import prep_voice  # noqa: E402
sys.path.insert(0, str(RD.parent))
from _portrait import GRADE  # noqa: E402

TEMPO = 1.12
SRC = RD / "src"
ING = json.loads((RD / "ingest" / "ingest.json").read_text(encoding="utf-8"))
# line id → (take, keep_last_word?)  r2 is three takes, one per headline card
TAKES = {
    "r1": "20261005_164840.mp4",
    "r2a": "20261005_164907.mp4",
    "r2b": "20261005_164921.mp4",
    "r2c": "20261005_164938.mp4",
    "r3": "20261005_165118.mp4",
    "r4": "20261005_165140.mp4",
    "r5": "20261005_165243.mp4",     # the cleaner take (165201 repeats "מגרש משחקים" from r4)
    "r5b": "20261005_165322.mp4",
    "r6": "20261005_165431.mp4",
    "r7": "20261005_165449.mp4",
}
TALK = {"r1", "r3", "r4", "r5", "r7"}
# ends from the ingest speech regions (the last region of each take is him reaching for the phone)
OVR: dict[str, tuple[float | None, float | None]] = {
    "r1": (0.70, 3.60), "r2a": (None, 5.62), "r2b": (None, 2.66), "r2c": (None, 6.10), "r3": (None, 4.20),
    "r4": (None, 5.66), "r5": (None, 6.46), "r5b": (None, 7.66), "r6": (None, 8.00), "r7": (None, 3.30),
}


def envelope(name):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(SRC / name), "-vn", "-ac", "1", "-ar", "16000",
                          "-af", "highpass=f=150,lowpass=f=1500", "-f", "f32le", "-"], capture_output=True).stdout
    x = np.frombuffer(raw, np.float32)
    hop = 320
    return 20 * np.log10(np.array([np.sqrt(np.mean(x[i:i + hop] ** 2)) + 1e-9 for i in range(0, len(x) - hop, hop)]))


def first_onset(db):
    floor, peak = np.percentile(db, 10), np.percentile(db, 97)
    thr = max(floor + 20, peak - 26)
    for i in range(len(db) - 3):
        if db[i] > thr and db[i + 1] > thr and db[i + 2] > thr:
            return i * 0.02
    return 0.0


def last_offset(db):
    floor, peak = np.percentile(db, 10), np.percentile(db, 97)
    thr = max(floor + 14, peak - 32)
    for i in range(len(db) - 1, 2, -1):
        if db[i] > thr and db[i - 1] > thr:
            return i * 0.02 + 0.02
    return len(db) * 0.02


def plan(lid, name):
    info = ING[name]
    db = envelope(name)
    a = max(first_onset(db) - 0.06, 0)
    b = min(last_offset(db) + 0.22, info["duration"] - 0.02)
    o = OVR.get(lid, (None, None))
    a = o[0] if o[0] is not None else a
    b = o[1] if o[1] is not None else b
    sh = info.get("whisper_shift_s", 0)
    words = [[w, max(s - sh, a), e - sh] for w, s, e in info["words"]]
    return {"take": name, "a": round(a, 3), "b": round(b, 3), "said": info.get("text", ""), "words": words}


# lines said with a pause inside that must go (founder: "רגע אל תדלגו" straight and fast):
# the take is cut to these spans, picture and sound together, at a faster tempo
SPLIT = {"r1": ([(0.80, 1.20), (1.90, 3.52)], 1.22)}


def cut_split(lid, p):
    src = SRC / p["take"]
    spans, tempo = SPLIT[lid]
    wav = RD / "voice" / f"{lid}.wav"
    prep_voice(src, wav, segments=spans, noise=None, tempo=tempo)
    d = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(wav)],
                             capture_output=True, text=True).stdout)
    parts = "".join(f"[0:v]trim={a}:{b},setpts=PTS-STARTPTS[v{i}];" for i, (a, b) in enumerate(spans))
    fc = parts + "".join(f"[v{i}]" for i in range(len(spans))) + f"concat=n={len(spans)}:v=1:a=0,setpts=PTS/{tempo},fps=30,{GRADE}[v]"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-i", str(wav), "-filter_complex", fc, "-map", "[v]", "-map", "1:a",
                    "-t", f"{d:.3f}", "-c:v", "libx264", "-crf", "15", "-preset", "fast", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-b:a", "256k", "-ar", "48000", str(RD / "clips" / f"{lid}.mp4")], check=True)
    return lid, round(d, 3)


def cut(lid, p):
    if lid in SPLIT:
        return cut_split(lid, p)
    src = SRC / p["take"]
    wav = RD / "voice" / f"{lid}.wav"
    prep_voice(src, wav, keep=(p["a"], p["b"]), noise=None, tempo=TEMPO)
    if lid in TALK:
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{p['a']:.3f}", "-t", f"{p['b'] - p['a']:.3f}", "-i", str(src),
                        "-i", str(wav), "-filter_complex", f"[0:v]setpts=(PTS-STARTPTS)/{TEMPO},fps=30,{GRADE}[v]",
                        "-map", "[v]", "-map", "1:a", "-c:v", "libx264", "-crf", "15", "-preset", "fast", "-pix_fmt", "yuv420p",
                        "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-shortest", str(RD / "clips" / f"{lid}.mp4")], check=True)
        (RD / "clips" / f"{lid}.placeholder").unlink(missing_ok=True)
    d = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(wav)],
                             capture_output=True, text=True).stdout)
    return lid, round(d, 3)


if __name__ == "__main__":
    (RD / "voice").mkdir(exist_ok=True)
    P = {lid: plan(lid, n) for lid, n in TAKES.items()}
    for lid, p in P.items():
        print(f"{lid:4} {p['take']} {p['a']:.2f}-{p['b']:.2f}  {p['said']}")
    with ThreadPoolExecutor(6) as ex:
        res = dict(ex.map(lambda kv: cut(*kv), P.items()))
    (RD / "measured.json").write_text(json.dumps(res, indent=1), encoding="utf-8")
    (RD / "said.json").write_text(json.dumps(P, ensure_ascii=False, indent=1), encoding="utf-8")
    print("measured", round(sum(res.values()), 2), "s")
