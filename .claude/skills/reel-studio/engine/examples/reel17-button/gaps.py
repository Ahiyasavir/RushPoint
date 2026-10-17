# -*- coding: utf-8 -*-
"""Second pass: transcribe every stretch the whole file pass skipped (retakes hide there)."""
import subprocess, sys
from pathlib import Path
import numpy as np
RD = Path(__file__).parent
SPANS = {
 "20261013_210455.mp4": [(7.0, 11.8), (16.4, 21.9), (21.9, 27.3), (33.0, 40.4), (40.3, 45.9), (54.3, 59.4), (59.0, 66.3), (66.0, 74.1)],
 "20261013_205807.mp4": [(0.0, 8.0), (8.0, 12.7)],
 "20261013_205823.mp4": [(0.0, 6.0), (6.0, 12.3)],
 "20261013_210613.mp4": [(0.0, 4.2), (4.2, 7.45)],
 "20261013_210733.mp4": [(0.0, 10.2)],
 "20261013_210344.mp4": [(0.0, 10.3)],
 "20261013_210400.mp4": [(0.0, 6.1)],
 "20261013_210417.mp4": [(0.0, 10.6)],
}
from faster_whisper import WhisperModel
m = WhisperModel("ivrit-ai/whisper-large-v3-turbo-ct2", device="cpu", compute_type="int8", cpu_threads=8)
for name, spans in SPANS.items():
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(RD / "src" / name), "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], capture_output=True).stdout
    x = np.frombuffer(raw, np.float32)
    for a, b in spans:
        seg = x[int(a * 16000): int(b * 16000)]
        segs, _ = m.transcribe(seg, language="he", vad_filter=False, condition_on_previous_text=False, word_timestamps=True)
        words = [(w.word.strip(), round(a + w.start, 2), round(a + w.end, 2)) for s in segs for w in s.words]
        print(f"{name[9:15]} {a:6.2f}-{b:6.2f}  " + " ".join(f"{w}[{s}]" for w, s, e in words), flush=True)
