# -*- coding: utf-8 -*-
"""Four more music styles (street-200 shoot, 2026-10-16), so every reel of that shoot has its own.
Registered into music.STYLES by the import at the end of music.py.

  detective  mystery mission answers: walking upright bass, brushes, snaps, a vibraphone figure
  marimba    light and curious: pentatonic marimba ostinato, shaker, claps
  afro       warm afrobeats: syncopated kick, clave rim, log drum slides, muted guitar
  garage     fast UK two step: skippy kick, shuffled hats, organ stabs, a formant chop
"""
from __future__ import annotations

import numpy as np

from .music import SR, hz, env, lp, hp, bp, kick, snare, hat, pluck, saw, sub, riser, epiano, _pad


def _marimba_note(freq, dur):
    """A struck bar: fundamental + the 4x partial that makes a marimba, fast decay."""
    n = int(dur * SR); t = np.arange(n) / SR
    x = np.sin(2 * np.pi * freq * t) * np.exp(-t * 7) + 0.35 * np.sin(2 * np.pi * freq * 4 * t) * np.exp(-t * 28)
    return x * env(n, 0.002, 0.0) * 0.32


def _shaker(rng, dur=0.07):
    n = int(dur * SR); t = np.arange(n) / SR
    return bp(rng.normal(0, 1, n), 4000, 11000) * np.sin(np.pi * t / dur) * 0.07


def _snap(rng):
    n = int(0.06 * SR); t = np.arange(n) / SR
    return (bp(rng.normal(0, 1, n), 1800, 5000) * np.exp(-t * 70) + np.sin(2 * np.pi * 1500 * t) * np.exp(-t * 120) * 0.3) * 0.25


def _detective(bus, total, bpm, lvl, accents):
    beat = 60 / bpm; rng = bus.rng; bar = beat * 4
    walk = [["D2", "F2", "A2", "C3"], ["G1", "A#1", "D2", "F2"], ["E2", "G2", "A#2", "C#3"], ["A1", "C#2", "E2", "G2"]]
    vib = [["F4", "A4", "C5"], ["D4", "F4", "A#4"], ["E4", "G4", "A#4"], ["C#4", "E4", "A4"]]
    b = 0
    while b * bar < total:
        t0 = b * bar; L = lvl(t0)
        notes = [hz(n) for n in walk[b % 4]]
        for k, f in enumerate(notes):   # upright: a sine with a thump and a quick decay
            n = int(beat * 0.95 * SR); tt = np.arange(n) / SR
            x = (np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(4 * np.pi * f * tt)) * np.exp(-tt * 4.5)
            x += bp(rng.normal(0, 1, n), 80, 400) * np.exp(-tt * 60) * 0.3
            bus.add(t0 + k * beat, lp(x, 900) * 0.36, 1.0, pan=-0.05)
        for k in range(4):   # ride, swung
            bus.add(t0 + k * beat, hp(hat(rng, True), 5000), 0.45, pan=0.3)
            if k % 2 == 1:
                bus.add(t0 + k * beat + beat * 0.62, hat(rng), 0.35, pan=0.3)
        if L >= 1:
            for k in (1, 3):
                bus.add(t0 + k * beat, _snap(rng), 0.9, pan=-0.25)
            sw_n = int(bar * SR); tt = np.arange(sw_n) / SR   # brush swirl
            bus.add(t0, bp(rng.normal(0, 1, sw_n), 2500, 7000) * (0.4 + 0.6 * np.abs(np.sin(np.pi * tt / beat))) * 0.025, 1.0, pan=0.15)
        if L >= 2:
            for s_, f in enumerate(vib[b % 4]):
                bus.add(t0 + (0.5 + s_ * 0.75) * beat, _marimba_note(hz(f), 1.2) * 0.8, 1.0, pan=0.25)
        if L >= 3:
            bus.add(t0, lp(_pad([f * 2 for f in notes[:3]], beat * 0.5, 2200, 0.005, 0.15), 2400), 0.22)
        b += 1
    for a in accents:
        bus.add(a, _marimba_note(hz("D5"), 1.5), 1.2)
        bus.add(a, kick(rng, 0.4, 48, 0.8), 0.7)


def _marimba(bus, total, bpm, lvl, accents):
    beat = 60 / bpm; rng = bus.rng; bar = beat * 4
    prog = [["G3", "B3", "D4", "E4"], ["E3", "G3", "B3", "D4"], ["C3", "E3", "G3", "A3"], ["D3", "F#3", "A3", "B3"]]
    pat = [0, 2, 1, 3, 2, 1, 3, 2]
    b = 0
    while b * bar < total:
        t0 = b * bar; L = lvl(t0)
        ch = [hz(n) for n in prog[b % 4]]
        for s_, m in enumerate(pat):
            bus.add(t0 + s_ * beat / 2, _marimba_note(ch[m] * 2, 0.6), 0.9, pan=-0.2 + 0.05 * s_)
        for s_ in range(16):
            bus.add(t0 + s_ * beat / 4, _shaker(rng), 0.8 if s_ % 2 else 0.5, pan=0.35)
        if L >= 1:
            for k in (0, 2):
                bus.add(t0 + k * beat, kick(rng, 0.3, 55, 0.8), 0.7)
            for k in (1, 3):
                bus.add(t0 + k * beat, _snap(rng) * 1.4, 0.9)
        if L >= 2:
            for q, f in ((0, ch[0]), (1.5, ch[0]), (2.5, ch[2] / 2), (3.0, ch[1] / 2)):
                n = int(beat * 0.5 * SR)
                bus.add(t0 + q * beat, lp(sub(f / 2, beat * 0.5), 400) * env(n, 0.004, 6) * 0.4)
            for s_, m in enumerate(pat[::2]):
                bus.add(t0 + (s_ + 0.25) * beat, _marimba_note(ch[3 - m] * 4, 0.4), 0.4, pan=0.3)
        b += 1
    for a in accents:
        for i, f in enumerate(("G5", "B5", "D6")):
            bus.add(a + i * 0.06, _marimba_note(hz(f), 0.9), 0.9)


def _afro(bus, total, bpm, lvl, accents):
    beat = 60 / bpm; rng = bus.rng; bar = beat * 4
    prog = [["A2", "C#4", "E4", "A4"], ["F#2", "C#4", "F#4", "A4"], ["D2", "D4", "F#4", "A4"], ["E2", "B3", "E4", "G#4"]]
    clave = [0, 0.75, 1.5, 2.5, 3.0]
    b = 0
    while b * bar < total:
        t0 = b * bar; L = lvl(t0)
        ch = [hz(n) for n in prog[b % 4]]
        for s_ in range(16):
            bus.add(t0 + s_ * beat / 4, _shaker(rng), 0.9 if s_ % 4 == 2 else 0.55, pan=0.3)
        for q in clave:
            n = int(0.05 * SR); tt = np.arange(n) / SR
            bus.add(t0 + q * beat, np.sin(2 * np.pi * 900 * tt) * np.exp(-tt * 90) * 0.12, 1.0, pan=-0.3)
        if L >= 1:
            for q in (0, 1.5, 2.0):
                bus.add(t0 + q * beat, kick(rng, 0.3, 52, 0.9), 0.8)
            for q, mul in ((0.75, 1.0), (2.75, 1.5), (3.5, 1.33)):   # log drum: a pitched slide
                n = int(beat * 0.6 * SR); tt = np.arange(n) / SR
                f = ch[0] * mul * (1 + 0.5 * np.exp(-tt * 30))
                bus.add(t0 + q * beat, np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 7) * 0.3)
            for k in range(4):   # muted guitar on the off beats
                for f in ch[1:]:
                    bus.add(t0 + k * beat + beat / 2, lp(pluck(f, beat * 0.25, 0.97, rng), 3000), 0.28, pan=0.15)
        if L >= 2:
            bus.add(t0, _pad(ch[1:], bar, 1400, 0.3, 0.5), 0.09)
            bus.add(t0 + beat, snare(rng, 0.12, 280, 0.5), 0.3)
            bus.add(t0 + 3 * beat, snare(rng, 0.12, 280, 0.5), 0.3)
        b += 1
    for a in accents:
        bus.add(a, kick(rng, 0.5, 46, 1.2), 1.0)


def _garage(bus, total, bpm, lvl, accents):
    beat = 60 / bpm; rng = bus.rng; bar = beat * 4
    prog = [["C2", "D#3", "G3", "A#3"], ["G#1", "D#3", "G#3", "C4"], ["A#1", "D3", "F3", "A#3"], ["G1", "D3", "G3", "A#3"]]
    shuf = beat / 4 * 0.33
    b = 0
    while b * bar < total:
        t0 = b * bar; L = lvl(t0)
        ch = [hz(n) for n in prog[b % 4]]
        for s_ in range(16):
            bus.add(t0 + s_ * beat / 4 + (shuf if s_ % 2 else 0), hat(rng), 0.5 if s_ % 2 else 0.3, pan=0.3)
        if L >= 1:
            for q in (0.0, 1.75, 2.5):
                bus.add(t0 + q * beat, kick(rng, 0.26, 54, 1.0), 0.85)
                n = int(beat * 0.6 * SR)
                bus.add(t0 + q * beat, sub(ch[0] * 2, beat * 0.6) * env(n, 0.005, 5) * 0.32)
            for k in (1, 3):
                bus.add(t0 + k * beat, snare(rng, 0.18, 210, 1.0), 0.6)
        for q in (0.83, 2.33, 3.25):   # organ stabs
            bus.add(t0 + q * beat, _pad(ch[1:], beat * 0.35, 2000, 0.003, 0.08) * 1.6, 0.18, pan=-0.15)
        if L >= 2 and b % 2 == 1:
            for i, q in enumerate((2.0, 2.25, 3.0, 3.5)):   # formant chop
                n = int(beat * 0.22 * SR)
                x = bp(saw(ch[1 + i % 3] * 2, beat * 0.22, 6000), 600 + 300 * i, 1400 + 400 * i) * env(n, 0.004, 9)
                bus.add(t0 + q * beat, x * 0.35, 1.0, pan=0.2)
        b += 1
    for a in accents:
        bus.add(a, kick(rng, 0.6, 46, 1.3), 1.0)
        bus.add(max(a - beat * 2, 0), riser(rng, beat * 2), 0.6)


def _dembow(bus, total, bpm, lvl, accents):
    """The booth at the market: a dembow groove (kick on every beat, the snare on the 'and' of 1 and 3,
    i.e. the boom ch boom chick), a plucked minor riff and a sub on the root; level 2 adds a rim roll
    and a high answer to the riff."""
    beat = 60 / bpm; rng = bus.rng; bar = beat * 4
    prog = [["A1", "A3", "C4", "E4"], ["F1", "F3", "A3", "C4"], ["C2", "G3", "C4", "E4"], ["G1", "G3", "B3", "D4"]]
    riff = [0, 2, 1, 2, 0, 1, 2, 1]
    b = 0
    while b * bar < total:
        t0 = b * bar; L = lvl(t0)
        ch = [hz(n) for n in prog[b % 4]]
        for k in range(4):
            bus.add(t0 + k * beat, kick(rng, 0.24, 56, 0.9), 0.8 if L >= 1 else 0.5)
            bus.add(t0 + k * beat + beat / 2, hat(rng), 0.45, pan=0.3)
        for q in (0.75, 1.5, 2.75, 3.5):   # the dembow snare
            bus.add(t0 + q * beat, snare(rng, 0.12, 260, 0.8), 0.45 if L >= 1 else 0.25)
        if L >= 1:
            n = int(bar * 0.95 * SR)
            bus.add(t0, lp(sub(ch[0] * 2, bar * 0.95), 250) * env(n, 0.01, 1.2) * 0.32)
        for s_, m in enumerate(riff):
            bus.add(t0 + s_ * beat / 2, lp(pluck(ch[1 + m], beat * 0.45, 0.993, rng), 2600), 0.34, pan=-0.2)
        if L >= 2:
            for q in (3.0, 3.125, 3.25, 3.375):
                n = int(0.04 * SR); tt = np.arange(n) / SR
                bus.add(t0 + q * beat, np.sin(2 * np.pi * 1100 * tt) * np.exp(-tt * 80) * 0.1, 1.0, pan=0.35)
            for s_, m in enumerate(riff[::2]):
                bus.add(t0 + (s_ + 0.5) * beat, lp(pluck(ch[3 - m] * 2, beat * 0.4, 0.99, rng), 3000), 0.22, pan=0.3)
        b += 1
    for a in accents:
        bus.add(a, kick(rng, 0.5, 46, 1.2), 1.0)


def _violin(freq, dur, rng):
    """A bowed note: a slow swell, vibrato that arrives late, a bright saw through a soft low pass."""
    n = int(dur * SR); t = np.arange(n) / SR
    vib = 1 + 0.006 * np.sin(2 * np.pi * 5.4 * t) * np.clip((t - 0.25) / 0.4, 0, 1)
    ph = np.cumsum(freq * vib) / SR
    x = sum((2 * ((ph * h) % 1.0) - 1) / h for h in (1, 2, 3)) * 0.5
    x = lp(x, 3200) + 0.02 * bp(rng.normal(0, 1, n), 2000, 6000)   # bow noise
    e = np.minimum(1, t / 0.35) * np.minimum(1, (dur - t) / 0.5)
    return x * np.clip(e, 0, 1) * 0.22


def _sadviolin(bus, total, bpm, lvl, accents):
    """The 'we lost' trope (Ahiya, the day summary: "מוזיקה עצובה מאוד"): a slow A minor piano that
    rings, a low cello note per bar and a violin line that sighs downward. No drums."""
    beat = 60 / bpm; rng = bus.rng; bar = beat * 4
    prog = [["A2", "C4", "E4", "A4"], ["F2", "A3", "C4", "F4"], ["D2", "F3", "A3", "D4"], ["E2", "G#3", "B3", "E4"]]
    melody = [["E5", "D5"], ["C5", "A4"], ["D5", "C5"], ["B4", "G#4"]]
    b = 0
    while b * bar < total:
        t0 = b * bar
        ch = [hz(n) for n in prog[b % 4]]
        for s_, f in enumerate(ch[1:] + [ch[2] * 2]):   # a slow, ringing arpeggio
            n = int(bar * SR)
            bus.add(t0 + s_ * beat, epiano([f], bar) * 1.6, 0.8, pan=-0.15 + 0.1 * s_)
        bus.add(t0, _violin(ch[0], bar * 1.02, rng) * 0.9, 0.9, pan=-0.2)   # cello
        if lvl(t0) >= 1:
            m1, m2 = [hz(x) for x in melody[b % 4]]
            bus.add(t0 + 0.0, _violin(m1, beat * 2.2, rng), 1.0, pan=0.2)
            bus.add(t0 + beat * 2, _violin(m2, beat * 2.2, rng), 1.0, pan=0.2)
        b += 1
    for a in accents:
        bus.add(a, kick(rng, 0.9, 38, 0.6), 0.6)


STYLES_STREET = {"detective": _detective, "marimba": _marimba, "afro": _afro, "garage": _garage, "dembow": _dembow,
                 "sadviolin": _sadviolin}
