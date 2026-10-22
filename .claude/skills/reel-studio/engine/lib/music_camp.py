# -*- coding: utf-8 -*-
"""Reel 24 (for youth movement counselors, 2026-10-22): a style no other reel uses.

  campfire  a bright singalong bed: a strummed acoustic guitar (down and up strokes), a stomp
            and claps on 2 and 4, a tambourine; G major I V vi IV. Level 0 is the guitar alone,
            1 adds the stomp, 2 the claps and tambourine, 3 a plucked lead an octave up.

Registered into music.STYLES by the fallback in make_music. Guitar strings are low passed so
nothing sharp sits in his voice band.
"""
from __future__ import annotations

import numpy as np

from .music import SR, hz, env, lp, hp, bp, kick, pluck, sub, riser, _pad


def _clap(rng):
    n = int(0.16 * SR); t = np.arange(n) / SR
    x = np.zeros(n)
    for k, d in enumerate((0.0, 0.009, 0.018)):       # a real clap is three quick slaps
        i = int(d * SR)
        x[i:] += bp(rng.normal(0, 1, n - i), 900, 5500) * np.exp(-t[:n - i] * (60 if k < 2 else 22))
    return x * 0.16


def _tamb(rng, strong=False):
    n = int(0.12 * SR); t = np.arange(n) / SR
    jingle = hp(rng.normal(0, 1, n), 6500) * np.exp(-t * (30 if strong else 55))
    return jingle * (0.10 if strong else 0.06)


def _strum(bus, t, freqs, beat, up, rng, g):
    """Strings struck one after another (low to high on a down stroke, reversed on an up stroke)."""
    order = list(freqs) if not up else list(reversed(freqs))
    spread = 0.012 if not up else 0.008
    for i, f in enumerate(order):
        s = lp(pluck(f, beat * (1.4 if not up else 0.7), 0.993, rng), 2600)
        bus.add(t + i * spread, s, g * (0.9 if not up else 0.55), pan=-0.15 + 0.06 * i)


def _campfire(bus, total, bpm, lvl, accents):
    beat = 60 / bpm; rng = bus.rng; bar = beat * 4
    prog = [["G2", "D3", "G3", "B3", "D4", "G4"], ["D2", "A2", "D3", "F#3", "A3", "D4"],
            ["E2", "B2", "E3", "G3", "B3", "E4"], ["C2", "G2", "C3", "E3", "G3", "C4"]]
    lead = [4, 5, 4, 3, 2, 3, 4, 2]
    # the strumming pattern of every campfire song: D . D U . U D U
    pattern = [(0, False), (1, False), (1.5, True), (2.5, True), (3, False), (3.5, True)]
    b = 0
    while b * bar < total:
        t0 = b * bar; L = lvl(t0)
        ch = [hz(n) for n in prog[b % 4]]
        for q, up in pattern:
            _strum(bus, t0 + q * beat, ch, beat, up, rng, 0.42)
        bus.add(t0, _pad(ch[2:5], bar, 1200, 0.3, 0.6), 0.05)
        if L >= 1:
            for k in (0, 2):
                bus.add(t0 + k * beat, kick(rng, 0.3, 55, 0.8), 0.75)
            n = int(beat * 1.8 * SR)
            bus.add(t0, sub(ch[0] * 2, beat * 1.8) * env(n, 0.01, 2.2), 0.42)
            bus.add(t0 + 2 * beat, sub(ch[1], beat * 1.8) * env(n, 0.01, 2.2), 0.38)
        if L >= 2:
            for k in (1, 3):
                bus.add(t0 + k * beat, _clap(rng), 0.85, pan=0.1)
            for k in range(8):
                bus.add(t0 + k * beat / 2, _tamb(rng, k % 2 == 1), 1.0, pan=0.35)
        if L >= 3:
            for s_, m in enumerate(lead):
                bus.add(t0 + s_ * beat / 2 + (beat / 4 if s_ % 2 else 0), lp(pluck(ch[m] * 2, beat * 0.6, 0.995, rng), 3200), 0.24, pan=-0.3)
        if b % 4 == 3 and L >= 2:                         # a little clap fill into the next four bars
            for q in (3.25, 3.5, 3.75):
                bus.add(t0 + q * beat, _clap(rng), 0.5, pan=-0.1)
        b += 1
    for a in accents:
        bus.add(a, kick(rng, 0.6, 46, 1.2), 1.0)
        bus.add(a, _clap(rng), 1.0)
        bus.add(max(a - beat * 2, 0), riser(rng, beat * 2), 0.6)


STYLES_CAMP = {"campfire": _campfire}
