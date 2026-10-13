# -*- coding: utf-8 -*-
"""המירוץ לציון, the OPENING video (in app, 9:16, ~2:20). Builds graphics, phone shots, timeline.json.

    cd .claude/skills/reel-studio/engine
    python "%USERPROFILE%/Desktop/RushPoint-reels-work/race-opening/make_timeline.py"
    python build.py race-opening --opening A

Script: the 30 shots of docs/marketing/playbooks/shoot-plan-2026-10-05.pdf (v7 script + אודי's two
fixes). Frames A/B/C/D are his takes; V = his voice (from a take filmed in frame A) over an app
recording or a map. Until the takes arrive every line is a grey placeholder of its estimated
length; measured.json (written by the assemble step) re-flows everything.
Founder rules 36 to 42: no mission content, a screen for every practical line, friendly tone.
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
CL = RD.parent / "race-classroom" / "clips"
MEASURED = json.loads((RD / "measured.json").read_text(encoding="utf-8")) if (RD / "measured.json").exists() else {}

# (id, chapter, frame, line, picture, on screen)
LINES = [
    # captions = what he SAID on 2026-10-13 (he improvised; founder rule 21), not the v5 script
    ("s01", 1, "A", "היי, אני אחיה.", "talk", "@name"),
    ("s02", 1, "B", "בניתי את האפליקציה שאתם עומדים לשחק בה.", "talk", None),
    ("s03", 1, "A", "בשלוש הדקות הקרובות אני מסביר איך המשחק עובד, מהזינוק ועד לטקס.", "talk", None),
    ("s04", 1, "B", "כל קבוצה יוצאת בזמן אחר, אז מי שיצא לפניכם לא בהכרח מוביל.", "talk", None),
    ("s05", 1, "A", "טלפון אחד בקבוצה מנהל את המשחק ומקליד את התשובות.", "talk", None),
    ("s06", 1, "V", "כל השאר יכולים להתחבר מהטלפון שלהם ולראות את המשימה ואת המיקום על המפה.", "scr:join", None),
    ("s07", 2, "A", "המרוץ בנוי משלושה שלבים.", "talk+pause", "@123"),
    ("s08", 2, "B", "שלב ראשון, על דרך עולי הרגל.", "talk", "שלב 1|דרך עולי הרגל"),
    ("s09", 2, "V", "כשאתם מגיעים לנקודת הזינוק, האפליקציה מזהה שאתם שם ופותחת את המשימות.", "scr:arrive", None),
    ("s10", 2, "V", "בדרך תקבלו שתי משימות, ובתצפית בטור סיני מחכה לכם עוד אחת.", "map", None),
    ("s11", 2, "A", "שימו לב, עד הכניסה לפארק הולכים ליד המדריך קק״ל.", "talk", None),
    ("s12", 2, "V", "בכניסה, כל קבוצה מקבלת את הטנא שלה.", "photo:park_basket.jpg", "הטנא"),
    ("s13", 2, "A", "שלב שני, בתוך הפארק.", "talk", "שלב 2|בתוך הפארק"),
    ("s14", 2, "B", "יש ארבע תחנות, וכל קבוצה עושה שתיים.", "talk", "2 מתוך 4"),
    ("s15", 2, "V", "האפליקציה שולחת אתכם לתחנה שפנויה כרגע, אז לא מחכים בתור.", "scr:nav", None),
    ("s16a", 2, "A", "שלב שלישי נפתח ליד הגת העתיקה,", "talk", "שלב 3|הגת העתיקה"),
    ("s16b", 2, "B", "ומשם עוד כמה משימות עד לשופטים.", "talk", None),
    ("s17", 2, "A", "אחרי השופטים מתיישבים במחצלת של הכיתה.", "talk", None),
    ("s18", 2, "V", "לוח התוצאות סגור עד לטקס, ושם מגלים מי המנצח.", "card:board", None),
    ("s19", 3, "V", "יש משימות שאפשר לקבל עליהן בונוס בנקודות, וזה כתוב באפליקציה.", "scr:score", None),
    ("s20", 3, "B", "בסוף, הקבוצות שמנצחות הן אלה שעובדות הכי בפרודוקטיביות, ושכל אחד בקבוצה לוקח חלק.", "talk", None),
    ("s21", 4, "A", "המשימה לא נפתחת לכם? תתקרבו לנקודה.", "talk", None),
    ("s22", 4, "V", "חלק מהמשימות נפתחות רק כשאתם במקום המדויק.", "scr:sealed", None),
    ("s23", 4, "B", "האפליקציה צריכה מיקום, אז שימו לב שהטלפון שלכם טעון.", "talk", None),
    ("s24", 4, "A", "במידה ויש לכם תקלה בפלאפון, תפנו למדריך.", "talk", None),
    ("s25", 5, "B", "במקרה חירום לוחצים על הSOS בפלאפון ופונים למדריך.", "talk", None),
    ("s26", 5, "V", "יש שם חיוג מהיר לכל מה שצריך, והצוות שלנו יקבל את ההתראה.", "scr:sos", None),
    ("s27", 6, "A", "תעשו טובה לעצמכם, תשתו מים בדרך, שימו כובע, גם אם זה פחות כיף.", "talk", None),
    ("s28", 6, "B", "תשאירו נקי. בסוף יש אנשים שישבו שעות וינקו אחריכם.", "talk", None),
    ("s29", 6, "A", "וזהו, כשהמדריך נותן את האות, אתם יכולים לצאת.", "talk", None),
    ("s30", 6, "B", "בהצלחה!", "talk", None),
]
CHAPTERS = {1: "איך משחקים", 2: "שלושה שלבים", 3: "נקודות", 4: "הטלפון", 5: "חירום", 6: "יוצאים"}
GAP = 0.0       # 2026-10-13: hard cuts, no air between lines ("more energetic")
TAILS = json.loads((RD / "tails.json").read_text(encoding="utf-8")) if (RD / "tails.json").exists() else {}
OUTRO = 2.6


def picture_end(lid: str, d: float) -> float:
    """How long the PICTURE of a talking line may stay (his note: every clip was cut too late, he
    is seen looking to the laptop or freezing). Two frames before his eyes leave the lens and
    never past the last vowel; the voice tail then finishes under the next picture (an L cut),
    but by no more than 0.10 s of real speech."""
    t = TAILS.get(lid)
    if not t:
        return d
    end = t["vend"] - 0.02
    if t["leave"] and t["leave"] > 0.3:
        end = min(end, t["leave"] - 0.20)      # the eyes start drifting ~5 frames before the detector fires
    return round(max(min(end, t["dur"] - 0.04), t["vend"] - 0.45, 0.4), 3)


def held(lid: str, h: float) -> str:
    """The clip with its first frame held for h seconds: the picture may start before the voice
    (the previous line is still finishing under it) while the lips stay in sync."""
    import subprocess
    out = RD / "clips" / f"{lid}_h.mp4"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(RD / "clips" / f"{lid}.mp4"), "-an", "-vf",
                    f"tpad=start_mode=clone:start_duration={h:.3f}", "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p",
                    "-color_range", "tv", "-colorspace", "bt709", str(out)], check=True)
    return f"clips/{lid}_h.mp4"


def outro() -> str:
    """RushPoint end animation (he asked for one on this video): the app icon springs in, the
    wordmark wipes in beside an orange underline, on the same white."""
    import subprocess
    import numpy as np
    from PIL import Image, ImageDraw, ImageFont
    out = RD / "clips" / "outro.mp4"
    icon_png = P.png(G, "outro_icon", f'<img style="position:absolute;left:0;top:0;width:1080px;height:1080px;border-radius:238px" '
                     f'src="{Path(r"C:/Users/savir/Projects/Rushpoint/apps/play-web/public/icon.svg").as_uri()}">', "")
    icon = Image.open(RD / icon_png).convert("RGBA").crop((0, 0, 1080, 1080))
    font = ImageFont.truetype(str(Path(P.ENGINE) / "fonts" / "SpaceGrotesk-700.ttf"), 150)
    word = "RushPoint"
    tw = int(font.getlength(word))
    n = int(OUTRO * P.FPS)
    ease = lambda x: 1 - (1 - min(max(x, 0), 1)) ** 3                     # noqa: E731
    spring = lambda x: 1 + 0.16 * np.exp(-6 * x) * np.cos(14 * x) if x > 0 else 0   # noqa: E731
    wr = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{P.W}x{P.H}", "-r", str(P.FPS),
                           "-i", "-", "-vf", "scale=out_range=tv:out_color_matrix=bt709,format=yuv420p", "-c:v", "libx264", "-crf", "14",
                           "-pix_fmt", "yuv420p", "-color_range", "tv", "-colorspace", "bt709", str(out)], stdin=subprocess.PIPE)
    for i in range(n):
        t = i / P.FPS
        fr = Image.new("RGB", (P.W, P.H), "#FFFFFF")
        k = ease(t / 0.22) * spring(t)                                    # icon: scale in with a small overshoot
        if k > 0.02:
            sz = int(380 * k)
            ic = icon.resize((sz, sz), Image.LANCZOS)
            sh = Image.new("RGBA", (sz + 120, sz + 120), (0, 0, 0, 0))
            fr.paste(ic, ((P.W - sz) // 2, 760 - sz // 2), ic)
        w = ease((t - 0.30) / 0.35)                                       # wordmark: wipe from the left + rise
        if w > 0:
            layer = Image.new("RGBA", (tw + 20, 200), (0, 0, 0, 0))
            ImageDraw.Draw(layer).text((10, 0), word, font=font, fill=(28, 25, 23, 255))
            layer = layer.crop((0, 0, int((tw + 20) * w), 200))
            fr.paste(layer, ((P.W - tw) // 2 - 10, int(1010 + 26 * (1 - w))), layer)
        u = ease((t - 0.55) / 0.35)                                       # underline sweeps out from the centre
        if u > 0:
            half = int(tw * 0.5 * u)
            ImageDraw.Draw(fr).rounded_rectangle([P.W // 2 - half, 1196, P.W // 2 + half, 1210], 7, fill="#F97316")
        wr.stdin.write(fr.tobytes())
    wr.stdin.close(); wr.wait()
    return "clips/outro.mp4"
BLUR = [(40, 194, 332, 76)]   # mission title + description on the phone (founder rule 38)


def name_tag() -> str:
    css = f""".l{{position:absolute;left:70px;top:900px;direction:rtl;text-align:right;}}
      .a{{font:900 110px 'Rubik';color:{P.DARK};}}
      .b{{display:inline-block;margin-top:8px;background:{P.FIRE};color:#fff;font:700 42px 'Rubik';
      padding:8px 22px;border-radius:12px;}}"""
    return P.png(G, "name", '<div class="l"><div class="a">אחיה</div><div class="b">בנה את האפליקציה</div></div>', css)


def one_two_three() -> str:
    css = f""".r{{position:absolute;left:0;right:0;top:900px;display:flex;justify-content:center;gap:40px;direction:rtl;}}
      .c{{width:200px;height:200px;border-radius:50%;background:#fff;border:8px solid {P.FIRE};box-shadow:0 10px 30px rgba(0,0,0,.12);
      color:{P.DARK};font:900 120px 'Rubik';display:flex;align-items:center;justify-content:center;}}"""
    return P.png(G, "one23", '<div class="r">' + "".join(f'<div class="c">{n}</div>' for n in (1, 2, 3)) + "</div>", css)


def card_board() -> str:
    rows = "".join(f'<div class="row"><div class="rk">{i}</div><div class="nm">{n}</div><div class="pt">{p}</div></div>'
                   for i, (n, p) in enumerate([("הנשרים", 1840), ("עולי הרגל של ח׳3", 1720), ("צוות ציון", 1655),
                                               ("האריות של רמות", 1590), ("דרך הבשמים", 1410), ("הכורמים", 1385),
                                               ("המטפסים", 1290)], 1))
    css = f"""body{{background:#fff;}}
      .b{{position:absolute;left:90px;right:90px;top:300px;filter:blur(14px);}}
      .row{{display:flex;align-items:center;gap:26px;background:{P.BONE};border:2px solid #e7ded0;border-radius:22px;margin-bottom:24px;padding:24px 34px;direction:rtl;}}
      .rk{{width:66px;height:66px;border-radius:50%;background:{P.FIRE};color:#fff;font:800 38px 'Rubik';display:flex;align-items:center;justify-content:center;}}
      .nm{{flex:1;font:800 46px 'Rubik';color:{P.DARK};}} .pt{{font:800 46px 'Rubik';color:#9a3412;}}
      .lock{{position:absolute;left:50%;transform:translateX(-50%);top:640px;width:190px;height:190px;border-radius:50%;background:{P.DARK};
      border:7px solid {P.AMBER};display:flex;align-items:center;justify-content:center;}}"""
    lock = ('<svg width="92" height="92" viewBox="0 0 24 24" fill="none" stroke="#FFB300" stroke-width="2.2" stroke-linecap="round">'
            '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>')
    return P.png(G, "card_board", f'<div class="b">{rows}</div><div class="lock">{lock}</div>', css, "#ffffff")


def white_ground():
    """phone_shot() reuses screens/_comp/ground_v.png when it exists: give it a white one (2026-10-13,
    he asked for a pure white background through the whole video)."""
    from PIL import Image
    d = RD / "screens" / "_comp"
    d.mkdir(parents=True, exist_ok=True)
    g = d / "ground_v.png"
    if not g.exists() or Image.open(g).getpixel((5, 5))[0] < 250:
        Image.new("RGB", (P.W, P.H), "#FFFFFF").save(g)


def title_dark(name: str, text: str, y: int = 955, size: int = 88) -> str:
    """A lower third over his chest (his head fills the top of every take, there is no room above it),
    dark on a white plate, the first row in the brand orange."""
    rows = text.split("|")
    lines = "".join(f'<div class="r{" k" if i == 0 and len(rows) > 1 else ""}">{l}</div>' for i, l in enumerate(rows))
    css = f""".b{{position:absolute;left:60px;right:60px;top:{y}px;display:flex;flex-direction:column;align-items:center;gap:6px;}}
      .r{{font:900 {size}px/1.08 'Rubik';direction:rtl;text-align:center;color:{P.DARK};background:rgba(255,255,255,.86);
      padding:2px 22px;border-radius:18px;}}
      .k{{color:#fff;background:{P.FIRE};font-size:{int(size * .62)}px;padding:8px 30px;border-radius:999px;}}"""
    return P.png(G, name, f'<div class="b">{lines}</div>', css)


# the cut outs sit on pure white, so a tighter framing is a crop with no background to betray it
CROP_B = [130, 40, 820, 1458]


def main():
    (RD / "voice").mkdir(exist_ok=True)
    (RD / "clips").mkdir(exist_ok=True)
    tags = {n: P.chapter_tag(G, n, t) for n, t in CHAPTERS.items()}
    white_ground()
    nm, n123, board = name_tag(), one_two_three(), card_board()
    if not (RD / "clips" / "park_basket.jpg").exists():
        shutil.copy(CL / "park_basket.jpg", RD / "clips" / "park_basket.jpg")   # public domain painting (IMAGE-LICENSES.txt)

    # lengths first, so each phone recording is cut to its line
    dur = {lid: float(MEASURED.get(lid, P.est(line))) for lid, _, _, line, _, _ in LINES}
    A_new, B_new, A_cls = RD / "clips" / "raw_a.mp4", RD / "clips" / "raw_b.mp4", CL / "raw_a.mp4"
    # source windows (from the recordings' marks.json): join form→joined, arrive→mission open,
    # walking toward a stop, score 0→100, the sealed card with metres, SOS sheet→services
    scr = {
        "join":   lambda d: P.phone_shot(RD, "scr_join", B_new, 1.6, d, 10.5 / d),
        "arrive": lambda d: P.phone_shot(RD, "scr_arrive", A_cls, 59.8, d, 8.0 / d, BLUR),
        "nav":    lambda d: P.phone_shot(RD, "scr_nav", A_cls, 8.0, d, 30.0 / d),
        "score":  lambda d: P.phone_shot(RD, "scr_score", A_cls, 102.6, d, 1.6, BLUR),
        "sealed": lambda d: P.phone_shot(RD, "scr_sealed", A_cls, 30.0, d, 1.0),
        "sos":    lambda d: P.phone_shot(RD, "scr_sos", A_new, 35.4, d, 6.4 / d),   # from the SOS press: the old 27.6 opened on the QR panel
    }

    shots, caps, ovs, sfx = [], [], [], []
    t = 0.0
    vfree = 0.0          # the earliest the next VOICE may start (the previous line minus 0.10 s of its tail)
    chap_start: dict[int, float] = {}
    for lid, ch, frame, line, pic, title in LINES:
        d = dur[lid]
        talking = pic.startswith("talk")
        p0 = t                                   # picture start
        a = max(p0, vfree)                       # voice (and caption) start
        hold = a - p0
        if hold < 0.034:
            a, hold = p0, 0.0
        b = a + (picture_end(lid, d) if talking else d) + GAP
        if ch not in chap_start:
            chap_start[ch] = p0
            if p0 > 0:
                sfx.append({"at": round(p0, 3), "file": "sfx/whoosh.wav", "gain": -9})
        if frame != "V" and not (RD / "clips" / f"{lid}.mp4").exists():
            P.placeholder(RD, lid, d + 0.3, f"הפתיחה · {lid}", frame, line)
        elif frame == "V" and not (RD / "voice" / f"{lid}.wav").exists():
            P.silent_wav(RD / "voice" / f"{lid}.wav", d)
        shot = {"id": lid, "start": round(p0, 3), "end": round(b, 3), "effect": "none"}
        cap_y = None
        if pic.startswith("talk"):
            shot.update({"clip": held(lid, hold) if hold else f"clips/{lid}.mp4", "in": 0, "audio_gain": 0})
            sfx.append({"at": round(a, 3), "file": f"voice/{lid}.wav", "gain": 0})
            if frame == "B" and int(lid[1:3]) >= 13:   # the long take is one framing; the early takes vary by themselves
                shot["crop"] = CROP_B
            if lid == "s16b":
                shot["cut"] = True          # the framing changes exactly on the join (founder rule 48)
        else:
            if pic.startswith("scr:"):
                shot.update({"clip": scr[pic[4:]](b - p0), "in": 0})
                cap_y = 1300
            elif pic == "map":
                shot.update({"clip": "clips/map_v.mp4", "in": 0.4, "speed": round(4.6 / (b - p0), 4), "cut": True})
            elif pic.startswith("photo:"):
                shot.update({"graphic": f"clips/{pic[6:]}", "effect": "slow_push"})
            elif pic == "card:board":
                shot.update({"graphic": board, "effect": "slow_push"})
                sfx.append({"at": round(a + 0.1, 3), "file": "sfx/tick.wav", "gain": -6})
            sfx.append({"at": round(a, 3), "file": f"voice/{lid}.wav", "gain": 0})
        shots.append(shot)
        cap = {"start": round(a + 0.04, 3), "end": round(a + d, 3), "text": line, "style": "box", "size": 84, "y": 1300}
        if cap_y:
            cap["y"] = cap_y
        caps.append(cap)
        if title == "@name":
            ovs.append({"png": nm, "start": round(a + 0.2, 3), "end": round(b - 0.1, 3), "kind": "text"})
        elif title == "@123":
            ovs.append({"png": n123, "start": round(a + 0.6, 3), "end": round(b - 0.05, 3), "kind": "text"})
        elif title:
            sfx.append({"at": round(a + 0.25, 3), "file": "sfx/pop.wav", "gain": -12})
            ovs.append({"png": title_dark(f"t_{lid}", title),
                        "start": round(a + 0.25, 3), "end": round(b - 0.1, 3), "kind": "text"})
        t = b
        vfree = a + d - 0.10
    t = max(t, a + d - 0.05)                     # the last word finishes before the outro
    shots[-1]["end"] = round(t, 3)
    shots.append({"id": "outro", "start": round(t, 3), "end": round(t + OUTRO, 3), "clip": outro(), "in": 0, "effect": "none"})
    sfx.append({"at": round(t, 3), "file": "sfx/whoosh.wav", "gain": -7})
    sfx.append({"at": round(t + 0.30, 3), "file": "sfx/ding.wav", "gain": -8})
    sfx.append({"at": 0.0, "file": "sfx/hit.wav", "gain": -9})
    t_out = t
    t += OUTRO
    total = t
    order = sorted(chap_start)
    for i, n in enumerate(order):
        end = chap_start[order[i + 1]] if i + 1 < len(order) else t_out
        ovs.append({"png": tags[n], "start": round(chap_start[n], 3), "end": round(end, 3), "kind": "text"})
    tl = {
        "id": "race-opening",
        "title": "המירוץ לציון, סרטון הפתיחה באפליקציה (9:16)",
        "source": "shoot-plan-2026-10-05.pdf + reels-14-15-carousel-opening-v7-2026-10-05.md. Built by make_timeline.py, do not hand edit.",
        "rules": ["founder rules 36 to 42", "no mission content: phone mission text blurred", "captive audience: calm, clear"],
        "shots": shots, "captions": caps, "overlays": ovs, "sfx": sfx, "voice": {},
        "keep_clip_audio": 0, "dissolve": 0, "white_background": True, "min_seconds": 90, "max_seconds": 180,
        "music": {"style": "kickoff", "bpm": 116, "gain": -11, "seed": 20261014, "accents": [0, round(t_out, 3)],
                  "energy": [[0, 2], [chap_start[2], 3], [chap_start[5], 1], [chap_start[6], 3]]},
        "todo": ["Tor Sinai + route coordinates are provisional (map)"],
    }
    (RD / "timeline.json").write_text(json.dumps(tl, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"timeline: {len(shots)} shots, {total:.1f}s")


if __name__ == "__main__":
    main()
