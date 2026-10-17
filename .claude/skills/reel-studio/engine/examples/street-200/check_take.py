# Round trip: transcribe voice/take.wav back, per segment, beside the captions (assemble.py --check).
# Also prints each segment's head and tail level: a tail louder than -40 dB = a clipped word.
#   python check_take.py s200-compilation [s200-60sec ...]
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

sys.stdout.reconfigure(encoding="utf-8")
HERE = Path(__file__).resolve().parent
from faster_whisper import WhisperModel  # noqa: E402

m = WhisperModel("ivrit-ai/whisper-large-v3-turbo-ct2", device="cpu", compute_type="int8", cpu_threads=4)
for reel in sys.argv[1:]:
    RD = HERE.parent / reel
    M = json.loads((RD / "measured.json").read_text(encoding="utf-8"))
    caps = json.loads((RD / "captions.json").read_text(encoding="utf-8"))
    x, sr = sf.read(str(RD / "_seg" / "take_raw.wav"), dtype="float32")
    st = M["seg_start"] + [M["take_end"]]
    print(f"===== {reel}  {M['take_end']:.1f}s")
    for k, (a, b) in enumerate(zip(st[:-1], st[1:])):
        seg = x[int(a * sr):int(b * sr)]
        db = lambda y: 20 * np.log10(np.sqrt(np.mean(y ** 2)) + 1e-9)  # noqa: E731
        head, tail = db(seg[:int(0.06 * sr)]), db(seg[-int(0.06 * sr):])
        import scipy.signal as S
        y = S.resample_poly(seg, 1, 3)
        txt = " ".join(s.text.strip() for s in m.transcribe(y, language="he", beam_size=5, vad_filter=False)[0])
        mine = " / ".join(c["text"] for c in caps if a - 0.01 <= c["start"] < b - 0.01)
        flag = "  <-- TAIL LOUD" if tail > -40 else ""
        print(f"[{k:02d}] {a:6.2f}-{b:6.2f} head {head:5.1f} tail {tail:5.1f}{flag}\n   heard: {txt}\n   caps : {mine}")
