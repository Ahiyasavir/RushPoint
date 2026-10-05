# -*- coding: utf-8 -*-
"""Step 1 of every edit: know the material before touching a timeline.

    python ingest.py <folder> [--out <dir>] [--no-transcribe]

For every video/audio file in <folder> (Hebrew names fine):
  probe      duration, size, rotation, fps (r vs avg → VFR flag), audio yes/no
  sheet      12 frames WITH their timestamp burned in → <out>/<name>.jpg   (look at them!)
  speech     energy based speech regions (20 ms), the ground truth for word timing
  words      faster-whisper ivrit-ai large-v3-turbo with word timestamps, then SHIFTED so
             the first word starts on the first energy onset (whisper ran ~0.5 s early on
             2026-10-01; never place a caption or a cut on raw whisper times)
Writes <out>/ingest.json and prints one line per file.
Never moves or renames the originals.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np

os.environ.setdefault("PYTHONUTF8", "1")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

VID = {".mp4", ".mov", ".m4v", ".mkv", ".webm"}
AUD = {".m4a", ".wav", ".mp3", ".aac", ".ogg", ".opus"}
FONT = "C\\:/Windows/Fonts/arial.ttf" if os.name == "nt" else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def probe(p: Path) -> dict:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                        "stream=codec_type,width,height,r_frame_rate,avg_frame_rate:stream_side_data=rotation:format=duration",
                        "-of", "json", str(p)], capture_output=True, text=True, encoding="utf-8")
    j = json.loads(r.stdout or "{}")
    out = {"duration": round(float(j.get("format", {}).get("duration", 0)), 3), "audio": False, "video": False}
    for s in j.get("streams", []):
        if s.get("codec_type") == "audio":
            out["audio"] = True
        if s.get("codec_type") == "video":
            out["video"] = True
            out["w"], out["h"] = s.get("width"), s.get("height")
            rot = next((d.get("rotation") for d in s.get("side_data_list", []) if "rotation" in d), 0)
            out["rotation"] = rot
            if rot in (90, -90, 270, -270):
                out["w"], out["h"] = out["h"], out["w"]
            def f(x):
                a, b = (x or "0/1").split("/")
                return float(a) / float(b or 1)
            out["fps_r"], out["fps_avg"] = round(f(s.get("r_frame_rate")), 3), round(f(s.get("avg_frame_rate")), 3)
            out["vfr"] = abs(out["fps_r"] - out["fps_avg"]) > 0.005   # phones: 29.98 avg vs 30 r is VFR
    return out


def sheet(p: Path, dur: float, dst: Path):
    dt = f"drawtext=fontfile='{FONT}':text='%{{pts\\:flt}}':x=4:y=4:fontsize=20:fontcolor=yellow:box=1:boxcolor=black"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(p), "-vf",
                    f"fps=12/{max(dur, 0.5):.3f},scale=180:-1,{dt},tile=6x2", "-frames:v", "1", str(dst)])


def speech_regions(p: Path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(p), "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
                         capture_output=True).stdout
    x = np.frombuffer(raw, np.float32)
    if len(x) < 3200:
        return [], None
    hop = 320
    db = 20 * np.log10(np.array([np.sqrt(np.mean(x[i:i + hop] ** 2)) + 1e-9 for i in range(0, len(x) - hop, hop)]))
    floor = float(np.percentile(db, 10))
    on = db > floor + 14
    regs, i, n = [], 0, len(on)
    while i < n:
        if on[i]:
            j = i
            while j < n and (on[j] or (j + 9 < n and on[j:j + 9].any())):
                j += 1
            if (j - i) * 0.02 >= 0.12:
                regs.append([round(i * 0.02, 2), round(j * 0.02, 2)])
            i = j
        else:
            i += 1
    return regs, round(floor, 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("--out")
    ap.add_argument("--no-transcribe", action="store_true")
    a = ap.parse_args()
    src = Path(a.folder)
    out = Path(a.out) if a.out else src / "_ingest"
    out.mkdir(parents=True, exist_ok=True)
    files = sorted(p for p in src.iterdir() if p.suffix.lower() in VID | AUD)
    model = None
    res = {}
    for p in files:
        info = probe(p)
        regs, floor = speech_regions(p) if info["audio"] else ([], None)
        info["speech"] = regs
        info["noise_floor_db"] = floor
        if info["video"]:
            sheet(p, info["duration"], out / f"{p.stem}.jpg")
            info["sheet"] = str(out / f"{p.stem}.jpg")
        speech_s = sum(b - a for a, b in regs)
        if regs and speech_s > 0.6 and not a.no_transcribe:
            if model is None:
                from faster_whisper import WhisperModel
                model = WhisperModel("ivrit-ai/whisper-large-v3-turbo-ct2", device="cpu", compute_type="int8")
            segs, _ = model.transcribe(str(p), language="he", word_timestamps=True, vad_filter=False)
            words, text = [], []
            for s in segs:
                text.append(s.text)
                words += [[w.word.strip(), round(w.start, 2), round(w.end, 2)] for w in (s.words or [])]
            shift = round(regs[0][0] - words[0][1], 2) if words else 0.0
            info["text"] = " ".join(text).strip()
            info["whisper_shift_s"] = shift
            info["words"] = [[w, round(s0 + shift, 2), round(e0 + shift, 2)] for w, s0, e0 in words]
        res[p.name] = info
        flag = " VFR" if info.get("vfr") else ""
        print(f"{p.name}: {info['duration']}s {info.get('w','')}x{info.get('h','')}{flag} "
              f"audio={info['audio']} speech={speech_s:.1f}s" + (f" «{info.get('text','')[:60]}»" if info.get("text") else ""))
    (out / "ingest.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"→ {out / 'ingest.json'}  (look at every sheet before tagging)")


if __name__ == "__main__":
    main()
