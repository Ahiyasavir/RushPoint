# -*- coding: utf-8 -*-
import json, sys
from pathlib import Path
import numpy as np
sys.argv = sys.argv[:1]
import bench as B
import importlib.util
HERE = Path(__file__).parent
IN, OUT = HERE / "in13", HERE / "out13"
src13 = (HERE / "bench13.py").read_text(encoding="utf-8")
ns = {"__file__": str(HERE / "bench13.py")}
exec(src13.split("res = {}")[0], ns)           # CENT, ltas
ltas, CENT = ns["ltas"], ns["CENT"]
LIM = "alimiter=limit=0.89:attack=2:release=40:level=disabled"
C = {
 "c1_hp": f"highpass=f=80:p=2,{LIM}",
 "c2_soft": f"highpass=f=80:p=2,acompressor=threshold=-22dB:ratio=1.6:attack=20:release=200:knee=8:makeup=1.5,{LIM}",
 "c3_soft_tilt": f"highpass=f=80:p=2,acompressor=threshold=-22dB:ratio=1.6:attack=20:release=200:knee=8:makeup=1.5,highshelf=f=5500:g=-2,{LIM}",
 "c4_2to1_de": f"highpass=f=80:p=2,acompressor=threshold=-22dB:ratio=2:attack=20:release=200:knee=8:makeup=2,deesser=i=0.3:m=0.5:f=0.5,highshelf=f=5500:g=-2.5,{LIM}",
 "c5_warm": f"highpass=f=80:p=2,equalizer=f=180:t=q:w=0.9:g=1.2,acompressor=threshold=-22dB:ratio=1.6:attack=20:release=200:knee=8:makeup=1.5,highshelf=f=5500:g=-2,{LIM}",
}
for src in sorted(IN.glob("*.wav")):
    k = src.stem
    ref = ltas(src)
    for name, flt in C.items():
        B.ff(["-i", str(src), "-af", flt, str(OUT / f"{k}_{name}_pre.wav")]); B.loud(OUT / f"{k}_{name}_pre.wav", OUT / f"{k}_{name}.wav", -17)
        p = OUT / f"{k}_{name}.wav"
        sig, bak, ovr = B.dnsmos(p)
        d = ltas(p) - ref
        print(f"{k:8} {name:13} SIG {sig:.2f} BAK {bak:.2f} OVRL {ovr:.2f} timbre max {np.abs(d).max():4.1f} rms {np.sqrt((d**2).mean()):3.1f} LRA {B.lra(p)} " + str({c: round(float(v),1) for c, v in zip(CENT, d) if abs(v) > 1.5}), flush=True)
