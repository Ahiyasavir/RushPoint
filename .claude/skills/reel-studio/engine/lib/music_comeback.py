# -*- coding: utf-8 -*-
"""Reel 23 ("מהמיטה", 2026-10-22): a style no other reel uses.

  comeback  one bed that turns: level 0 a low pulse and a held minor pad (the hook, the bad news),
            1 a ringing A minor piano with a cello note per bar (the group message), 2 the drums
            come in under the same chords, four on the floor with a driving octave bass (he opens
            the laptop), 3 claps, open hats and a bright arpeggio (the ending). Accents are hits.

Registered into music.STYLES by the fallback in make_music.
"""
from __future__ import annotations

from .music import SR, hz, env, lp, kick, snare, hat, pluck, saw, epiano, riser, sub, _pad
from .music_street import _violin


def _comeback(bus, total, bpm, lvl, accents):
    beat = 60 / bpm; rng = bus.rng; bar = beat * 4
    prog = [["A2", "C4", "E4", "A4"], ["F2", "A3", "C4", "F4"], ["C3", "E4", "G4", "C5"], ["G2", "B3", "D4", "G4"]]
    b = 0
    while b * bar < total:
        t0 = b * bar; L = lvl(t0)
        ch = [hz(n) for n in prog[b % 4]]
        root = ch[0]
        if L == 0:
            bus.add(t0, _pad(ch[1:3], bar, 900, 0.4, 0.5), 0.5)
            for k in (0, 2):
                bus.add(t0 + k * beat, kick(rng, 0.5, 44, 0.7), 0.55)
                bus.add(t0 + k * beat + 0.22, kick(rng, 0.4, 40, 0.5), 0.35)
        if L >= 1:
            for s_, f in enumerate(ch[1:] + [ch[2] * 2]):
                bus.add(t0 + s_ * beat, epiano([f], bar) * 1.5, 0.7, pan=-0.15 + 0.1 * s_)
        if L == 1:
            bus.add(t0, _violin(root, bar * 1.02, rng) * 0.9, 0.8, pan=-0.2)
        if L >= 2:
            for k in range(4):
                bus.add(t0 + k * beat, kick(rng, 0.28, 52, 1.0), 0.85)
                bus.add(t0 + k * beat + beat / 2, hat(rng), 0.6, pan=0.3)
                n = int(beat * 0.45 * SR)
                bus.add(t0 + k * beat, lp(saw(root, beat * 0.45, 700), 500) * env(n, 0.005, 6) * 0.32)
                bus.add(t0 + k * beat + beat / 2, lp(saw(root * 2, beat * 0.45, 900), 700) * env(n, 0.005, 8) * 0.24)
            for k in (1, 3):
                bus.add(t0 + k * beat, snare(rng, 0.16, 220, 1.0), 0.62)
                bus.add(t0 + k * beat + 0.012, snare(rng, 0.12, 320, 1.2), 0.3, pan=0.2)   # a clap layer
            for q in (0, 1.5, 2.5):                                                        # an 808 that bounces
                n = int(beat * 1.2 * SR)
                bus.add(t0 + q * beat, sub(root / 2 if root > 90 else root, beat * 1.2) * env(n, 0.003, 2.5), 0.75)
            bus.add(t0, _pad(ch[1:], bar, 1600, 0.1, 0.4), 0.08)
        if L >= 3:
            for s_ in range(8):
                f = ch[1 + s_ % 3] * (2 if s_ < 4 else 4)
                bus.add(t0 + s_ * beat / 2 + beat / 4, lp(pluck(f, beat * 0.5, 0.99, rng), 3200), 0.3, pan=0.35 - 0.08 * s_)
            bus.add(t0 + 3.5 * beat, hat(rng, True), 0.7, pan=0.3)
        b += 1
    for a in accents:
        bus.add(a, kick(rng, 0.8, 42, 1.3), 1.0)
        bus.add(max(a - beat * 2, 0), riser(rng, beat * 2), 0.6)


STYLES_COMEBACK = {"comeback": _comeback}
