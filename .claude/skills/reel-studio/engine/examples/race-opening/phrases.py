# -*- coding: utf-8 -*-
"""Second pass: every PHRASE (speech regions merged across gaps < GAP s) transcribed on its own,
so retakes, false starts and words whisper skipped in the long take all show up with exact bounds.
Writes ingest/phrases.json: {file: [{a, b, text, words}]}"""
import json, subprocess, sys
from pathlib import Path
import numpy as np
RD = Path(__file__).parent
ING = json.loads((RD / "ingest" / "ingest.json").read_text(encoding="utf-8"))
GAP = 0.75
from faster_whisper import WhisperModel
m = WhisperModel("ivrit-ai/whisper-large-v3-turbo-ct2", device="cpu", compute_type="int8", cpu_threads=8)
out = {}
for name in sorted(ING):
    regs = ING[name]["speech"]
    ph = []
    for a, b in regs:
        if ph and a - ph[-1][1] < GAP:
            ph[-1][1] = b
        else:
            ph.append([a, b])
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(RD / "src" / name), "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], capture_output=True).stdout
    x = np.frombuffer(raw, np.float32)
    res = []
    for a, b in ph:
        if b - a < 0.35:
            continue
        seg = x[int(max(a - 0.25, 0) * 16000): int((b + 0.25) * 16000)]
        segs, _ = m.transcribe(seg, language="he", word_timestamps=True, vad_filter=False, condition_on_previous_text=False)
        words = []
        for s in segs:
            words += [[w.word.strip(), round(w.start + max(a - 0.25, 0), 2), round(w.end + max(a - 0.25, 0), 2)] for w in (s.words or [])]
        res.append({"a": a, "b": b, "text": " ".join(w[0] for w in words), "words": words})
        print(f"{name[9:15]} {a:7.2f}-{b:7.2f}  {res[-1]['text']}", flush=True)
    out[name] = res
(RD / "ingest" / "phrases.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
