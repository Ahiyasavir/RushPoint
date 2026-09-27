"""Lip sync by audio-to-audio cross correlation, whole file AND each quarter.

_refs.wav is the CAMERA's own microphone, cut with the same plan as the picture
and sped to 1.2x, so it is a stand-in for the mouth. Any offset between it and
the delivered mix is the amount the voice leads or lags the lips.
An optical mouth-aperture proxy is far less reliable; this is the real check.
"""
import numpy as np, librosa, subprocess, sys

SR = 16000
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", "FINAL2.mp4",
                "-ac", "1", "-ar", str(SR), "_fin2.wav"], check=True)
ref, _ = librosa.load("_refs.wav", sr=SR)
fin, _ = librosa.load("_fin2.wav", sr=SR)
n = min(len(ref), len(fin))
ref, fin = ref[:n], fin[:n]

def env(x):
    r = librosa.feature.rms(y=x, frame_length=1024, hop_length=160)[0]
    r = r - r.mean()
    return r / (r.std() + 1e-9)

HOP = 160 / SR          # 10 ms per envelope frame

def offset(a, b, maxlag=0.40):
    ea, eb = env(a), env(b)
    m = min(len(ea), len(eb)); ea, eb = ea[:m], eb[:m]
    k = int(maxlag / HOP)
    best, bl = -9e9, 0
    for lag in range(-k, k + 1):
        if lag < 0:   x, y = ea[-lag:], eb[:len(eb) + lag]
        elif lag > 0: x, y = ea[:len(ea) - lag], eb[lag:]
        else:         x, y = ea, eb
        if len(x) < 50: continue
        c = float(np.dot(x, y) / len(x))
        if c > best: best, bl = c, lag
    return bl * HOP * 1000.0, best

o, c = offset(ref, fin)
print(f"whole file : {o:+7.1f} ms   (corr {c:.3f})")
q = n // 4
worst = abs(o)
for i in range(4):
    oq, cq = offset(ref[i*q:(i+1)*q], fin[i*q:(i+1)*q])
    worst = max(worst, abs(oq))
    print(f"  quarter {i+1}: {oq:+7.1f} ms   (corr {cq:.3f})")
print(f"\nworst magnitude {worst:.1f} ms  ->  "
      f"{'PASS' if worst <= 25 else 'FAIL'} (target under 25 ms, no drift)")
sys.exit(0 if worst <= 25 else 1)
