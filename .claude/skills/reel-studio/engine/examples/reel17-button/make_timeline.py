# -*- coding: utf-8 -*-
"""Reel 16, "הכפתור" (9:16, loops). He hesitates over a button, presses, the camera falls into the
phone and 350 phones burst onto the map; then nine short lines that explain RushPoint to someone
who never heard of it. Builds every graphic and timeline.json.

    cd .claude/skills/reel-studio/engine
    python "%USERPROFILE%/Desktop/RushPoint-reels-work/reel16-button/make_timeline.py"
    python build.py reel16-button --opening A && python qa.py reel16-button --opening A

Inputs made by the other scripts in this folder:
  hook/track.py + hook/comp.py   clips/hook.mp4 (the screen insert and the dive), hook_meta.json
  map/render_burst.mjs           clips/burst.mp4 (the phones on the real map)
  assemble.py                    clips/l1..l9.mp4 (him on white, 1.12x), voice/*.wav, measured.json
  words.py                       words.json (word times of the cut lines, for captions and cut points)
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

RD = Path(__file__).resolve().parent
ENG = Path(r"C:\Users\savir\Projects\Rushpoint\.claude\skills\reel-studio\engine")
sys.path.insert(0, str(ENG))
from lib import portrait as P  # noqa: E402

G = RD / "graphics"
M = json.loads((RD / "measured.json").read_text(encoding="utf-8"))
WORDS = json.loads((RD / "words.json").read_text(encoding="utf-8"))
HOOK = json.loads((RD / "hook_meta.json").read_text(encoding="utf-8"))
GAP = 0.06
HOLD_AFTER = {"l8": 0.5}       # half a second of him after "בחינם" (l8_tail.py gives the clip that tail), so the stamp can land
CLS = RD.parent / "race-classroom" / "clips" / "raw_a.mp4"           # the real play-web on the emulator
BUILDER = Path(r"C:\Users\savir\Projects\Rushpoint\docs\marketing\footage\devlog-hachvav-retro\shot3-builder-drag-and-map-pin.mp4")
BLUR = [(40, 194, 332, 76)]                                         # mission title + text on the phone (rule 38)
# cut outs on pure white: a tighter framing is a plain crop
WIDE, MID, CLOSE, TIGHT = None, [70, 20, 940, 1671], [130, 40, 820, 1458], [190, 8, 700, 1244]

# what he SAID (rule 21). Whisper's mishearings corrected: בערי → בהרי, ראש פוינט → RushPoint, בכי דם → בחינם.
SAID = {
    "l1": "אתם קולטים? שעתיים מהרגע שהסרטון הזה עלה, 350 תלמידים בהרי ירושלים נכנסים למרוץ.",
    "l2": "הכל רץ על RushPoint, אפליקציה שבניתי.",
    "l3": "שעליה אפשר לבנות ולהריץ משחקים בסגנון של המרוץ למיליון.",
    "l4": "מסמנים נקודות על המפה, בכל נקודה מחכה משימה והיא נפתחת רק כשמגיעים אליה.",
    "l5": "הניקוד נספר לבד, והטבלה מתעדכנת בזמן אמת.",
    "l6": "בניתי אותה בגיל 17 בשביל סבתא שלי, למרוץ שקורה ממש היום.",
    "l7": "אבל כל אחד פה יכול לבנות במשחק הזה. לכיתה, לפעולה, עם חברים, לכל דבר.",
    "l8": "והכי חשוב, זה בחינם.",
    "l9": "אז מה אתם אומרים? נלחץ?",
}
ACCENT = ["350", "RushPoint", "17", "בחינם", "למיליון", "נלחץ?"]


def word_times(lid):
    """The caption words (SAID) on the measured word times. Whisper's count can differ by a word
    (ראש פוינט is one caption word): map by position, proportionally, and keep the times ordered."""
    said = [w.rstrip(",.") for w in SAID[lid].split()]      # captions carry no commas or full stops, only the question marks
    ws = WORDS[lid]["words"]
    d = float(M[lid])
    if not ws:
        return [[w, round(i * d / len(said), 3), round((i + 1) * d / len(said), 3)] for i, w in enumerate(said)]
    out = []
    for i, w in enumerate(said):
        j0 = min(int(round(i * len(ws) / len(said))), len(ws) - 1)
        j1 = min(max(int(round((i + 1) * len(ws) / len(said))) - 1, j0), len(ws) - 1)
        out.append([w, ws[j0][1], ws[j1][2]])
    t = 0.0
    for o in out:                                   # ordered, inside the line, at least 0.12 s each
        o[1] = max(o[1], t)
        o[2] = min(max(min(o[2], o[1] + 0.9), o[1] + 0.12), d)    # whisper stretches a word over a pause: cap it
        t = o[2]
    return out


def at(lid, starts_with, default_frac):
    """Seconds into the line where the first word starting with this text begins (a cut point)."""
    for w, a, b in word_times(lid):
        if w.startswith(starts_with):
            return max(a - 0.04, 0.0)
    return float(M[lid]) * default_frac


def white_ground():
    from PIL import Image
    d = RD / "screens" / "_comp"
    d.mkdir(parents=True, exist_ok=True)
    g = d / "ground_v.png"
    if not g.exists():
        Image.new("RGB", (P.W, P.H), "#FFFFFF").save(g)


def hook_title():
    css = f""".b{{position:absolute;left:470px;top:300px;width:570px;display:flex;flex-direction:column;align-items:center;gap:8px;}}
      .r{{font:900 92px/1.05 'Rubik';direction:rtl;text-align:center;color:#fff;-webkit-text-stroke:12px {P.DARK};paint-order:stroke fill;}}
      .k{{font:900 86px/1.05 'Rubik';color:#fff;background:{P.FIRE};border-radius:20px;padding:4px 26px 10px;direction:rtl;
      box-shadow:0 10px 30px rgba(0,0,0,.35);}}"""
    return P.png(G, "hook_title", '<div class="b"><div class="r">לחיצה אחת</div><div class="k">350 תלמידים</div></div>', css)


def free_stamp():
    css = """.s{position:absolute;left:0;right:0;top:1010px;display:flex;justify-content:center;}
      .t{font:900 190px/1 'Rubik';color:#fff;background:#10B981;border-radius:34px;padding:6px 60px 22px;direction:rtl;
      transform:rotate(-5deg);box-shadow:0 18px 50px rgba(0,0,0,.35);border:8px solid #fff;}"""
    return P.png(G, "free", '<div class="s"><div class="t">בחינם</div></div>', css)


def word_card(name, text, bg, fg="#fff"):
    """One word, full frame, for the list he fires off (a class, a youth group, friends, anything)."""
    css = f""".w{{position:absolute;left:0;right:0;top:640px;text-align:center;font:900 230px/1.05 'Rubik';color:{fg};direction:rtl;}}"""
    return P.png(G, name, f'<div class="w">{text}</div>', css, bg)


def tag(name, text, bg="#fff", fg=None, left=30, top=300, size=140, rot=-6):
    """A big label in the free corner beside his head (wide framings only)."""
    fg = fg or P.DARK
    css = f""".t{{position:absolute;left:{left}px;top:{top}px;transform:rotate({rot}deg);font:900 {size}px/1.1 'Rubik';color:{fg};
      background:{bg};border-radius:28px;padding:0 30px 12px;box-shadow:0 14px 34px rgba(0,0,0,.35);direction:rtl;white-space:nowrap;}}"""
    return P.png(G, name, f'<div class="t">{text}</div>', css)


def make_sfx():
    """A short riser that ends on the press, and the cascade of clicks as the phones land."""
    import numpy as np
    import soundfile as sf
    s = RD / "sfx"
    if not (s / "riser_s.wav").exists():
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(s / "riser.wav"), "-af",
                        "atrim=1.05:2.4,asetpts=PTS-STARTPTS,afade=t=in:d=0.5,afade=t=out:st=1.27:d=0.08", str(s / "riser_s.wav")], check=True)
    if not (s / "cascade.wav").exists():
        sr = 48000
        x = np.zeros(int(1.5 * sr), np.float32)
        rng = np.random.default_rng(16)
        for i in range(34):
            t = 0.03 + 1.05 * (i / 34) ** 0.75 + rng.uniform(0, 0.012)
            f = 520 * 2 ** (i / 34 * 1.6)
            n = int(0.07 * sr)
            tt = np.arange(n) / sr
            blip = np.sin(2 * np.pi * f * tt) * np.exp(-tt * 55) * (0.35 + 0.4 * i / 34)
            a = int(t * sr)
            x[a:a + n] += blip.astype(np.float32)
        x[int(1.12 * sr):int(1.12 * sr) + int(0.3 * sr)] += (np.sin(2 * np.pi * 1760 * np.arange(int(0.3 * sr)) / sr)
                                                            * np.exp(-np.arange(int(0.3 * sr)) / sr * 12) * 0.5).astype(np.float32)
        sf.write(str(s / "cascade.wav"), x / max(abs(x).max(), 1e-9) * 0.8, sr)


def main():
    (RD / "clips").mkdir(exist_ok=True)
    white_ground()
    make_sfx()
    if not (RD / "clips" / "builder.mp4").exists():
        shutil.copy(BUILDER, RD / "clips" / "builder.mp4")
    T0 = HOOK["frames"] / P.FPS
    press = HOOK["press_frame"] / P.FPS
    dive = HOOK["dive_from"] / P.FPS
    order = ["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8", "l9"]
    S, t = {}, T0
    for lid in order:
        S[lid] = t
        t += float(M[lid]) + GAP + HOLD_AFTER.get(lid, 0.0)
    total = t - GAP + 0.05
    E = {lid: (S[order[i + 1]] if i + 1 < len(order) else total) for i, lid in enumerate(order)}

    shots, caps, ovs, sfx = [], [], [], []

    def shot(sid, a, b, clip, t_in=0.0, crop=None, effect="none", **kw):
        d = {"id": sid, "start": round(a, 3), "end": round(b, 3), "clip": clip, "in": round(t_in, 3), "effect": effect,
             "audio_gain": 0.0, "cut": True, **kw}
        if crop:
            d["crop"] = crop
        shots.append(d)

    def talk(lid, cuts, frames):
        """One line of him: the same clip, a new framing at every cut point (rule 48)."""
        pts = [0.0] + [c for c in cuts] + [E[lid] - S[lid]]
        for i in range(len(pts) - 1):
            if pts[i + 1] - pts[i] < 0.2:
                continue
            shot(f"{lid}_{i}", S[lid] + pts[i], S[lid] + pts[i + 1], f"clips/{lid}.mp4", pts[i], frames[i % len(frames)])

    # 0 · the hook: the insert, the press, the dive
    shot("hook", 0.0, T0, "clips/hook.mp4")
    ovs.append({"png": hook_title(), "start": 0.0, "end": round(press + 0.05, 3), "kind": "text"})
    sfx += [{"at": 0.0, "file": "sfx/hit.wav", "gain": -3}, {"at": 0.0, "file": "sfx/whoosh.wav", "gain": -9},
            {"at": round(max(press - 1.33, 0.0), 3), "file": "sfx/riser_s.wav", "gain": -7},
            {"at": round(press, 3), "file": "sfx/hit.wav", "gain": 0}, {"at": round(press, 3), "file": "sfx/buzz.wav", "gain": -5},
            {"at": round(dive, 3), "file": "sfx/whoosh.wav", "gain": -3},
            {"at": round(T0 - 0.02, 3), "file": "sfx/cascade.wav", "gain": -6}]
    if (RD / "voice" / "v0y.wav").exists():      # "יאללה", under his breath, just before the finger lands
        sfx.append({"at": round(max(press - 0.48, 0.05), 3), "file": "voice/v0y.wav", "gain": -2})   # the word is its first 0.35 s

    # 1 · the phones burst while he says it, then him
    c350 = at("l1", "350", 0.43)
    cbh = at("l1", "בהרי", 0.66)
    cnk = at("l1", "נכנסים", 0.83)
    shot("l1_map", S["l1"], S["l1"] + c350, "clips/burst.mp4", 0.0)
    for i, (a, b, fr) in enumerate([(c350, cbh, WIDE), (cbh, cnk, CLOSE), (cnk, E["l1"] - S["l1"], MID)]):
        shot(f"l1_{i}", S["l1"] + a, S["l1"] + b, "clips/l1.mp4", a, fr)

    ovs.append({"png": tag("tag350", "350"), "start": round(S["l1"] + c350 + 0.05, 3), "end": round(S["l1"] + cbh, 3), "kind": "text"})
    sfx.append({"at": round(S["l1"] + c350 + 0.05, 3), "file": "sfx/pop.wav", "gain": -5})

    # 2, 3 · what it is
    ca = at("l2", "אפליקציה", 0.62)
    shot("l2_0", S["l2"], S["l2"] + ca, "clips/l2.mp4", 0.0, WIDE)
    # no label here: beside his head there is no room for the word, the caption carries it in amber
    app = P.phone_shot(RD, "scr_app", CLS, 30.0, E["l2"] - S["l2"] - ca, 1.0)
    shot("l2_app", S["l2"] + ca, E["l2"], app, effect="slow_push")
    cb, cs = at("l3", "לבנות", 0.3), at("l3", "בסגנון", 0.58)
    shot("l3_0", S["l3"], S["l3"] + cb, "clips/l3.mp4", 0.0, MID)
    shot("l3_build", S["l3"] + cb, S["l3"] + cs, "clips/builder.mp4", 21.0, effect="slow_push")
    shot("l3_1", S["l3"] + cs, E["l3"], "clips/l3.mp4", cs, CLOSE)
    sfx += [{"at": round(S["l2"] + ca, 3), "file": "sfx/whoosh.wav", "gain": -11}, {"at": round(S["l3"] + cb, 3), "file": "sfx/whoosh.wav", "gain": -11}]

    # 4 · how it works: the Builder's map, a sealed mission, arriving
    c1, c2 = at("l4", "בכל", 0.33), at("l4", "והיא", 0.62)
    d1, d2, d3 = c1, c2 - c1, E["l4"] - S["l4"] - c2
    shot("l4_build", S["l4"], S["l4"] + c1, "clips/builder.mp4", 23.2, effect="slow_push", speed=1.3)
    sealed = P.phone_shot(RD, "scr_nav", CLS, 8.0, d2, 22.0 / d2)       # walking toward a point: the map moves, the metres drop
    arrive = P.phone_shot(RD, "scr_arrive", CLS, 59.8, d3, 8.0 / d3, BLUR)
    shot("l4_sealed", S["l4"] + c1, S["l4"] + c2, sealed, effect="slow_push")
    shot("l4_arrive", S["l4"] + c2, E["l4"], arrive)
    sfx += [{"at": round(S["l4"], 3), "file": "sfx/whoosh.wav", "gain": -10}, {"at": round(S["l4"] + c2 + d3 * 0.55, 3), "file": "sfx/ding.wav", "gain": -9}]

    # 5 · scoring: him, then the map again with the points and the live table
    c = at("l5", "והטבלה", 0.42)
    shot("l5_0", S["l5"], S["l5"] + c, "clips/l5.mp4", 0.0, CLOSE)
    score = P.phone_shot(RD, "scr_score", CLS, 102.6, E["l5"] - S["l5"] - c, 1.6, BLUR)
    shot("l5_score", S["l5"] + c, E["l5"], score, effect="slow_push")
    sfx.append({"at": round(S["l5"] + c, 3), "file": "sfx/whoosh.wav", "gain": -10})

    # 6..9 · why, who can, free, the loop
    c61, c62 = at("l6", "בשביל", 0.4), at("l6", "למרוץ", 0.66)
    shot("l6_0", S["l6"], S["l6"] + c61, "clips/l6.mp4", 0.0, WIDE)
    shot("l6_1", S["l6"] + c61, S["l6"] + c62, "clips/l6.mp4", c61, CLOSE)
    shot("l6_2", S["l6"] + c62, E["l6"], "clips/l6.mp4", c62, MID)
    c17 = at("l6", "17", 0.3)
    ovs.append({"png": tag("tag17", "בן 17", bg=P.FIRE, fg="#fff", size=110, top=300), "start": round(S["l6"] + c17, 3), "end": round(S["l6"] + c61, 3), "kind": "text"})
    sfx.append({"at": round(S["l6"] + c17, 3), "file": "sfx/pop.wav", "gain": -5})
    c71, c72 = at("l7", "יכול", 0.16), at("l7", "לכיתה", 0.55)
    shot("l7_0", S["l7"], S["l7"] + c71, "clips/l7.mp4", 0.0, MID)
    shot("l7_1", S["l7"] + c71, S["l7"] + c72, "clips/l7.mp4", c71, CLOSE)
    items = [("לכיתה", "לכיתה", P.FIRE, "#fff"), ("לפעולה", "לפעולה", P.DARK, "#fff"), ("עם", "עם חברים", P.AMBER, P.DARK), ("לכל", "לכל דבר", "#10B981", "#fff")]
    pts = [at("l7", k, 0.55 + 0.11 * i) for i, (k, _, _, _) in enumerate(items)] + [E["l7"] - S["l7"]]
    for i, (k, text, bg, fg) in enumerate(items):
        shots.append({"id": f"l7_w{i}", "start": round(S["l7"] + pts[i], 3), "end": round(S["l7"] + pts[i + 1], 3),
                      "graphic": word_card(f"w{i}", text, bg, fg), "effect": "none", "cut": True})
        sfx.append({"at": round(S["l7"] + pts[i], 3), "file": "sfx/pop.wav", "gain": -4})
    LIST_FROM = S["l7"] + c72
    cf = at("l8", "בחינם", 0.6)
    talk("l8", [cf], [TIGHT, WIDE])          # the stamp lands on his chest in the wide framing, never over his face
    ovs.append({"png": free_stamp(), "start": round(S["l8"] + cf + 0.04, 3), "end": round(E["l8"], 3), "kind": "text"})
    sfx.append({"at": round(S["l8"] + cf + 0.04, 3), "file": "sfx/ding.wav", "gain": -4})
    talk("l9", [], [WIDE])

    # voice: one file per line, under whatever picture is up (the talking shots are cut from the same span)
    for lid in order:
        sfx.append({"at": round(S[lid], 3), "file": f"voice/{lid}.wav", "gain": 0})
        on_phone = lid == "l4"
        if lid in ("l2", "l3"):                                        # him, then an insert: a plate keeps the line readable on both
            ws0 = [[w, round(S[lid] + a, 3), round(S[lid] + b, 3)] for w, a, b in word_times(lid)]
            caps.append({"start": ws0[0][1], "end": ws0[-1][2], "words": ws0, "style": "box", "size": 84, "y": 1270, "accent_words": ACCENT})
            continue
        on_map2 = lid == "l5"
        ws = [[w, round(S[lid] + a, 3), round(S[lid] + b, 3)] for w, a, b in word_times(lid)]
        if lid == "l8":
            ws = [w for w in ws if not w[0].startswith("בחינם")]      # the stamp says it
        if lid == "l7":
            ws = [w for w in ws if w[1] < LIST_FROM - 0.02]            # the word cards say the list
        if on_map2 or lid == "l1":
            cut_t = S[lid] + (c if on_map2 else c350)
            first = [w for w in ws if w[1] < cut_t - 0.02]
            second = [w for w in ws if w[1] >= cut_t - 0.02]
            a_, b_ = ({"style": "sub"}, {"style": "box", "y": 1270}) if on_map2 else ({"style": "box", "y": 1270}, {"style": "sub"})
            caps.append({"start": first[0][1], "end": first[-1][2], "words": first, "size": 84, "accent_words": ACCENT, **a_})
            caps.append({"start": second[0][1], "end": second[-1][2], "words": second, "size": 84, "accent_words": ACCENT, **b_})
            continue
        cap = {"start": ws[0][1], "end": ws[-1][2], "words": ws, "style": "box" if on_phone else "sub", "size": 84, "accent_words": ACCENT}
        if on_phone:
            cap["y"] = 1300
        caps.append(cap)

    tl = {
        "id": "reel16-button",
        "title": "רילס 16 · הכפתור",
        "source": "docs/marketing/playbooks/five-reels-race-day-2026-10-13.md (video 1). Built by make_timeline.py, do not hand edit.",
        "rules": ["the phone screen is an insert (hook/comp.py)", "his real room, tidied (clean_room_rvm): he rejected the white cut out and wants it natural",
                  "a new framing at least every 3 s (he asked for jumps)", "no dates (36): 'היום' and 'שעתיים' are his words",
                  "loop: l9 'נלחץ?' cuts back to the finger over the button"],
        "shots": shots, "captions": caps, "overlays": ovs, "sfx": sfx, "voice": {},
        "keep_clip_audio": 0.0, "dissolve": 0.0, "progress_bar": True, "min_seconds": 20, "max_seconds": 50,
        "music": {"style": "heartdrop", "bpm": 140, "gain": -8.5, "seed": 20261014,
                  "energy": [[0, 0], [round(press, 3), 2], [round(S["l3"], 3), 3], [round(S["l6"], 3), 1], [round(S["l7"], 3), 3], [round(S["l9"], 3), 1]],
                  "accents": [round(press, 3)]},
        "todo": [],
    }
    (RD / "timeline.json").write_text(json.dumps(tl, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"timeline: {len(shots)} shots, {total:.2f}s, longest shot {max(s['end'] - s['start'] for s in shots):.2f}s")
    for s in shots:
        print(f"  {s['start']:6.2f} {s['end']:6.2f} {s['id']:10} {s.get('clip', s.get('graphic'))} in={s.get('in', '')} {s.get('crop', '')}")


if __name__ == "__main__":
    main()
