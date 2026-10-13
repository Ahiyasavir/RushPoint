# -*- coding: utf-8 -*-
"""2026-10-13: 'sounds like me, but good'. Candidates scored by DNSMOS AND by how far the
voice's own spectrum moved from the raw take (third octave LTAS, speech frames only): a chain
that moves a band more than ~2.5 dB has changed his timbre."""
import json, sys
from pathlib import Path
import numpy as np, soundfile as sf
sys.argv = sys.argv[:1]
import bench as B
HERE = Path(__file__).parent
IN, OUT = HERE / "in13", HERE / "out13"
NAT = ("highpass=f=80:p=2,"
       "equalizer=f=240:t=q:w=1.0:g=-1.5,"
       "acompressor=threshold=-24dB:ratio=2:attack=15:release=140:knee=8:makeup=2,"
       "acompressor=threshold=-14dB:ratio=3:attack=3:release=60:knee=4:makeup=1,"
       "deesser=i=0.2:m=0.5:f=0.5,"
       "highshelf=f=9000:g=1.0,"
       "alimiter=limit=0.89:attack=2:release=40:level=disabled")
NAT_P = NAT.replace("highshelf=f=9000:g=1.0", "equalizer=f=3000:t=q:w=0.8:g=1.5,highshelf=f=9000:g=1.5")
CENT = [125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000]

def ltas(p):
    x, sr = sf.read(str(p))
    if x.ndim > 1: x = x.mean(1)
    n = 4096
    fr = np.fft.rfftfreq(n, 1 / sr)
    frames = [np.abs(np.fft.rfft(x[i:i + n] * np.hanning(n))) ** 2 for i in range(0, len(x) - n, n // 2)]
    e = np.array([f.sum() for f in frames])
    spec = np.sum([f for f, k in zip(frames, e) if k > np.percentile(e, 40)], axis=0)
    out = np.array([10 * np.log10(spec[(fr >= c / 1.122) & (fr < c * 1.122)].sum() + 1e-12) for c in CENT])
    return out - out[2:13].mean()            # level free: relative to the 200 Hz..2 kHz body

res = {}
for src in sorted(IN.glob("*.wav")):
    k = src.stem
    c = {"raw": src}
    def chain(name, inp, flt):
        B.ff(["-i", str(inp), "-af", flt, str(OUT / f"{k}_{name}_pre.wav")]); B.loud(OUT / f"{k}_{name}_pre.wav", OUT / f"{k}_{name}.wav", -17)
        c[name] = OUT / f"{k}_{name}.wav"
    chain("old", src, B.MASTER)
    chain("nat", src, NAT)
    chain("natp", src, NAT_P)
    B.mf2(src, OUT / f"{k}_mf2_raw.wav")
    for pct in (35, 60):
        B.ff(["-i", str(OUT / f"{k}_mf2_raw.wav"), "-i", str(src), "-filter_complex",
              f"[0:a]aresample=48000,volume={pct/100}[a];[1:a]aresample=48000,volume={1-pct/100}[b];[a][b]amix=inputs=2:normalize=0", "-ac", "1", str(OUT / f"{k}_mix{pct}.wav")])
        chain(f"nat_mf{pct}", OUT / f"{k}_mix{pct}.wav", NAT)
    ref = ltas(src)
    res[k] = {}
    for name, p in c.items():
        sig, bak, ovr = B.dnsmos(p)
        d = ltas(p) - ref
        res[k][name] = {"SIG": sig, "BAK": bak, "OVRL": ovr, "timbre_max_dB": round(float(np.abs(d).max()), 1),
                        "timbre_rms_dB": round(float(np.sqrt((d ** 2).mean())), 1), "LRA": B.lra(p),
                        "moved": {str(cc): round(float(v), 1) for cc, v in zip(CENT, d) if abs(v) > 2}}
        print(f"{k:8} {name:10} SIG {sig:.2f} BAK {bak:.2f} OVRL {ovr:.2f} timbre max {res[k][name]['timbre_max_dB']:4.1f} rms {res[k][name]['timbre_rms_dB']:3.1f} LRA {res[k][name]['LRA']} {res[k][name]['moved']}", flush=True)
(HERE / "results13.json").write_text(json.dumps(res, indent=1), encoding="utf-8")
