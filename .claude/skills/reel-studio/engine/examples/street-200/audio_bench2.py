# Street-200 voice chains, scored two ways (2026-10-16, "make the sound really good, but we must still
# sound like ourselves"): DNSMOS (SIG voice, BAK background, OVRL) and TIMBRE DRIFT, the third octave
# long term spectrum of the speech frames against the raw clip (level free). > ~2.5 dB in a band = a
# different voice (lessons-2026-10-13 section 3).
#   ~/.claude/toolkits/venvs/clearvoice/Scripts/python.exe audio_bench2.py <src> <a> <b> <tag>
import subprocess
import sys
from pathlib import Path

LAB = Path.home() / "Desktop/RushPoint-reels-work/_audio-lab"
sys.path.insert(0, str(LAB))
argv = sys.argv[1:]; sys.argv = sys.argv[:1]
import bench as B  # noqa: E402
import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

CENT = [125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000]


def ltas(p):
    x, sr = sf.read(str(p))
    if x.ndim > 1:
        x = x.mean(1)
    n = 4096
    fr = np.fft.rfftfreq(n, 1 / sr)
    frames = [np.abs(np.fft.rfft(x[i:i + n] * np.hanning(n))) ** 2 for i in range(0, len(x) - n, n // 2)]
    e = np.array([f.sum() for f in frames])
    spec = np.sum([f for f, k in zip(frames, e) if k > np.percentile(e, 40)], axis=0)
    out = np.array([10 * np.log10(spec[(fr >= c / 1.122) & (fr < c * 1.122)].sum() + 1e-12) for c in CENT])
    return out - out[2:13].mean()


src, a, b, tag = Path(argv[0]), float(argv[1]), float(argv[2]), argv[3]
OUT = Path(__file__).parent / "_bench2"; OUT.mkdir(exist_ok=True)
LIM = "alimiter=limit=0.89:attack=2:release=40:level=disabled"
LIGHT = f"highpass=f=80:p=2,acompressor=threshold=-22dB:ratio=1.6:attack=20:release=200:knee=8:makeup=1.5,highshelf=f=5500:g=-2,{LIM}"
LEVEL = "dynaudnorm=f=300:g=15:p=0.9:m=6:r=0.3,"   # brings the far speaker up to the near one, slowly
FIELD = ("highpass=f=90,dynaudnorm=f=250:g=11:p=0.9:m=8,equalizer=f=3300:t=q:w=1.2:g=-3,"
         f"equalizer=f=6500:t=q:w=1.4:g=-2.5,deesser=i=0.4,acompressor=threshold=-20dB:ratio=2:attack=8:release=120:makeup=1,{LIM}")
raw = OUT / f"{tag}_raw.wav"
B.ff(["-ss", f"{a}", "-t", f"{b - a}", "-i", str(src), "-vn", "-ac", "1", "-ar", "48000", "-af", "volume=-8dB", "-c:a", "pcm_f32le", str(raw)])
pre = {"raw": raw}
dc = OUT / f"{tag}_declip.wav"
B.ff(["-i", str(raw), "-af", "adeclip=window=55:overlap=75:arorder=8:threshold=10:hsize=1000", str(dc)])
pre["declip"] = dc
p = OUT / f"{tag}_declip_dfn24.wav"; B.dfn(dc, p, 24); pre["declip+dfn24"] = p
for lim in (18, 24, 32):
    p = OUT / f"{tag}_dfn{lim}.wav"; B.dfn(raw, p, lim); pre[f"dfn{lim}"] = p
st = OUT / f"{tag}_stems"; st.mkdir(exist_ok=True)
w44 = st / "in.wav"
B.ff(["-i", str(raw), "-ac", "2", "-ar", "44100", str(w44)])
subprocess.run([r"C:\Users\savir\AppData\Local\Programs\Python\Python311\python.exe", "-m", "demucs", "--two-stems=vocals",
                "-n", "htdemucs", "-o", str(st), str(w44)], check=True, capture_output=True)
v, sr = sf.read(str(st / "htdemucs" / "in" / "vocals.wav")); bg, _ = sf.read(str(st / "htdemucs" / "in" / "no_vocals.wav"))
for db in (-15, -22):
    p = OUT / f"{tag}_dmx{-db}.wav"; sf.write(str(p), (v + bg * 10 ** (db / 20)).mean(1), sr); pre[f"demucs{db}"] = p
p = OUT / f"{tag}_dmx15_dfn12.wav"; B.dfn(pre["demucs-15"], p, 12); pre["demucs-15+dfn12"] = p

cands = {"raw": (raw, None)}
for k, p in pre.items():
    if k == "raw":
        continue
    cands[f"{k}+light"] = (p, LIGHT)
    cands[f"{k}+level+light"] = (p, LEVEL + LIGHT)
cands["dfn24+field"] = (pre["dfn24"], FIELD)
ref = ltas(raw)
rows = []
for name, (p, flt) in cands.items():
    out = OUT / f"{tag}_C_{name.replace('+', '_')}.wav"
    if flt:
        B.ff(["-i", str(p), "-af", flt, "-ar", "48000", "-ac", "1", str(out.with_suffix('.pre.wav'))])
        B.loud(out.with_suffix('.pre.wav'), out, -19)
    else:
        B.loud(p, out, -19)
    s, bk, o = B.dnsmos(out)
    d = ltas(out) - ref
    rows.append((o, name))
    print(f"{tag:10} {name:24} SIG {s:.2f} BAK {bk:.2f} OVRL {o:.2f}  timbre max {np.abs(d[:-2]).max():4.1f} rms {np.sqrt((d[:-2]**2).mean()):3.1f}"
          f"  LRA {B.lra(out)}  " + str({c: round(float(x), 1) for c, x in zip(CENT, d) if abs(x) > 2.5}), flush=True)
