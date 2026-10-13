# -*- coding: utf-8 -*-
"""Reel 14, "הטלפון הזה" (9:16, ~22 s, loops). Builds every graphic and timeline.json.

    cd .claude/skills/reel-studio/engine
    python "%USERPROFILE%/Desktop/RushPoint-reels-work/reel14-phone/make_timeline.py"
    python build.py reel14-phone --opening A

Script: docs/marketing/playbooks/reels-14-15-carousel-opening-v7-2026-10-05.md (+ shoot-plan PDF).
Until his takes arrive, each talking line is a grey placeholder of its estimated length; a take
cut to clips/<id>.mp4 + voice/<id>.wav (assemble step) replaces it and measured.json re-flows.
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
MEASURED = json.loads((RD / "measured.json").read_text(encoding="utf-8")) if (RD / "measured.json").exists() else {}

# (id, frame, line, picture)   frame: A/B/C/D = his take on camera, V = his voice over a picture
LINES = [   # the text is what he SAID in the takes of 2026-10-05 (captions follow it, rule 21)
    ("r1", "D", "רגע, אל תדלגו על זה.", "talk"),
    ("r2a", "V", "אוסטרליה אסרה רשתות חברתיות על מי שמתחת לגיל 16.", "head:0"),
    ("r2b", "V", "בריטניה, בדרך.", "head:1"),
    ("r2c", "V", "בישראל, ביסודי ובחטיבות, אסור להוציא כבר פלאפון בבתי ספר.", "head:2"),
    ("r3", "B", "כי הטלפון הזה בסוף יכול להרוס לנו את החיים, אבל...", "talk+stock:scroll_bed"),
    ("r4", "V", "אותו טלפון בדיוק יכול להפוך עיר שלמה למגרש משחקים.", "stock:city_night"),
    ("r5", "A", "בגלל זה בניתי לנו אפליקציה שיוצרת משחקים בסגנון המרוץ למיליון.", "talk"),
    ("r5b", "V", "מסמנים נקודה על המפה, ובכל אחת כזאת מחכה לכם משימה שאתם הכנתם.", "builder"),
    ("r6", "V", "הטלפון לוקח את הקבוצה ממשימה למשימה, פותח אותה כשמגיעים ומחשב לנו את הנקודות.", "screens"),
    ("r7", "D", "אז לפני שאתם חוזרים לגלול,", "talk"),
]
GAP = 0.06
# Mixkit stock (stock/LICENSES.txt), cropped to 9:16 as clips/st_*.mp4
STOCK_HEAD = ["clips/st_au_flag.mp4", "clips/st_uk_bigben.mp4", "clips/st_classroom.mp4"]


def headline(n: int, flag: str, head: str, sub: str) -> str:
    css = f"""
      .card{{position:absolute;left:70px;right:70px;top:300px;background:{P.BONE};border-radius:34px;padding:52px 56px;
      box-shadow:0 30px 80px rgba(0,0,0,.5);direction:rtl;}}
      .k{{font:800 40px 'Rubik';color:#9a3412;letter-spacing:.02em;}}
      .h{{margin-top:18px;font:900 76px/1.12 'Rubik';color:{P.DARK};}}
      .s{{margin-top:22px;font:700 40px/1.3 'Rubik';color:#57534e;}}
      .bar{{position:absolute;right:0;top:0;bottom:0;width:16px;background:{P.FIRE};border-radius:0 34px 34px 0;}}"""
    body = f'<div class="card"><div class="bar"></div><div class="k">{flag}</div><div class="h">{head}</div><div class="s">{sub}</div></div>'
    return P.png(G, f"head_{n}", body, css)


def main():
    (RD / "voice").mkdir(exist_ok=True)
    heads = [headline(1, "אוסטרליה", "רשתות חברתיות אסורות מתחת לגיל 16", "החוק הראשון מסוגו בעולם"),
             headline(2, "בריטניה", "איסור דומה כבר בדרך", "ועוד מדינות בודקות את זה"),
             headline(3, "ישראל", "אסור להוציא טלפון בבית הספר", "ביסודי ובחטיבות הביניים")]
    lg = P.logo(G)
    # real footage already in the repo: the Builder dropping a pin on the map (devlog shot 3)
    b_src = Path(r"C:\Users\savir\Projects\Rushpoint\docs\marketing\footage\devlog-hachvav-retro\shot3-builder-drag-and-map-pin.mp4")
    if not (RD / "clips" / "builder.mp4").exists():
        shutil.copy(b_src, RD / "clips" / "builder.mp4")
    raw = Path(r"C:\Users\savir\Desktop\RushPoint-reels-work\race-classroom\clips\raw_a.mp4")
    blur = [(40, 194, 332, 76)]   # mission title + description, never shown
    nav = P.phone_shot(RD, "scr_nav", raw, 20.0, 2.0, 2.5)
    opn = P.phone_shot(RD, "scr_open", raw, 60.6, 1.6, 1.0, blur)
    sco = P.phone_shot(RD, "scr_score", raw, 103.5, 1.6, 1.6, blur)

    shots, caps, ovs, sfx = [], [], [], []
    t = 0.0
    marks = {}
    for lid, frame, line, pic in LINES:
        d = float(MEASURED.get(lid, P.est(line)))
        a, b = t, t + d + GAP
        marks[lid] = (a, b)
        if frame != "V":
            P.placeholder(RD, lid, d + 0.3, f"רילס 14 · שוט {lid[1:]}", frame, line)
        else:
            if not (RD / "voice" / f"{lid}.wav").exists():
                P.silent_wav(RD / "voice" / f"{lid}.wav", d)
        if pic.startswith("talk+stock:"):
            # him first, then stock footage under the rest of his line (variety without a reshoot)
            parts = pic.split(":")[1].split(",")
            cut = a + d * 0.42
            shots.append({"id": lid, "start": round(a, 3), "end": round(cut, 3), "clip": f"clips/{lid}.mp4", "in": 0,
                          "effect": "none", "audio_gain": 0.0})
            k = (b - cut) / len(parts)
            for j, p_ in enumerate(parts):
                shots.append({"id": f"{lid}_st{j}", "start": round(cut + j * k, 3), "end": round(cut + (j + 1) * k, 3),
                              "clip": f"clips/st_{p_}.mp4", "in": 1.0, "effect": "none"})
            sfx.append({"at": round(a, 3), "file": f"voice/{lid}.wav", "gain": 0})
        elif pic.startswith("stock:"):
            parts = pic.split(":")[1].split(",")
            k = (b - a) / len(parts)
            for j, p_ in enumerate(parts):
                shots.append({"id": f"{lid}_st{j}", "start": round(a + j * k, 3), "end": round(a + (j + 1) * k, 3),
                              "clip": f"clips/st_{p_}.mp4", "in": 1.0, "effect": "none", "cut": j == 0})
            sfx.append({"at": round(a, 3), "file": f"voice/{lid}.wav", "gain": 0})
        elif pic == "talk":
            shots.append({"id": lid, "start": round(a, 3), "end": round(b, 3), "clip": f"clips/{lid}.mp4",
                          "in": 0, "effect": "zoom_in" if lid == "r1" else "none", "audio_gain": 1.0})
            if lid == "r1":   # the hook lands on a hit, the music starts ON it (Ahiya: "יותר דרמטי ותופס")
                sfx.append({"at": 0.0, "file": "sfx/hit.wav", "gain": 0})
                sfx.append({"at": 0.0, "file": "sfx/whoosh.wav", "gain": -6})
        elif pic == "talk+builder":
            cut = a + d * 0.55   # TODO: the word time of "מסמנים" once the take is transcribed
            shots.append({"id": lid, "start": round(a, 3), "end": round(cut, 3), "clip": f"clips/{lid}.mp4",
                          "in": 0, "effect": "none", "audio_gain": 0.0})
            shots.append({"id": lid + "_map", "start": round(cut, 3), "end": round(b, 3), "clip": "clips/builder.mp4",
                          "in": 22.5, "effect": "none"})
            sfx.append({"at": round(a, 3), "file": f"voice/{lid}.wav", "gain": 0})
        elif pic.startswith("head:"):
            i = int(pic[5:])
            shots.append({"id": lid, "start": round(a, 3), "end": round(b, 3), "clip": STOCK_HEAD[i], "in": 0.5, "effect": "none", "cut": True})
            ovs.append({"png": heads[i], "start": round(a + 0.1, 3), "end": round(b, 3), "kind": "text"})
            sfx.append({"at": round(a, 3), "file": "sfx/pop.wav", "gain": -8})
            sfx.append({"at": round(a, 3), "file": f"voice/{lid}.wav", "gain": 0})
        elif pic == "builder":
            shots.append({"id": lid, "start": round(a, 3), "end": round(b, 3), "clip": "clips/builder.mp4",
                          "in": 21.0, "speed": round(6.0 / (b - a), 4), "effect": "none"})
            sfx.append({"at": round(a, 3), "file": f"voice/{lid}.wav", "gain": 0})
        elif pic == "screens":
            k = (b - a) / 3
            for i, c in enumerate((nav, opn, sco)):
                shots.append({"id": f"{lid}_{i}", "start": round(a + i * k, 3), "end": round(a + (i + 1) * k, 3),
                              "clip": c, "in": 0, "effect": "none"})
            sfx.append({"at": round(a, 3), "file": f"voice/{lid}.wav", "gain": 0})
        y = 1300 if pic in ("screens",) else None
        cap = {"start": round(a + 0.04, 3), "end": round(a + d, 3), "text": line, "style": "sub", "size": 84}
        if y:
            cap["y"] = y
            cap["style"] = "box"     # a dark plate where the line sits over the phone's lower edge
        caps.append(cap)
        t = b
    total = t
    # r1 is the hook word: big, centred, on top of the phone coming up to the lens
    ovs.append({"png": P.title_mid(G, "hook", "אל תדלגו על זה", 255, 112), "start": 0.0, "end": round(marks["r1"][1], 3), "kind": "text"})
    turn = marks["r4"][0]
    tl = {
        "id": "reel14-phone",
        "title": "רילס 14 · הטלפון הזה",
        "source": "docs/marketing/playbooks/reels-14-15-carousel-opening-v7-2026-10-05.md. Built by make_timeline.py, do not hand edit.",
        "rules": ["takes of 2026-10-05: bushes (r1, r2 lines), balcony (r3..r7); reshoot asked for r1/r7 loop + street for r4/r5", "no dates (founder rule 36)", "open on facts, not on 'bad' (37)", "loop: r7 is cut mid sentence, last frame = first frame"],
        "shots": shots, "captions": caps, "overlays": ovs, "sfx": sfx, "voice": {},
        "keep_clip_audio": 1.0, "dissolve": 0.0, "min_seconds": 15, "max_seconds": 45,
        "music": {"style": "pulse", "bpm": 118, "gain": -11, "seed": 20261005,
                  "energy": [[0, 0], [marks["r2a"][0], 1], [turn, 2], [marks["r5"][0], 3], [marks["r7"][0], 1]],
                  "accents": [0.02, round(turn, 3)]},
        "todo": ["his takes r1 r3 r4 r5 r7 (clips/) and r2 r6 voice (voice/)", "r5: cut to the map on the word מסמנים"],
    }
    (RD / "timeline.json").write_text(json.dumps(tl, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"timeline: {len(shots)} shots, {total:.1f}s")


if __name__ == "__main__":
    main()
