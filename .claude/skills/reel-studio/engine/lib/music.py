# -*- coding: utf-8 -*-
"""Music beds synthesised in code (no licence question, and the loop closes on the
exact length of the reel). Grew out of videos/published/01-missions/source/music_gen2.py.

Ahiya, 2026-10-01: "every reel gets DIFFERENT music". Three styles share nothing but
the mixer, each with its own instruments, groove and harmony:

  suspense  (riddles)  drone + pizzicato + clock, a heartbeat that quickens
  funk      (stairs)   boom bap: kick, snare on 2 and 4, swung hats, e-piano, bouncy bass
  synthwave (AI reel)  16th arpeggiator, pumping pad, four on the floor, gated snare
  procession (classroom race video) walking toms, frame drum, lyre in an old mode, swells
  pulse     (reel 14 phone) dark heartbeat that opens into a bright four on the floor
  lofi      (reel 15 bet)   lazy lo fi under dialogue, a clock ticks at level 3
  briefing  (race opening)  soft piano arpeggio + pad, calm under a long talk

    make_music(out, total, style="funk", bpm=95, energy=[(0, 1), (10, 3)],
               accents=[2.0, 3.27], drops=[(20.0, 20.8)])

energy  = [(t, level)] steps, level 0..4
accents = times that get a hit on top (landings, reveals); drops = windows of silence
"""
from __future__ import annotations

import numpy as np
from scipy.signal import butter, sosfilt
import soundfile as sf

SR = 48000
A4 = 440.0


def hz(n: str) -> float:
    names = {"C": -9, "C#": -8, "D": -7, "D#": -6, "E": -5, "F": -4, "F#": -3, "G": -2, "G#": -1, "A": 0, "A#": 1, "B": 2}
    pitch, octv = n[:-1], int(n[-1])
    return A4 * 2 ** ((names[pitch] + (octv - 4) * 12) / 12)


class Bus:
    def __init__(self, total: float, seed: int):
        self.N = int(total * SR)
        self.L = np.zeros(self.N)
        self.R = np.zeros(self.N)
        self.rng = np.random.default_rng(seed)

    def add(self, t: float, sig: np.ndarray, g: float = 1.0, pan: float = 0.0):
        i = int(t * SR)
        if i >= self.N or i < 0 or len(sig) == 0:
            return
        j = min(self.N, i + len(sig))
        self.L[i:j] += sig[:j - i] * g * (1 - max(pan, 0))
        self.R[i:j] += sig[:j - i] * g * (1 + min(pan, 0))


def env(n: int, a: float, d: float) -> np.ndarray:
    t = np.arange(n) / SR
    e = np.exp(-t * d)
    k = max(1, int(a * SR))
    e[:k] *= np.linspace(0, 1, k)
    return e


def lp(x, f):
    return sosfilt(butter(2, min(f, SR / 2 - 100), btype="low", fs=SR, output="sos"), x)


def hp(x, f):
    return sosfilt(butter(2, f, btype="high", fs=SR, output="sos"), x)


def bp(x, lo, hi):
    return sosfilt(butter(2, [lo, hi], btype="band", fs=SR, output="sos"), x)


# ── instruments ───────────────────────────────────────────────────────────────
def kick(rng, dur=0.32, pitch=50, punch=1.0):
    n = int(dur * SR); t = np.arange(n) / SR
    f = pitch + 110 * np.exp(-t * 40) * punch
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)
    x += rng.normal(0, 1, n) * np.exp(-t * 500) * 0.08
    return np.tanh(x * 1.7) * 0.34


def snare(rng, dur=0.22, tone=190, bright=1.0):
    n = int(dur * SR); t = np.arange(n) / SR
    body = np.sin(2 * np.pi * tone * t) * np.exp(-t * 30) * 0.5
    noise = bp(rng.normal(0, 1, n), 1500, 9000 if bright > 0.5 else 6000) * np.exp(-t * 18)
    return (body + noise) * 0.22


def hat(rng, open_=False):
    dur = 0.22 if open_ else 0.045
    n = int(dur * SR); t = np.arange(n) / SR
    x = hp(rng.normal(0, 1, n), 8000) * np.exp(-t * (14 if open_ else 110))
    return x * 0.12


def pluck(freq, dur=0.5, damp=0.996, rng=None):
    """Karplus-Strong: a plucked string (pizzicato under the riddles)."""
    n = int(dur * SR)
    p = max(2, int(SR / freq))
    buf = (rng.random(p) * 2 - 1) if rng is not None else np.random.uniform(-1, 1, p)
    out = np.empty(n)
    for i in range(n):
        v = buf[i % p]
        out[i] = v
        buf[i % p] = damp * 0.5 * (v + buf[(i + 1) % p])
    return lp(out, 3500) * 0.35


def epiano(freqs, dur):
    """Two operator FM electric piano (the funk comping)."""
    n = int(dur * SR); t = np.arange(n) / SR
    x = np.zeros(n)
    for f in freqs:
        mod = np.sin(2 * np.pi * f * t) * 1.8 * np.exp(-t * 6)
        x += np.sin(2 * np.pi * f * t + mod) * np.exp(-t * 2.4)
    return x / max(len(freqs), 1) * env(n, 0.004, 0.0) * 0.22


def saw(freq, dur, cut=2400, det=(-0.006, 0.0, 0.007)):
    n = int(dur * SR); t = np.arange(n) / SR
    x = sum(2 * ((t * freq * (1 + d)) % 1.0) - 1 for d in det) / len(det)
    return lp(x, cut)


def sub(freq, dur):
    n = int(dur * SR); t = np.arange(n) / SR
    return np.sin(2 * np.pi * freq * t)


def riser(rng, dur):
    n = int(dur * SR); t = np.arange(n) / SR
    x = hp(rng.normal(0, 1, n), 900) * (t / dur) ** 2.2
    return x * 0.10


# ── styles ────────────────────────────────────────────────────────────────────
def _suspense(bus, total, bpm, lvl, accents):
    beat = 60 / bpm
    rng = bus.rng
    notes = ["E3", "G3", "B3", "E4", "D4", "B3", "G3", "F#3"]
    roots = ["E2", "E2", "C2", "D2"]
    t, k = 0.0, 0
    while t < total:
        L = lvl(t)
        bar = int(t / (beat * 4))
        if k % 4 == 0:   # drone per bar: low root + fifth, slow swell
            d = beat * 4
            f = hz(roots[bar % 4])
            x = (sub(f, d) * 0.6 + sub(f * 1.5, d) * 0.25 + lp(saw(f * 2, d, 900), 700) * 0.2)
            n = len(x); e = np.minimum(1, np.arange(n) / (0.6 * SR)) * np.minimum(1, (n - np.arange(n)) / (0.4 * SR))
            bus.add(t, x * e * (0.20 if L >= 1 else 0.12))
        # clock on every beat, a tock on the off beat
        n = int(0.03 * SR); tt = np.arange(n) / SR
        bus.add(t, np.sin(2 * np.pi * 2600 * tt) * np.exp(-tt * 260) * 0.05)
        if L >= 1:   # pizzicato arpeggio on eighths
            for h in (0.0, 0.5):
                nm = notes[(2 * k + int(h * 2)) % len(notes)]
                bus.add(t + h * beat, pluck(hz(nm), 0.45, 0.994, rng), 0.9 if h == 0 else 0.6, pan=0.3 if h else -0.3)
        if L >= 3:   # heartbeat: lub dub
            bus.add(t, kick(rng, 0.25, 45, 0.6), 0.9)
            bus.add(t + beat * 0.28, kick(rng, 0.22, 42, 0.5), 0.6)
        if L >= 4 and k % 2 == 1:   # quicker heart + a high string tremolo
            bus.add(t + beat * 0.5, kick(rng, 0.2, 45, 0.6), 0.7)
            f = hz("B4")
            d = beat; nn = int(d * SR); tt = np.arange(nn) / SR
            trem = saw(f, d, 3000) * (0.5 + 0.5 * np.sin(2 * np.pi * 12 * tt)) * 0.05
            bus.add(t, trem, pan=0.2)
        t += beat; k += 1
    for a in accents:   # a timpani like hit on every reveal
        bus.add(a, kick(rng, 0.6, 60, 1.2), 1.1)
        bus.add(a, pluck(hz("E5"), 0.8, 0.997, rng), 0.8)


def _funk(bus, total, bpm, lvl, accents):
    beat = 60 / bpm
    rng = bus.rng
    swing = 0.12
    chords = [["D4", "F#4", "A4", "C#5"], ["B3", "D4", "F#4", "A4"], ["G3", "B3", "D4", "F#4"], ["A3", "C#4", "E4", "G4"]]
    bassline = [("D2", 0, 0.45), ("D2", 0.75, 0.2), ("A2", 1.5, 0.3), ("F#2", 2.0, 0.4), ("A2", 2.75, 0.2), ("B2", 3.25, 0.3)]
    bar_len = beat * 4
    b = 0
    while b * bar_len < total:
        t0 = b * bar_len
        L = lvl(t0)
        ch = chords[b % 4]
        roots = [c for c in ch[:1]]
        if L >= 1:   # e-piano comping: on 1 and the 'and' of 2
            for at, d in ((0.0, 0.9), (1.5, 0.5), (3.0, 0.7)):
                bus.add(t0 + at * beat, epiano([hz(x) for x in ch], d * beat * 2), 0.9, pan=0.15)
        if L >= 2:   # bass
            shift = hz(roots[0].replace("4", "2").replace("3", "2")) / hz("D2")
            for nm, at, d in bassline:
                f = hz(nm) * shift
                x = lp(saw(f, d * beat * 2, 900, (0.0,)), 800) + sub(f, d * beat * 2) * 0.6
                n = len(x); x *= env(n, 0.003, 4.0)
                bus.add(t0 + at * beat, x * 0.20)
            for at in (0.0, 1.75, 2.5):
                bus.add(t0 + at * beat, kick(rng, 0.3, 52, 1.0), 0.95)
            for at in (1.0, 3.0):
                bus.add(t0 + at * beat, snare(rng), 1.0)
        if L >= 2:   # swung 16th hats
            for s in range(16):
                at = s * 0.25 + (swing if s % 2 else 0.0)
                v = 0.9 if s % 4 == 0 else 0.55 if s % 2 == 0 else 0.4
                if L < 3 and s % 2:
                    continue
                bus.add(t0 + at * beat, hat(rng), v, pan=0.25)
        if L >= 4:   # open hat lift on the 'and' of 4
            bus.add(t0 + 3.5 * beat, hat(rng, True), 0.8, pan=-0.2)
        b += 1
    for a in accents:   # the landing: kick + a bright e-piano hit
        bus.add(a, kick(rng, 0.3, 50, 1.2), 1.1)
        bus.add(a, epiano([hz("A5"), hz("D6")], 0.5), 0.9)


def _synthwave(bus, total, bpm, lvl, accents):
    beat = 60 / bpm
    rng = bus.rng
    prog = [("B2", ["B3", "D4", "F#4"]), ("G2", ["G3", "B3", "D4"]), ("D3", ["D4", "F#4", "A4"]), ("A2", ["A3", "C#4", "E4"])]
    bar_len = beat * 4
    b = 0
    while b * bar_len < total:
        t0 = b * bar_len
        L = lvl(t0)
        root, ch = prog[b % 4]
        # pad, pumping against the kick (a sidechain feel built into the envelope)
        d = bar_len
        n = int(d * SR); tt = np.arange(n) / SR
        pad = sum(saw(hz(x), d, 1600) for x in ch) / 3
        pump = 1 - 0.7 * np.exp(-((tt % beat) / beat) * 6) if L >= 2 else np.ones(n)
        bus.add(t0, pad * pump * 0.13, pan=0.0)
        if L >= 1:   # 16th arpeggiator with a dotted delay
            arp = ch + [ch[1].replace("3", "4").replace("4", "5")]
            for s in range(16):
                f = hz(arp[s % len(arp)]) * (2 if s % 8 >= 6 else 1)
                x = saw(f, beat * 0.22, 3200, (0.0, 0.004)) * env(int(beat * 0.22 * SR), 0.002, 14)
                at = t0 + s * beat / 4
                bus.add(at, x * 0.09, pan=-0.25)
                bus.add(at + beat * 0.75, x * 0.035, pan=0.35)   # delay tap
        if L >= 2:
            for k in range(4):
                bus.add(t0 + k * beat, kick(rng, 0.3, 48, 1.0), 1.0)
                bus.add(t0 + (k + 0.5) * beat, hat(rng, True), 0.55, pan=0.2)
            f = hz(root)
            for s in range(8):   # octave bass on eighths
                x = lp(saw(f * (2 if s % 2 else 1), beat * 0.45, 700, (0.0,)), 600) * env(int(beat * 0.45 * SR), 0.003, 6)
                bus.add(t0 + s * beat / 2, x * 0.22)
        if L >= 3:   # gated snare on 2 and 4
            for k in (1, 3):
                bus.add(t0 + k * beat, snare(rng, 0.18, 220, 1.0), 1.0)
        if L >= 4 and b % 2 == 1:
            bus.add(t0 + bar_len - beat * 2, riser(rng, beat * 2), 1.0)
        b += 1
    for a in accents:
        bus.add(a, kick(rng, 0.35, 46, 1.2), 0.9)


def _procession(bus, total, bpm, lvl, accents):
    """A walking march for the classroom video (המירוץ לציון, 2026-10-04): low toms in a
    pilgrim's stride, a frame drum, a low string ostinato, a lyre like pluck melody in
    D Phrygian dominant (an old, Levantine colour), and brass like swells at the top."""
    beat = 60 / bpm
    rng = bus.rng
    bar_len = beat * 4
    # D  Eb  F#  G  A  Bb  C : the "Ahava Rabba" mode, the sound of somewhere old
    melody = ["D4", "F#4", "G4", "A4", "G4", "F#4", "D#4", "D4",
              "A3", "D4", "F#4", "A4", "C5", "A4", "G4", "F#4"]
    roots = ["D2", "D2", "C2", "D2"]
    b = 0
    while b * bar_len < total:
        t0 = b * bar_len
        L = lvl(t0)
        root = hz(roots[b % 4])
        # low string drone + fifth, always (quiet at level 0)
        d = bar_len
        x = lp(saw(root * 2, d, 700), 600) * 0.5 + sub(root, d) * 0.5 + lp(saw(root * 3, d, 900), 800) * 0.15
        n = len(x); e = np.minimum(1, np.arange(n) / (0.25 * SR)) * np.minimum(1, (n - np.arange(n)) / (0.2 * SR))
        bus.add(t0, x * e * (0.10 if L == 0 else 0.16))
        if L >= 1:   # the stride: two low toms, left foot right foot, plus a ghost
            for at, p, g in ((0.0, 62, 1.0), (1.0, 55, 0.8), (2.0, 62, 1.0), (3.0, 55, 0.8), (3.5, 70, 0.35)):
                bus.add(t0 + at * beat, kick(rng, 0.45, p, 0.9), g * 0.9, pan=-0.15 if at % 2 else 0.15)
        if L >= 2:   # frame drum slaps on the off beats + string ostinato on eighths
            for at in (0.5, 1.5, 2.5, 3.5):
                bus.add(t0 + at * beat, snare(rng, 0.12, 320, 0.6), 0.45, pan=0.3)
            for s in range(8):
                f = root * (2 if s % 2 == 0 else 3)
                y = lp(saw(f, beat * 0.42, 1200, (0.0, 0.005)), 1000) * env(int(beat * 0.42 * SR), 0.004, 7)
                bus.add(t0 + s * beat / 2, y * 0.10, pan=-0.2)
        if L >= 2:   # the lyre melody, one note per beat, two bars per phrase
            for k in range(4):
                nm = melody[(b % 4) * 4 + k]
                bus.add(t0 + k * beat, pluck(hz(nm), beat * 1.2, 0.996, rng), 0.75, pan=0.25)
        if L >= 3:   # brass like swell: detuned saws, slow attack, on the bar
            ch = [root * 4, root * 4 * 1.5, root * 8]
            sw = sum(lp(saw(f, bar_len, 1400), 1300) for f in ch) / 3
            nn = len(sw); ee = np.minimum(1, np.arange(nn) / (0.9 * SR)) * np.minimum(1, (nn - np.arange(nn)) / (0.3 * SR))
            bus.add(t0, sw * ee * 0.09)
            bus.add(t0 + 2 * beat, kick(rng, 0.6, 45, 1.1), 0.7)
        if L >= 4 and b % 2 == 1:
            bus.add(t0 + bar_len - beat * 2, riser(rng, beat * 2), 0.9)
        b += 1
    for a in accents:   # a big tom + low string hit on every reveal
        bus.add(a, kick(rng, 0.8, 50, 1.3), 1.1)
        bus.add(a, lp(saw(hz("D3"), 1.2, 900), 800) * env(int(1.2 * SR), 0.005, 3) * 0.3)


def _pad(freqs, dur, cut=1800, att=0.6, rel=0.6):
    x = sum(lp(saw(f, dur, cut, (-0.004, 0.0, 0.005)), cut) for f in freqs) / max(len(freqs), 1)
    n = len(x); i = np.arange(n)
    return x * np.minimum(1, i / (att * SR)) * np.minimum(1, (n - i) / (rel * SR))


def _crackle(rng, dur):
    n = int(dur * SR)
    x = np.zeros(n)
    k = rng.integers(0, n, max(1, int(dur * 9)))
    x[k] = rng.normal(0, 1, len(k))
    return hp(lp(x, 6000), 1500) * 0.6


def _pulse(bus, total, bpm, lvl, accents):
    """Reel 14 'this phone' (2026-10-05). Two halves that mirror the script: level 0..1 is
    a dark heartbeat (sub thump, a ticking click, minor pad); from level 2 it opens into a
    bright four on the floor with a rising major pluck arpeggio and claps."""
    beat = 60 / bpm; rng = bus.rng; bar = beat * 4
    dark = [["A2", "C3", "E3"], ["F2", "A2", "C3"]]
    bright = [["A2", "C#3", "E3", "A3"], ["F#2", "A2", "C#3", "F#3"], ["D2", "F#2", "A2", "D3"], ["E2", "G#2", "B2", "E3"]]
    b = 0
    while b * bar < total:
        t0 = b * bar; L = lvl(t0)
        if L <= 1:
            ch = [hz(n) for n in dark[b % 2]]
            bus.add(t0, _pad([f * 2 for f in ch], bar, 900, 0.8, 0.5), 0.10)
            for k in range(4):   # lub dub
                bus.add(t0 + k * beat, kick(rng, 0.25, 42, 0.5), 0.55)
                bus.add(t0 + k * beat + 0.18, kick(rng, 0.2, 40, 0.3), 0.3)
                if L >= 1:
                    bus.add(t0 + k * beat + beat / 2, hat(rng) * 0.6, 0.6, pan=0.4)
        else:
            ch = [hz(n) for n in bright[b % 4]]
            bus.add(t0, _pad([f * 2 for f in ch], bar, 2600, 0.05, 0.3), 0.07)
            for k in range(4):
                bus.add(t0 + k * beat, kick(rng, 0.3, 52, 1.0), 0.8)
                bus.add(t0 + k * beat + beat / 2, hat(rng), 0.8, pan=0.3)
            if L >= 3:
                for k in (1, 3):
                    bus.add(t0 + k * beat, snare(rng, 0.18, 240, 1.0), 0.6)
            for s in range(8):   # rising arpeggio
                f = ch[s % 4] * (4 if s < 4 else 8)
                bus.add(t0 + s * beat / 2, pluck(f, beat * 0.8, 0.994, rng), 0.5, pan=-0.3 + 0.08 * s)
            bus.add(t0, sub(ch[0], beat * 3.5) * env(int(beat * 3.5 * SR), 0.01, 1.2) * 0.25)
        b += 1
    for a in accents:
        bus.add(a, kick(rng, 0.6, 46, 1.2), 1.0)
        bus.add(max(a - beat * 2, 0), riser(rng, beat * 2), 0.8)


def _lofi(bus, total, bpm, lvl, accents):
    """Reel 15, the 100 shekel bet in the park (2026-10-05). Lo fi hip hop under dialogue:
    lazy swung kick and rim, warm maj7 e-piano, round bass, vinyl crackle, and at level 3+
    a soft clock tick on every eighth for the 60 second countdown."""
    beat = 60 / bpm; rng = bus.rng; bar = beat * 4
    prog = [["F3", "A3", "C4", "E4"], ["E3", "G3", "B3", "D4"], ["D3", "F3", "A3", "C4"], ["C3", "E3", "G3", "B3"]]
    sw = beat * 0.58
    b = 0
    while b * bar < total:
        t0 = b * bar; L = lvl(t0)
        ch = [hz(n) for n in prog[b % 4]]
        bus.add(t0, _crackle(rng, bar), 0.5)
        bus.add(t0, lp(epiano(ch, bar * 0.95), 2500), 0.9, pan=-0.1)
        if L >= 1:
            bus.add(t0, lp(sub(ch[0] / 2, beat * 1.6), 300) * env(int(beat * 1.6 * SR), 0.01, 1.5) * 0.35)
            bus.add(t0 + 2.5 * beat, lp(sub(ch[0] / 2, beat), 300) * env(int(beat * SR), 0.01, 2.5) * 0.3)
        if L >= 2:
            for at in (0.0, 1.5 + 0.08, 2.5):
                bus.add(t0 + at * beat, lp(kick(rng, 0.3, 50, 0.8), 2000), 0.7)
            for k in (1, 3):
                bus.add(t0 + k * beat + 0.02, lp(snare(rng, 0.16, 330, 0.3), 3500), 0.55)
            for k in range(4):
                bus.add(t0 + k * beat, hat(rng) * 0.7, 0.5, pan=0.35)
                bus.add(t0 + k * beat + sw, hat(rng) * 0.5, 0.4, pan=0.35)
        if L >= 3:   # the clock
            for s in range(8):
                n = int(0.03 * SR); t = np.arange(n) / SR
                tick = np.sin(2 * np.pi * (2400 if s % 2 == 0 else 1900) * t) * np.exp(-t * 160)
                bus.add(t0 + s * beat / 2, tick * 0.12, pan=0.5)
        b += 1
    for a in accents:
        bus.add(a, lp(epiano([hz("F4"), hz("A4"), hz("C5"), hz("E5")], 2.0), 3000), 1.0)


def _briefing(bus, total, bpm, lvl, accents):
    """The race opening (in app) briefing, 2026-10-05. Calm and clear under a long talk:
    a soft piano arpeggio, a warm pad, light shaker; level 2 adds a gentle low drum, level 3
    a fuller kit for the last lines. Nothing sharp in the voice band."""
    beat = 60 / bpm; rng = bus.rng; bar = beat * 4
    prog = [["C3", "G3", "E4"], ["A2", "E3", "C4"], ["F2", "C3", "A3"], ["G2", "D3", "B3"]]
    b = 0
    while b * bar < total:
        t0 = b * bar; L = lvl(t0)
        ch = [hz(n) for n in prog[b % 4]]
        bus.add(t0, _pad(ch, bar, 1200, 0.7, 0.7), 0.08)
        for s in range(8):   # piano like pluck arpeggio, low passed out of the voice band
            f = ch[s % 3] * (2 if s < 6 else 4)
            bus.add(t0 + s * beat / 2, lp(pluck(f, beat * 1.5, 0.997, rng), 1800), 0.45, pan=-0.25 + 0.07 * s)
        if L >= 1:
            for s in range(8):
                n = int(0.06 * SR); t = np.arange(n) / SR
                sh = hp(rng.normal(0, 1, n), 6000) * np.exp(-t * 60) * (0.05 if s % 2 else 0.03)
                bus.add(t0 + s * beat / 2, sh, pan=0.4)
        if L >= 2:
            bus.add(t0, kick(rng, 0.5, 48, 0.6), 0.55)
            bus.add(t0 + 2.5 * beat, kick(rng, 0.4, 48, 0.5), 0.4)
        if L >= 3:
            for k in (1, 3):
                bus.add(t0 + k * beat, lp(snare(rng, 0.2, 200, 0.4), 4000), 0.4)
        b += 1
    for a in accents:
        bus.add(a, lp(pluck(hz("C5"), 1.5, 0.997, rng), 2500), 0.8)


def _kickoff(bus, total, bpm, lvl, accents):
    """The race opening, second pass (2026-10-13: "I want it more energetic"). A sports briefing
    bed: four on the floor, an octave bouncing bass, off beat hats; level 2 adds claps and
    syncopated major stabs, level 3 a rising arpeggio and open hats. Stabs are low passed so
    nothing sharp sits in the voice band."""
    beat = 60 / bpm; rng = bus.rng; bar = beat * 4
    prog = [["D2", "F#3", "A3", "D4"], ["B1", "F#3", "B3", "D4"], ["G1", "G3", "B3", "D4"], ["A1", "E3", "A3", "C#4"]]
    b = 0
    while b * bar < total:
        t0 = b * bar; L = lvl(t0)
        ch = [hz(n) for n in prog[b % 4]]
        root = ch[0]
        for k in range(4):
            bus.add(t0 + k * beat, kick(rng, 0.28, 52, 1.0), 0.85 if L >= 1 else 0.5)
            bus.add(t0 + k * beat + beat / 2, hat(rng), 0.7, pan=0.3)
            if L >= 1:   # octave bounce: root on the beat, octave on the off beat
                n = int(beat * 0.45 * SR)
                bus.add(t0 + k * beat, lp(saw(root * 2, beat * 0.45, 700), 500) * env(n, 0.005, 6) * 0.30)
                bus.add(t0 + k * beat + beat / 2, lp(saw(root * 4, beat * 0.45, 900), 700) * env(n, 0.005, 8) * 0.22)
        bus.add(t0, _pad(ch[1:], bar, 1500, 0.1, 0.4), 0.05)
        if L >= 2:
            for k in (1, 3):
                bus.add(t0 + k * beat, snare(rng, 0.16, 230, 1.0), 0.55)
            for st in (0, 1.5, 2.5, 3.5):   # syncopated stabs
                for f in ch[1:]:
                    bus.add(t0 + st * beat, lp(pluck(f * 2, beat * 0.6, 0.992, rng), 2600), 0.26, pan=-0.2)
        if L >= 3:
            for s_ in range(8):
                f = ch[1 + s_ % 3] * (4 if s_ < 4 else 8)
                bus.add(t0 + s_ * beat / 2 + beat / 4, lp(pluck(f, beat * 0.5, 0.99, rng), 3200), 0.3, pan=0.35 - 0.08 * s_)
            bus.add(t0 + 3.5 * beat, hat(rng, True), 0.7, pan=0.3)
        if b % 4 == 3:   # a small fill into the next four bars
            for q in (3.0, 3.25, 3.5, 3.75):
                bus.add(t0 + q * beat, snare(rng, 0.1, 260, 1.0), 0.35)
        b += 1
    for a in accents:
        bus.add(a, kick(rng, 0.6, 46, 1.2), 1.0)
        bus.add(max(a - beat * 2, 0), riser(rng, beat * 2), 0.7)


def _heartdrop(bus, total, bpm, lvl, accents):
    """Reel 16, the button (2026-10-13): a heartbeat that turns into a half time drop. Level 0 is
    only the double thump of a pulse (the hesitation before the press); level 1 adds a sliding
    sub and eighth hats; level 2 a clap on three and a minor bell motif; level 3 hat rolls and
    the motif an octave up. Bells are low passed so nothing sharp sits in the voice band."""
    beat = 60 / bpm; rng = bus.rng; bar = beat * 4
    prog = [["F1", "F3", "G#3", "C4"], ["C#1", "F3", "G#3", "C#4"], ["D#1", "G3", "A#3", "D#4"], ["C1", "E3", "G3", "C4"]]
    motif = [0, 2, 1, 2, 0, 1, 2, 1]
    b = 0
    while b * bar < total:
        t0 = b * bar; L = lvl(t0)
        ch = [hz(n) for n in prog[b % 4]]
        root = ch[0]
        if L < 1:
            for k in (0, 2):   # lub dub, twice a bar
                bus.add(t0 + k * beat, kick(rng, 0.34, 44, 0.7), 0.75)
                bus.add(t0 + k * beat + beat * 0.42, kick(rng, 0.26, 40, 0.5), 0.5)
            b += 1
            continue
        bus.add(t0, kick(rng, 0.5, 48, 1.2), 1.0)
        bus.add(t0 + 1.5 * beat, kick(rng, 0.3, 48, 0.9), 0.7)
        bus.add(t0 + 2.5 * beat, kick(rng, 0.3, 48, 0.9), 0.75)
        n = int(bar * 0.9 * SR)
        bus.add(t0, sub(root * 2, bar * 0.9) * env(n, 0.01, 1.6), 0.55)
        for k in range(8):
            bus.add(t0 + k * beat / 2, hat(rng), 0.5 if k % 2 else 0.32, pan=0.25)
        bus.add(t0, _pad(ch[1:], bar, 1300, 0.2, 0.5), 0.045)
        if L >= 2:
            bus.add(t0 + 2 * beat, snare(rng, 0.2, 210, 1.1), 0.7)
            for s_, m in enumerate(motif):
                bus.add(t0 + s_ * beat / 2, lp(pluck(ch[1 + m] * 2, beat * 0.7, 0.994, rng), 2400), 0.3, pan=-0.25 + 0.07 * s_)
        if L >= 3:
            for q in (3.0, 3.125, 3.25, 3.375, 3.5, 3.667, 3.833):
                bus.add(t0 + q * beat, hat(rng), 0.42, pan=-0.3)
            for s_, m in enumerate(motif):
                if s_ % 2 == 0:
                    bus.add(t0 + s_ * beat / 2 + beat / 4, lp(pluck(ch[1 + m] * 4, beat * 0.5, 0.99, rng), 3000), 0.2, pan=0.3)
            bus.add(t0 + 3.5 * beat, hat(rng, True), 0.55, pan=0.3)
        b += 1
    for a in accents:
        bus.add(a, kick(rng, 0.7, 42, 1.3), 1.0)
        bus.add(a, sub(hz("F1") * 2, 0.9) * env(int(0.9 * SR), 0.005, 3.0), 0.7)


STYLES = {"suspense": _suspense, "funk": _funk, "synthwave": _synthwave, "procession": _procession,
          "pulse": _pulse, "lofi": _lofi, "briefing": _briefing, "kickoff": _kickoff, "heartdrop": _heartdrop,
          # older names kept so an existing timeline still renders
          "tension": _suspense, "drive": _funk, "hype": _synthwave}


def make_music(out, total: float, style: str = "funk", bpm: float = 100.0, energy=None,
               accents=(), drops=(), seed: int = 20261001) -> str:
    bus = Bus(total, seed)
    energy = sorted(energy or [(0, 2)])

    def lvl(t):
        v = energy[0][1]
        for a, l in energy:
            if t >= a - 1e-9:
                v = l
        return v

    STYLES[style](bus, total, bpm, lvl, list(accents))
    x = np.stack([bus.L, bus.R])
    for a, b in drops:
        i, j = int(a * SR), int(b * SR)
        f = min(int(0.03 * SR), max(j - i, 1))
        x[:, i:j] = 0
        if i - f > 0:
            x[:, i - f:i] *= np.linspace(1, 0, f)
    x = hp(x, 35)
    x = np.tanh(x * 1.1) * 0.95
    f = int(0.04 * SR)
    x[:, -f:] *= np.linspace(1, 0, f)
    x = x / max(np.abs(x).max(), 1e-9) * 0.89
    sf.write(str(out), x.T, SR, subtype="PCM_24")
    return str(out)
