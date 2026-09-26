"""Bed v2 for reel 1. Deliberately NOT the previous video's Am-F-C-G pop loop.

Design, and why:
  * E minor with a PEDAL root. A four chord loop resolves every bar and feels
    finished; a static pedal with moving upper voices never resolves, so the ear
    keeps waiting. That is the point under a video whose ask is at the end.
  * Energy CLIMBS to the last frame: sparse -> pulse -> kick -> stabs -> full.
    The previous bed was full from bar 4 and had nowhere to go.
  * A bar-line tick, like a clock. It is a timed race.
  * 19 bars over 30.667 s == 1.614 s/bar, noticeably quicker than the old 1.804.
"""
import os
import numpy as np
from scipy.signal import butter, sosfilt
import soundfile as sf

WORK = os.path.dirname(os.path.abspath(__file__))
SR = 48000
TOTAL = 30.667
BARS = 19
BAR = TOTAL / BARS          # 1.6141 s  -> ~148.7 BPM
BEAT = BAR / 4
N = int(TOTAL * SR)
OUT = os.path.join(WORK, "music.wav")

rng = np.random.default_rng(20261022)      # the event date, not seed 7
L = np.zeros(N)
R = np.zeros(N)


def at(t):
    return int(t * SR)


def add(buf, start, sig, gain=1.0):
    i = at(start)
    if i >= N:
        return
    j = min(N, i + len(sig))
    buf[i:j] += sig[:j - i] * gain


NOTE = {"E1": 41.20, "E2": 82.41, "G2": 98.00, "A2": 110.00, "B2": 123.47,
        "D3": 146.83, "E3": 164.81, "G3": 196.00, "A3": 220.00, "B3": 246.94,
        "D4": 293.66, "E4": 329.63, "F#4": 369.99, "G4": 392.00, "A4": 440.00,
        "B4": 493.88, "D5": 587.33, "E5": 659.25}


def kick(vel=1.0):
    n = at(0.26)
    t = np.arange(n) / SR
    f = 44 + 105 * np.exp(-t * 44)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 11.0)
    click = rng.normal(0, 1, n) * np.exp(-t * 400) * 0.10
    return np.tanh((body + click) * 1.6) * 0.32 * vel


def clap(vel=1.0):
    """Three short bursts a few ms apart: a clap, not a snare."""
    n = at(0.20)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for k, off in enumerate((0.0, 0.009, 0.019)):
        i = at(off)
        seg = rng.normal(0, 1, n - i) * np.exp(-t[:n - i] * (150 - 30 * k))
        out[i:] += seg * (0.6 + 0.4 * k)
    sos = butter(4, [1300, 7200], btype="band", fs=SR, output="sos")
    out = sosfilt(sos, out)
    tail = rng.normal(0, 1, n) * np.exp(-t * 26) * 0.12
    tail = sosfilt(butter(4, [1800, 6000], btype="band", fs=SR, output="sos"), tail)
    return (out + tail) * 0.17 * vel


def shaker(vel=1.0):
    n = at(0.055)
    t = np.arange(n) / SR
    x = rng.normal(0, 1, n)
    x = sosfilt(butter(4, [7500, 15000], btype="band", fs=SR, output="sos"), x)
    return x * np.exp(-t * 90) * 0.20 * vel


def tick():
    """The bar line. Dry, short, high: reads as a clock, not as music."""
    n = at(0.035)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * 2450 * t) + 0.5 * np.sin(2 * np.pi * 3700 * t)
    return x * np.exp(-t * 240) * 0.055


def pulse_bass(freq, dur, width=0.32, vel=1.0):
    """Pulse wave, resonant-ish sweep down. Carries the ostinato."""
    n = at(dur)
    t = np.arange(n) / SR
    ph = (t * freq) % 1.0
    x = np.where(ph < width, 1.0, -1.0)
    x = x + 0.35 * np.sin(2 * np.pi * freq * t)          # fatten the fundamental
    cut = 300 + 1500 * np.exp(-t * 22)
    y = np.zeros(n)
    prev = 0.0
    for i in range(n):
        a = 1 - np.exp(-2 * np.pi * cut[i] / SR)
        prev += a * (x[i] - prev)
        y[i] = prev
    e = np.ones(n)
    a = max(1, at(0.004))
    e[:a] = np.linspace(0, 1, a)
    r = max(1, at(min(0.05, dur * 0.35)))
    e[-r:] *= np.linspace(1, 0, r)
    return y * e * 0.20 * vel


def stab(freqs, dur, vel=1.0):
    """Short marcato chord. Attack only, no sustain: pushes forward."""
    n = at(dur)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for f in freqs:
        for det in (-0.004, 0.0, 0.005):
            ph = (t * f * (1 + det)) % 1.0
            x += 2 * ph - 1
    x /= len(freqs) * 3
    x = sosfilt(butter(4, 3400, btype="low", fs=SR, output="sos"), x)
    e = np.exp(-t * 16.0)
    e[:at(0.004)] *= np.linspace(0, 1, at(0.004))
    return x * e * 0.30 * vel


def riser(dur):
    """Filtered noise sweeping up. Announces the ask."""
    n = at(dur)
    t = np.arange(n) / SR
    x = rng.normal(0, 1, n)
    lo = 400 + 5200 * (t / dur) ** 2.1
    y = np.zeros(n)
    prev = 0.0
    for i in range(n):
        a = 1 - np.exp(-2 * np.pi * lo[i] / SR)
        prev += a * (x[i] - prev)
        y[i] = x[i] - prev            # highpass = subtract the lowpass
    return y * ((t / dur) ** 2.4) * 0.11


# E natural minor. The bass stays on E; the stabs move above it.
OSTINATO = ["E2", "E2", "G2", "E2", "A2", "E2", "B2", "G2"]
UPPER = [["E4", "G4", "B4"], ["E4", "A4", "D5"],
         ["E4", "G4", "D5"], ["F#4", "A4", "D5"]]

for b in range(BARS):
    t0 = b * BAR
    pulse_on = b >= 1
    kick_on = b >= 4
    stab_on = b >= 9
    full = b >= 14

    add(L, t0, tick())
    add(R, t0, tick())

    if kick_on:
        pattern = [0.0, 1.5, 2.0, 3.5] if b % 2 else [0.0, 1.5, 2.0, 3.0]
        for k in pattern:
            v = 1.0 if k == 0.0 else 0.85
            add(L, t0 + k * BEAT, kick(v))
            add(R, t0 + k * BEAT, kick(v))
        for k in (1.0, 3.0):
            c = clap(0.9 if full else 0.7)
            add(L, t0 + k * BEAT, c, 1.0)
            add(R, t0 + k * BEAT + 0.006, c, 0.92)

    if b >= 2:
        for k in range(16):
            v = (1.0 if k % 4 == 0 else 0.42 if k % 2 == 0 else 0.62)
            if not full and k % 2:
                continue
            s = shaker(v)
            add(L, t0 + k * (BEAT / 4), s, 0.85)
            add(R, t0 + k * (BEAT / 4) + 0.004, s, 1.0)

    if pulse_on:
        for k, nm in enumerate(OSTINATO):
            d = BEAT / 2 * 0.94
            vel = 1.0 if k % 4 == 0 else 0.8
            p = pulse_bass(NOTE[nm], d, vel=vel * (1.0 if kick_on else 0.7))
            add(L, t0 + k * (BEAT / 2), p)
            add(R, t0 + k * (BEAT / 2), p)

    if stab_on:
        ch = [NOTE[x] for x in UPPER[b % 4]]
        hits = (0.0, 1.5, 2.5) if b % 2 else (0.0, 2.0, 3.5)
        for k in hits:
            s = stab(ch, BEAT * 0.9, 1.0 if full else 0.72)
            add(L, t0 + k * BEAT, s, 0.9)
            add(R, t0 + k * BEAT + 0.009, s, 1.0)

# one riser into the last four bars: the CTA
add(L, (BARS - 5) * BAR, riser(BAR * 4.0), 0.9)
add(R, (BARS - 5) * BAR, riser(BAR * 4.0), 1.0)


def shape(x):
    x = sosfilt(butter(2, 38, btype="high", fs=SR, output="sos"), x)
    return np.tanh(x * 1.06) * 0.95


L, R = shape(L[:N]), shape(R[:N])
peak = max(np.abs(L).max(), np.abs(R).max())
L, R = L / peak * 0.89, R / peak * 0.89
sf.write(OUT, np.stack([L, R], axis=1), SR, subtype="PCM_24")
print(f"music v2: {TOTAL:.3f}s  {BARS} bars x {BAR:.4f}s  ~{60/BEAT:.0f} BPM  peak={peak:.3f}")
