# -*- coding: utf-8 -*-
"""Reel 16 "the button": takes of 2026-10-13 evening → one clip per line: cut on the voice band envelope, pure white
background (whitebg.whiten_rvm), 1.12x, voice through the timbre keeping chain. Writes measured.json.

    python assemble.py --plan          # print the cut list only
    python assemble.py                 # cut everything (voice first, then the slow matting)
    python assemble.py s16a s20        # only these lines
    python assemble.py --check         # transcribe every cut line back and compare with CAPTION

He improvised and repeated shots, so the cut list is explicit: CUTS names, per line, the take and
the first/last word of the GOOD attempt (times from ingest/phrases.json). The exact in and out
points are then found on the 150 Hz..1.5 kHz envelope (a breath is not a vowel).
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
ENG = r"C:\Users\savir\Projects\Rushpoint\.claude\skills\reel-studio\engine"
# 2026-10-13 bench (_audio-lab/bench13b.py): every heavier chain moved his 3..10 kHz by 4 to 11 dB
# ("does not sound like me"). This one stays within 1 dB of the raw take in every third octave.
os.environ.setdefault("RP_VOICE_CHAIN", "highpass=f=80:p=2,acompressor=threshold=-22dB:ratio=1.6:attack=20:release=200:knee=8:makeup=1.5,"
                      "highshelf=f=5500:g=-2,alimiter=limit=0.89:attack=2:release=40:level=disabled")
os.environ.setdefault("RP_VOICE_LUFS", "-17")
sys.path.insert(0, ENG)
from lib.audio import prep_voice  # noqa: E402

sys.path.insert(0, str(RD))
from lib import whitebg  # noqa: E402

TEMPO = 1.12
from lib.portrait import GRADE  # noqa: E402  (founder rule 46; white stays 255 through it)
OUTDOOR = set()          # hard sun: already contrasty and warm, so only a touch
GRADE_OUT = "eq=contrast=1.02:saturation=1.08,unsharp=5:5:0.4:3:3:0.0"
SRC = RD / "src"
F = "20261013_%s.mp4"
# line → [(take, first word: scan 'f'orward from t or 'b'ackward from inside the word at t, a point inside the last word)]
CUTS = {
    "v0": [("205823", ("b", 4.3), 4.9)],          # "טוב יאללה", voice only, said just before the press
    "l1": [("210733", ("f", 0.3), 8.3)],          # the later take of the line (he re-shot it with "אתם קולטים")
    "l2": [("210400", ("f", 0.4), 4.0)],
    "l3": [("210417", ("b", 2.6), 7.2)],
    "l4": [("210455", ("f", 0.25), 6.95)],          # "x 0.42" left 0.6 s of breath before מסמנים (words.py showed it)
    "l5": [("210455", ("b", 12.0), 16.0)],
    "l6": [("210455", ("b", 27.1), 33.0)],        # second attempt (the first stops after "סבתא שלי")
    "l7": [("210455", ("f", 47.6), 54.0)],        # he says "אבל כל אחד פה" twice (46.0 badly, 47.8 again): start on the second
    "l8": [("210455", ("b", 56.5), 58.7)],
    "l9": [("210613", ("b", 2.6), 3.6)],          # filmed last, with the phone: "נלחץ?"
}
VOICE_ONLY = {"v0", "l4"}                         # l4 is told over the app, he is not on screen
# a background per line (bg.py), so every line change is a visible change; l9 stays white, it loops into the hook
BG = {"l1": "fire", "l2": "dark", "l3": "amber", "l5": "plasma", "l6": "bone", "l7": "dark", "l8": "fire"}

_ENV = {}


def envelope(take):
    if take not in _ENV:
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(SRC / (F % take)), "-vn", "-ac", "1", "-ar", "16000",
                              "-af", "highpass=f=150,lowpass=f=1500", "-f", "f32le", "-"], capture_output=True).stdout
        x = np.frombuffer(raw, np.float32)
        hop = 160                                                       # 10 ms
        db = 20 * np.log10(np.array([np.sqrt(np.mean(x[i:i + hop] ** 2)) + 1e-9 for i in range(0, len(x) - hop, hop)]))
        floor, peak = np.percentile(db, 10), np.percentile(db, 97)
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(SRC / (F % take)), "-vn", "-ac", "1", "-ar", "16000",
                              "-af", "highpass=f=150", "-f", "f32le", "-"], capture_output=True).stdout
        y = np.frombuffer(raw, np.float32)
        full = 20 * np.log10(np.array([np.sqrt(np.mean(y[i:i + hop] ** 2)) + 1e-9 for i in range(0, len(y) - hop, hop)]))
        _ENV[take] = (db, max(floor + 18, peak - 30), full, np.percentile(full, 10) + 10)
    return _ENV[take]


QUIET = 16      # 160 ms of quiet = the word is over (a stop consonant's closure is shorter)


def start_of(take, mode, t):
    db, thr = envelope(take)[:2]
    i = int(t / 0.01)
    if mode == "x":                      # an exact start, for a soft first consonant the envelope misses
        return t + 0.05
    if mode == "f":
        while i < len(db) - 3 and not (db[i] > thr and db[i + 1] > thr and db[i + 2] > thr):
            i += 1
        return i * 0.01
    j = i
    while j < len(db) and db[j] <= thr and j - i < 60:                  # the hint fell in a gap: move into the word
        j += 1
    q = 0
    while j > 0 and q < QUIET:
        j -= 1
        q = q + 1 if db[j] <= thr else 0
    return (j + QUIET) * 0.01


def end_of(take, t):
    db, thr = envelope(take)[:2]
    j = int(t / 0.01)
    k = j
    while k < len(db) and db[k] <= thr and k - j < 80:
        k += 1
    q = 0
    while k < len(db) - 1 and q < QUIET:
        k += 1
        q = q + 1 if db[k] <= thr else 0
    return (k - QUIET + 1) * 0.01


def plan():
    out = {}
    for lid, segs in CUTS.items():
        spans = []
        for take, (mode, t0), t1 in segs:
            a = max(start_of(take, mode, t0) - 0.05, 0)
            b = end_of(take, t1) + 0.14
            # consonants live above the voice band (the ש of שימו, a final ת or ס): widen on the full
            # band while it is still sounding, a little at the head (a breath is there too), more at the tail
            full, fthr = envelope(take)[2:]
            i, n = int(a / 0.01), 0
            while i > 1 and n < 12 and full[i - 1] > fthr:
                i -= 1; n += 1
            a = max(i * 0.01 - (0.02 if n else 0), 0)
            j, n = int(b / 0.01), 0
            while j < len(full) - 1 and n < 40 and full[j] > fthr:
                j += 1; n += 1
            b = j * 0.01 + (0.06 if n else 0)
            spans.append((take, round(a, 3), round(b, 3)))
        out[lid] = spans
    return out


def dur_of(p):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)],
                                capture_output=True, text=True).stdout)


def cut_voice(lid, spans):
    take = spans[0][0]
    wav = RD / "voice" / f"{lid}.wav"
    if len(spans) == 1:
        prep_voice(SRC / (F % take), wav, keep=(spans[0][1], spans[0][2]), tempo=TEMPO)
    else:
        prep_voice(SRC / (F % take), wav, segments=[(a, b) for _, a, b in spans], tempo=TEMPO)
    return lid, dur_of(wav)


def cut_picture(lid, spans):
    """Talking lines only (one span each): matte on white, then speed with the cleaned voice."""
    take, a, b = spans[0]
    tmp = RD / "clips" / f"_{lid}_w.mp4"
    bg = RD / "graphics" / f"bg_{BG[lid]}.png" if lid in BG else None
    whitebg.clean_room_rvm(SRC / (F % take), tmp, proof=RD / "proofs" / f"clean_{lid}.jpg", a=a, b=b, retouch=True)   # his real room, tidied (he rejected white and colour)
    out = RD / "clips" / f"{lid}.mp4"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(tmp), "-i", str(RD / "voice" / f"{lid}.wav"),
                    "-filter_complex", f"[0:v]setpts=(PTS-STARTPTS)/{TEMPO},fps=30,{GRADE_OUT if take in OUTDOOR else GRADE}[v]", "-map", "[v]", "-map", "1:a",
                    "-c:v", "libx264", "-crf", "14", "-preset", "fast", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-shortest", str(out)], check=True)
    tmp.unlink()
    ph = RD / "clips" / f"{lid}.placeholder"
    if ph.exists():
        ph.unlink()
    return lid


def check():
    import difflib
    import re
    from faster_whisper import WhisperModel
    m = WhisperModel("ivrit-ai/whisper-large-v3-turbo-ct2", device="cpu", compute_type="int8", cpu_threads=8)
    norm = lambda s: re.sub(r"[^\u05D0-\u05EAa-zA-Z0-9 ]", "", s)  # noqa: E731
    bad = 0
    lines = json.loads((RD / "said.json").read_text(encoding="utf-8"))
    for lid in CUTS:
        wav = RD / "voice" / f"{lid}.wav"
        segs, _ = m.transcribe(str(wav), language="he", vad_filter=False, condition_on_previous_text=False)
        said = " ".join(s.text.strip() for s in segs)
        r = difflib.SequenceMatcher(None, norm(lines[lid]), norm(said)).ratio()
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(wav), "-f", "f32le", "-ac", "1", "-"], capture_output=True).stdout
        x = np.frombuffer(raw, np.float32)
        tail = 20 * np.log10(np.sqrt(np.mean(x[-2880:] ** 2)) + 1e-9)
        head = 20 * np.log10(np.sqrt(np.mean(x[:1440] ** 2)) + 1e-9)
        flag = "" if (r > 0.86 and tail < -40) else "  <<<<"
        bad += bool(flag)
        print(f"{lid:5} {r:.2f} head {head:5.1f} tail {tail:5.1f} dB «{said}»{flag}", flush=True)
    print(f"check: {len(CUTS) - bad} of {len(CUTS)} lines clean")


if __name__ == "__main__":
    if "--check" in sys.argv:
        check()
        sys.exit(0)
    P = plan()
    for lid, spans in P.items():
        print(lid, "  ".join(f"{t} {a:.2f}-{b:.2f} ({b - a:.2f}s)" for t, a, b in spans))
    (RD / "plan.json").write_text(json.dumps(P, indent=1), encoding="utf-8")
    if "--plan" in sys.argv:
        sys.exit(0)
    talk = set(CUTS) - VOICE_ONLY
    only = [x for x in sys.argv[1:] if not x.startswith("--")]
    todo = {k: v for k, v in P.items() if not only or k in only}
    (RD / "voice").mkdir(exist_ok=True)
    with ThreadPoolExecutor(6) as ex:
        res = dict(ex.map(lambda kv: cut_voice(*kv), todo.items()))
    mp = RD / "measured.json"
    old = json.loads(mp.read_text(encoding="utf-8")) if mp.exists() else {}
    mp.write_text(json.dumps({**old, **{k: round(v, 3) for k, v in res.items()}}, indent=1), encoding="utf-8")
    print("voice done", round(sum(res.values()), 1), "s")
    if "--voice" in sys.argv:
        sys.exit(0)
    pics = [(k, v) for k, v in todo.items() if k in talk]
    with ThreadPoolExecutor(3) as ex:
        for lid in ex.map(lambda kv: cut_picture(*kv), pics):
            print("picture", lid, flush=True)
