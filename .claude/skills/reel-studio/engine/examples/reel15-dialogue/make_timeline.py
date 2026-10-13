# -*- coding: utf-8 -*-
"""Reel 15, "ההימור של מאתיים שקל" (9:16, ~73 s), filmed at the Ramot mall. timeline.json from the assembled take.

    python assemble.py          (13 clips → clips/take.mp4 + voice/take.wav + measured.json + captions.json)
    cd .claude/skills/reel-studio/engine
    python "%USERPROFILE%/Desktop/RushPoint-reels-work/reel15-bet/make_timeline.py"
    python build.py reel15-bet --opening A

Ahiya on v1: the cuts were "very very very" visible, and he walks in/out and turns to the camera
at the clip edges. So every join is COVERED, never shown:
  - "punch:A" / "punch:N": a close framing of whoever is speaking, cut from the SAME moment of the
    take (lip sync intact). Wide → close → wide reads as a second camera, not as a cut;
  - "app:<clip>": the app itself while he describes it (map pin, navigation, a mission opening,
    the score, the route map of Jerusalem);
  - "card60": the minute starting.
The sound is ONE continuous file (voice/take.wav) under every picture, so cuts in the picture never
touch the audio. The countdown is per second PNG overlays, so it stays on top of the inserts too.
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

RD = Path(__file__).resolve().parent
sys.path.insert(0, str(RD.parent))
import _portrait as P  # noqa: E402

G = RD / "graphics"
M = json.loads((RD / "measured.json").read_text(encoding="utf-8"))
OPEN = RD.parent / "race-opening" / "clips"
R14 = RD.parent / "reel14-phone" / "clips"

# close framings inside the 1080x1920 frame (he stands right, the teen left; heads in the upper half)
CROP = {"A": [430, 380, 650, 1156], "N": [0, 400, 620, 1102]}
# what covers each join (join k = between segment k and k+1), and how far it reaches either side
COVER = [
    ("punch:N", 0.0, 1.3),             # "מה כאילו" → "אין בעיה"
    ("punch:A", 0.0, 1.6),             # "לא." → "בוא נעשה הסכם"
    ("card60", 0.20, 0.75),              # the minute starts: "בן כמה אתה?"
    ("punch:A", 0.0, 1.7),             # → "בניתי לכם אפליקציה"
    ("app:nav", 0.30, 1.90),             # → "מתחלקים... מנווט"
    ("punch:N", 0.0, 1.4),             # → "בכל נקודה נפתחת משימה" (the teen listening)
    ("punch:A", 0.0, 1.6),             # → "לדוגמה, למכור שמפו"
    ("punch:N", 0.0, 1.3),             # → "היית עושה את זה? כן!"
    ("app:score", 0.30, 1.90),           # → "הפלאפון סופר את הנקודות"
    ("app:map", 0.30, 2.20),             # → "בניתי משחק כזה בירושלים"
    ("punch:N", 0.0, 1.3),             # "וואי זה נשמע מטורף" → "נו, אז מה אתה אומר"
    ("punch:A", 0.0, 1.8),             # → "יאללה, אז את ה 200 שקל"
]


def num_png(n: int) -> str:
    """Big and impossible to miss: a fire red pill, white digits, the stake under it."""
    hot = n <= 10
    css = f""".p{{position:absolute;left:50%;transform:translateX(-50%);top:266px;width:400px;height:196px;
      background:{"#DC2626" if hot else P.FIRE};border:7px solid #fff;border-radius:999px;display:flex;align-items:center;
      justify-content:center;gap:16px;box-shadow:0 12px 40px rgba(0,0,0,.45);font:900 150px/1 'Rubik';color:#fff;direction:ltr;}}
      .k{{position:absolute;left:0;right:0;top:470px;text-align:center;font:800 42px 'Rubik';color:#fff;direction:rtl;
      text-shadow:0 3px 14px rgba(0,0,0,.8);}}"""
    return P.png(G, f"t{n:02d}", f'<div class="p">{n}</div><div class="k">200 שקל על הקו</div>', css)


def card60() -> str:
    css = f"""body{{background:radial-gradient(circle at 50% 42%,#2a2521,{P.DARK} 72%);}}
      .c{{position:absolute;left:0;right:0;top:620px;text-align:center;}}
      .n{{font:900 330px/1 'Rubik';color:{P.FIRE};}} .s{{margin-top:10px;font:800 70px 'Rubik';color:#fff;direction:rtl;}}"""
    return P.png(G, "card60", '<div class="c"><div class="n">60</div><div class="s">שניות. מתחיל.</div></div>', css, P.DARK)


def app_clip(kind: str, secs: float) -> tuple[str, float, float]:
    """(clip, in, speed) for an app insert of `secs` seconds."""
    if kind == "builder":
        return "clips/builder.mp4", 22.0, round(4.0 / secs, 4)
    if kind == "map":
        return "clips/map_v.mp4", 0.6, round(7.0 / secs, 4)
    return f"clips/scr_{kind}.mp4", 0.0, 1.0


def main():
    for src, dst in ((R14 / "builder.mp4", "builder.mp4"), (OPEN / "map_v.mp4", "map_v.mp4")):
        if not (RD / "clips" / dst).exists():
            shutil.copy(src, RD / "clips" / dst)
    raw_a_cls = RD.parent / "race-classroom" / "clips" / "raw_a.mp4"
    blur = [(40, 194, 332, 76)]
    t_end = float(M["take_end"])
    ins = [(round(j - before, 3), round(j + after, 3), kind) for j, (kind, before, after) in zip(M["joins"], COVER)]
    for a, b, kind in ins:
        k = kind.split(":")[-1]
        if kind.startswith("app:") and k in ("nav", "arrive", "score"):
            src_t = {"nav": (8.0, 30.0), "arrive": (59.8, 8.0), "score": (102.6, 2.6)}[k]
            P.phone_shot(RD, f"scr_{k}", raw_a_cls, src_t[0], b - a, src_t[1] / (b - a), blur if k != "nav" else None)
    c60 = card60()

    shots: list[dict] = []
    t = 0.0

    def take(a, b, crop=None):
        s = {"id": f"take_{len(shots)}", "start": round(a, 3), "end": round(b, 3), "clip": "clips/take.mp4", "in": round(a, 3),
             "effect": "none", "cut": True}
        if crop:
            s["crop"] = crop
        shots.append(s)

    for a, b, kind in ins:
        if a > t:
            take(t, a)
        if kind.startswith("punch:"):
            take(a, b, CROP[kind[-1]])
        elif kind == "card60":
            shots.append({"id": f"card_{len(shots)}", "start": a, "end": b, "graphic": c60, "effect": "none", "cut": True})
        else:
            clip, cin, sp = app_clip(kind[4:], b - a)
            shots.append({"id": f"app_{len(shots)}", "start": a, "end": b, "clip": clip, "in": cin, "speed": sp,
                          "effect": "none", "cut": True})
        t = b
    if t < t_end:
        take(t, t_end)

    caps = json.loads((RD / "captions.json").read_text(encoding="utf-8"))
    for c in caps:
        c["size"] = 82
        c["y"] = 1300            # below the faces; the plate must end above y 1420 (QA)
        c["style"] = "box"
    t0, stop = float(M["timer_start"]), float(M["timer_stop"])
    # 60 "seconds" spread over the real span, so 0 lands exactly on "מה אתה אומר על התוכנית הזאת?"
    step = (stop - t0) / 60
    ovs, ticks = [], []
    for k in range(60):
        s = t0 + k * step
        ovs.append({"png": num_png(60 - k), "start": round(s, 3), "end": round(s + step, 3), "kind": "text"})
        ticks.append({"at": round(s, 3), "file": "sfx/tick.wav", "gain": -9 if 60 - k > 10 else -4})
    ovs.append({"png": num_png(0), "start": round(stop, 3), "end": round(stop + 2.4, 3), "kind": "text"})
    left = 0
    tl = {
        "id": "reel15-bet",
        "title": "רילס 15 · ההימור של מאתיים שקל",
        "source": "13 clips of 2026-10-05, Ramot mall. assemble.py + make_timeline.py, do not hand edit.",
        "rules": ["every join covered (punch, app, card); one continuous audio file", "parent's written OK before publishing (he is 15)"],
        "shots": shots, "captions": caps, "overlays": ovs,
        "sfx": [{"at": 0.0, "file": "voice/take.wav", "gain": 0}] + ticks +
               [{"at": round(stop, 3), "file": "sfx/ding.wav", "gain": -2}],
        "voice": {}, "keep_clip_audio": 0.0, "dissolve": 0.0, "min_seconds": 60, "max_seconds": 100,
        "music": {"style": "lofi", "bpm": 84, "gain": -11, "seed": 20261015,
                  "energy": [[0, 1], [t0, 3], [stop, 2]], "accents": [round(stop, 3)]},
        "todo": [],
    }
    (RD / "timeline.json").write_text(json.dumps(tl, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"timeline: {len(shots)} shots, {t_end:.1f}s, timer stops at {left}")


if __name__ == "__main__":
    main()
