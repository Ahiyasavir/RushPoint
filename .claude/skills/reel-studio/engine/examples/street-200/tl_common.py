# -*- coding: utf-8 -*-
"""Shared timeline pieces for the street-200 reels: graphics in one style, captions per speaker,
the shot list over the one assembled take, and the timeline skeleton.

Every reel folder has cuts.py (-> measured.json, captions.json) and a make_timeline.py that calls
build(RD, ...). Graphics sit at the top (y 262..~470), captions on a dark plate at y 1300 (QA zone)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, r"C:\Users\savir\Projects\Rushpoint\.claude\skills\reel-studio\engine")
from lib import portrait as P  # noqa: E402

SHADOW = "text-shadow:0 4px 18px rgba(0,0,0,.85),0 0 3px rgba(0,0,0,.9);"


def load(RD: Path):
    return (json.loads((RD / "measured.json").read_text(encoding="utf-8")),
            json.loads((RD / "captions.json").read_text(encoding="utf-8")))


def question(G: Path, name: str, top: str, bottom: str) -> str:
    css = f""".q{{position:absolute;left:70px;right:70px;top:262px;text-align:center;direction:rtl;
      font:900 74px/1.18 'Rubik';color:#fff;{SHADOW}}} .q b{{color:{P.AMBER};}}"""
    return P.png(G, name, f'<div class="q">{top}<br><b>{bottom}</b></div>', css)


def pill(G: Path, name: str, text: str, color: str = P.FIRE, size: int = 62) -> str:
    css = f""".p{{position:absolute;left:50%;transform:translateX(-50%);top:270px;padding:16px 50px;background:{color};
      border:6px solid #fff;border-radius:999px;font:900 {size}px 'Rubik';color:#fff;direction:rtl;white-space:nowrap;
      box-shadow:0 12px 40px rgba(0,0,0,.45);}}"""
    return P.png(G, name, f'<div class="p">{text}</div>', css)


def big(G: Path, name: str, text: str, color: str = "#22C55E", top: int = 1030, size: int = 180) -> str:
    css = f""".m{{position:absolute;left:0;right:0;top:{top}px;text-align:center;direction:rtl;
      font:900 {size}px/1 'Rubik';color:{color};{SHADOW}}}"""
    return P.png(G, name, f'<div class="m">{text}</div>', css)


def timer_png(G: Path, n: int) -> str:
    """Rule 47: big, red under 10, the stake under it."""
    hot = n <= 10
    css = f""".p{{position:absolute;left:50%;transform:translateX(-50%);top:262px;width:340px;height:170px;
      background:{"#DC2626" if hot else P.FIRE};border:7px solid #fff;border-radius:999px;display:flex;align-items:center;
      justify-content:center;box-shadow:0 12px 40px rgba(0,0,0,.45);font:900 132px/1 'Rubik';color:#fff;direction:ltr;}}
      .k{{position:absolute;left:0;right:0;top:442px;text-align:center;font:800 44px 'Rubik';color:#fff;direction:rtl;{SHADOW}}}"""
    return P.png(G, f"t{n:02d}", f'<div class="p">{n}</div><div class="k">60 שניות לשכנע</div>', css)


def shots_over_take(M: dict, first_zoom: bool = True) -> list[dict]:
    st = M["seg_start"] + [M["take_end"]]
    return [{"id": f"s{k:02d}", "start": round(a, 3), "end": round(b, 3), "clip": "clips/take.mp4", "in": round(a, 3),
             "effect": "zoom_in" if (k == 0 and first_zoom) else "none", "cut": True}
            for k, (a, b) in enumerate(zip(st[:-1], st[1:]))]


def captions(CAPS: list[dict]) -> list[dict]:
    out = []
    for c in CAPS:
        d = {"start": c["start"], "end": c["end"], "text": c["text"], "style": "box", "size": 84, "y": 1300}
        if c["who"] == "P":
            d["color"] = P.AMBER
        out.append(d)
    return out


def cut_t(M: dict, k: int) -> float:
    """Timeline second where original cut k starts (cuts may be split into several segments)."""
    return round(next(g["t"] for g in M["segs"] if g["cut"] == k), 3)


def first(CAPS, needle, who=None, after=0.0):
    return next(c for c in CAPS if needle in c["text"] and (who is None or c["who"] == who) and c["start"] >= after)


def write(RD: Path, rid: str, title: str, shots, caps, ovs, sfx, music: dict, notes: list[str]):
    tl = {"id": rid, "title": title,
          "source": "street-200 shoot, WhatsApp copies of the street takes. cuts.py + make_timeline.py, do not hand edit.",
          "rules": ["one continuous voice file (street.assemble)", "people filmed openly with a mic; minors need a parent's OK before publishing"] + notes,
          "shots": shots, "captions": caps, "overlays": ovs,
          "sfx": [{"at": 0.0, "file": "voice/take.wav", "gain": 0}, {"at": 0.0, "file": "sfx/hit.wav", "gain": -4},
                  {"at": 0.0, "file": "sfx/whoosh.wav", "gain": -8}] + sfx,
          "voice": {}, "keep_clip_audio": 0.0, "dissolve": 0.0, "min_seconds": 15, "max_seconds": 90,
          "music": music, "todo": []}
    (RD / "timeline.json").write_text(json.dumps(tl, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{rid}: {len(shots)} shots, {shots[-1]['end']:.1f}s, {len(ovs)} overlays")
