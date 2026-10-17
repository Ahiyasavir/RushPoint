# -*- coding: utf-8 -*-
"""The 200 compilation: timeline.json from the assembled take (run cuts.py first).

    cd .claude/skills/reel-studio/engine
    python "%USERPROFILE%/Desktop/RushPoint-reels-work/street-200/s200-compilation/make_timeline.py"
    python build.py street-200/s200-compilation --opening A

Picture: one take, every segment a different person (a natural cut), the summary alternates framings
at its joins (street.assemble). On top: the question for the whole street part, a counter that goes up
on every "200", a big minus 3,000 on the summary line. Sound: one continuous voice file, a cash register
on every "200 שקל", the garage bed.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

RD = Path(__file__).resolve().parent
sys.path.insert(0, str(RD.parent / "street-200"))
sys.path.insert(0, r"C:\Users\savir\Projects\Rushpoint\.claude\skills\reel-studio\engine")
from lib import portrait as P  # noqa: E402
import cuts as C  # noqa: E402

G = RD / "graphics"
M = json.loads((RD / "measured.json").read_text(encoding="utf-8"))
CAPS = json.loads((RD / "captions.json").read_text(encoding="utf-8"))
SHADOW = "text-shadow:0 4px 18px rgba(0,0,0,.85),0 0 3px rgba(0,0,0,.9);"


def question_png() -> str:
    css = f""".q{{position:absolute;left:70px;right:70px;top:262px;text-align:center;direction:rtl;
      font:900 74px/1.18 'Rubik';color:#fff;{SHADOW}}} .q b{{color:{P.AMBER};}}"""
    return P.png(G, "question", '<div class="q">200 שקל<br>או <b>משימה מסתורית?</b></div>', css)


def counter_png(n: int) -> str:
    css = f""".p{{position:absolute;left:50%;transform:translateX(-50%);top:270px;height:150px;padding:0 54px;
      background:{P.FIRE};border:6px solid #fff;border-radius:999px;display:flex;align-items:center;gap:26px;
      direction:rtl;box-shadow:0 12px 40px rgba(0,0,0,.45);white-space:nowrap;}}
      .t{{font:800 54px 'Rubik';color:#fff;}} .n{{font:900 104px/1 'Rubik';color:#fff;}}"""
    return P.png(G, f"count{n}", f'<div class="p"><span class="t">בחרו 200 שקל</span><span class="n">{n}</span></div>', css)


def tag_png() -> str:
    css = f""".p{{position:absolute;left:50%;transform:translateX(-50%);top:270px;padding:14px 46px;background:{P.DARK};
      border:5px solid {P.FIRE};border-radius:999px;font:900 66px 'Rubik';color:#fff;direction:rtl;white-space:nowrap;}}"""
    return P.png(G, "tag_summary", '<div class="p">סיכום יום</div>', css)


def minus_png() -> str:
    css = f""".m{{position:absolute;left:0;right:0;top:430px;text-align:center;direction:ltr;
      font:900 190px/1 'Rubik';color:#EF4444;{SHADOW}}}"""
    return P.png(G, "minus3000", '<div class="m">-3,000 ₪</div>', css)


def main():
    t_end = float(M["take_end"])
    starts = M["seg_start"] + [t_end]
    parts = [g["part"] for g in M["segs"]]
    shots = []
    for k, (a, b) in enumerate(zip(starts[:-1], starts[1:])):
        s = {"id": f"s{k:02d}", "start": round(a, 3), "end": round(b, 3), "clip": "clips/take.mp4", "in": round(a, 3),
             "effect": "zoom_in" if k == 0 else "none", "cut": True}
        shots.append(s)
    street_end = starts[parts.index("summary")]
    ovs = [{"png": question_png(), "start": 0.0, "end": round(street_end, 3), "kind": "text"}]
    # the counter: from the first "200" on, one up on every person who chose it
    hits = [c for c in CAPS if c["who"] == "P" and "200" in c["text"]]
    sfx = [{"at": 0.0, "file": "voice/take.wav", "gain": 0}, {"at": 0.0, "file": "sfx/hit.wav", "gain": -4},
           {"at": 0.0, "file": "sfx/whoosh.wav", "gain": -8}]
    for i, h in enumerate(hits):
        end = hits[i + 1]["start"] if i + 1 < len(hits) else street_end
        ovs.append({"png": counter_png(i + 1), "start": h["start"], "end": round(end, 3), "kind": "text"})
        sfx.append({"at": h["start"], "file": "sfx/register.wav", "gain": -9})
    # the question stays up until the first answer, then the counter takes its place
    ovs[0]["end"] = hits[0]["start"]
    ovs.append({"png": tag_png(), "start": round(street_end, 3), "end": round(street_end + 2.2, 3), "kind": "text"})
    minus = next(c for c in CAPS if "מינוס" in c["text"])
    ovs.append({"png": minus_png(), "start": minus["start"], "end": round(minus["end"] + 1.2, 3), "kind": "text"})
    sfx.append({"at": minus["start"], "file": "sfx/hit.wav", "gain": -5})
    for k in range(1, len(starts) - 1):
        if parts[k] != parts[k - 1]:
            sfx.append({"at": round(max(starts[k] - 0.2, 0), 3), "file": "sfx/whoosh.wav", "gain": -10})
    caps = []
    for c in CAPS:
        d = {"start": c["start"], "end": c["end"], "text": c["text"], "style": "box", "size": 84, "y": 1300}
        if c["who"] == "P":
            d["color"] = P.AMBER
        caps.append(d)
    tl = {
        "id": "s200-compilation",
        "title": "200 שקל או משימה מסתורית · כולם בחרו 200",
        "source": "street-200 shoot (WhatsApp copies of the street takes + the day summary). cuts.py + make_timeline.py, do not hand edit.",
        "rules": ["one continuous voice file", "people on the street filmed openly with a mic; minors need a parent's OK before publishing"],
        "shots": shots, "captions": caps, "overlays": ovs, "sfx": sfx,
        "voice": {}, "keep_clip_audio": 0.0, "dissolve": 0.0, "min_seconds": 20, "max_seconds": 75,
        "music": {"style": "garage", "bpm": 132, "gain": -11, "seed": 20261016,
                  "energy": [[0, 2], [hits[1]["start"] - 0.3 if len(hits) > 1 else 3, 3], [street_end, 1],
                             [next(g["t"] for g in M["segs"] if g["a"] >= 58.0 and g["src"] == C.SUM), 2]],
                  "accents": [0.0, round(street_end, 3)]},
        "todo": [],
    }
    (RD / "timeline.json").write_text(json.dumps(tl, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"timeline: {len(shots)} shots, {t_end:.1f}s, {len(hits)} people chose 200")


if __name__ == "__main__":
    main()
