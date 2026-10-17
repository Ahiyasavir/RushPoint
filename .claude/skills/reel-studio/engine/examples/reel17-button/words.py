# -*- coding: utf-8 -*-
"""Word times of every CUT voice line (after 1.12x), aligned to the energy onset, for the captions."""
import json, subprocess
from pathlib import Path
import numpy as np
RD = Path(__file__).parent
from faster_whisper import WhisperModel
m = WhisperModel("ivrit-ai/whisper-large-v3-turbo-ct2", device="cpu", compute_type="int8", cpu_threads=6)
out = {}
import sys
ONLY = set(sys.argv[1:])
if ONLY and (RD / "words.json").exists():
    out = json.loads((RD / "words.json").read_text(encoding="utf-8"))
for wav in sorted((RD / "voice").glob("*.wav")):
    if ONLY and wav.stem not in ONLY:
        continue
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(wav), "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], capture_output=True).stdout
    x = np.frombuffer(raw, np.float32)
    segs, _ = m.transcribe(x, language="he", vad_filter=False, condition_on_previous_text=False, word_timestamps=True)
    ws = [[w.word.strip(), round(w.start, 3), round(w.end, 3)] for s in segs for w in s.words]
    out[wav.stem] = {"dur": round(len(x) / 16000, 3), "words": ws}
    print(wav.stem, " ".join(f"{w}[{a}-{b}]" for w, a, b in ws), flush=True)
(RD / "words.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
