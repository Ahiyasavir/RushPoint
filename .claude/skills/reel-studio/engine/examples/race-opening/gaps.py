# -*- coding: utf-8 -*-
import json, subprocess
from pathlib import Path
import numpy as np
RD = Path(__file__).parent
PH = json.loads((RD / "ingest" / "phrases.json").read_text(encoding="utf-8"))
from faster_whisper import WhisperModel
m = WhisperModel("ivrit-ai/whisper-large-v3-turbo-ct2", device="cpu", compute_type="int8", cpu_threads=8)
for name, phs in sorted(PH.items()):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(RD / "src" / name), "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], capture_output=True).stdout
    x = np.frombuffer(raw, np.float32)
    for p in phs:
        ws = p["words"]
        spans = []
        if not ws:
            continue
        if ws[0][1] - p["a"] > 1.2: spans.append((p["a"], ws[0][1] - 0.15))
        for u, v in zip(ws, ws[1:]):
            if v[1] - u[2] > 1.5: spans.append((u[2] + 0.1, v[1] - 0.1))
        if p["b"] - ws[-1][2] > 1.2: spans.append((ws[-1][2] + 0.15, p["b"]))
        for a, b in spans:
            seg = x[int(a * 16000): int(b * 16000)]
            rms = 20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-9)
            segs, _ = m.transcribe(seg, language="he", vad_filter=False, condition_on_previous_text=False)
            print(f"{name[9:15]} gap {a:7.2f}-{b:7.2f} rms {rms:5.1f} dB  «{' '.join(s.text.strip() for s in segs)}»", flush=True)
