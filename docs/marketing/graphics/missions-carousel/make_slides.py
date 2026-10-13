# -*- coding: utf-8 -*-
"""Carousel v2 "5 משימות למירוץ למיליון" (Instagram post 4:5, 1080x1350, 7 slides).

    python make_slides.py      → out/slide_1.png .. slide_7.png + out/contact.jpg

Ahiya's notes on v1 (2026-10-05): the swipe arrow points the other way; text centred, not to the
side; title "5 משימות למירוץ למיליון"; more elements that make people keep swiping.
What keeps the thumb moving here:
  - a route line that runs THROUGH the carousel: it leaves each slide at the right edge and
    enters the next at the left edge, so every slide visibly continues into the next one;
  - a 5 step progress bar, so the reader always knows how close the end is;
  - a promised reward on the cover ("בסוף: משחק מוכן, בחינם"), paid on slide 7;
  - a courage meter (1 to 5) that climbs, so each mission reads as a step up;
  - a two option poll line on every mission ("הייתם עושים את זה?"), which invites a comment;
  - the last slide asks for a number in the comments, a save and a send.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, r"C:\Users\savir\Projects\Rushpoint\.claude\skills\reel-studio\engine")
from lib.html_render import page, render  # noqa: E402

RD = Path(__file__).resolve().parent
OUT = RD / "out"
OUT.mkdir(exist_ok=True)
W, H = 1080, 1350
FIRE, AMBER, DARK, BONE = "#FF5722", "#FFB300", "#1C1917", "#F5EFE6"
ICON = Path(r"C:\Users\savir\Projects\Rushpoint\apps\play-web\public\icon.svg").as_uri()
ROUTE_Y = 1160   # the route crosses every slide edge at this height

BASE = f"""body{{font-family:'Rubik';background:{DARK};color:{BONE};direction:rtl;}}
.lg{{position:absolute;right:50px;top:46px;width:70px;height:70px;}}
.bar{{position:absolute;left:170px;right:170px;top:74px;display:flex;gap:12px;direction:rtl;}}
.bar i{{flex:1;height:12px;border-radius:6px;background:#3a332e;}} .bar i.on{{background:{FIRE};}}
.mid{{position:absolute;left:70px;right:70px;text-align:center;}}
.sw{{position:absolute;right:40px;top:{ROUTE_Y - 52}px;width:104px;height:104px;border-radius:50%;background:{FIRE};
  display:flex;align-items:center;justify-content:center;box-shadow:0 10px 30px rgba(255,87,34,.45);}}
svg.route{{position:absolute;left:0;top:0;}}
"""


def route(n: int, last: bool) -> str:
    """A dashed trail: enters at the left edge, wanders, leaves at the right edge (ends on 7)."""
    y = ROUTE_Y
    end_x = 540 if last else 1100
    d = f"M -10 {y} C 200 {y - 110}, 330 {y + 100}, {540 if last else 520} {y}" + ("" if last else f" S 860 {y - 80}, {end_x} {y}")
    pin = (f'<circle cx="540" cy="{y}" r="30" fill="{AMBER}" stroke="#fff" stroke-width="8"/>' if last
           else f'<circle cx="520" cy="{y}" r="15" fill="{FIRE}" stroke="#fff" stroke-width="6"/>')
    return (f'<svg class="route" width="{W}" height="{H}"><path d="{d}" fill="none" stroke="{AMBER}" stroke-width="9" '
            f'stroke-dasharray="26 18" stroke-linecap="round" opacity=".9"/>{pin}</svg>')


ARROW = ('<div class="sw"><svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" '
         'stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></div>')


def slide(n: int, body: str, css: str = "", step: int = 0):
    bar = '<div class="bar">' + "".join(f'<i class="{"on" if k < step else ""}"></i>' for k in range(5)) + "</div>"
    last = n == 7
    extra = f'{bar}{route(n, last)}' + ("" if last else ARROW)
    render(page(extra + body, BASE + css, W, H, DARK), OUT / f"slide_{n}.png", W, H)


def courage(k: int, top: int = 940) -> str:
    dots = "".join(f'<span class="{"f" if i < k else ""}"></span>' for i in range(5))
    return f'<div class="cg" style="top:{top}px"><div class="cl">רמת אומץ</div><div class="cd">{dots}</div></div>'


MCSS = f""".num{{top:150px;font:900 220px/1 'Rubik';color:{FIRE};}}
.ttl{{top:390px;font:900 108px/1.04 'Rubik';color:#fff;}}
.txt{{font:700 50px/1.36 'Rubik';color:{BONE};}}
.cg{{position:absolute;left:0;right:0;display:flex;flex-direction:column;align-items:center;gap:12px;}}
.cl{{font:700 34px 'Rubik';color:#a8a29e;}} .cd{{display:flex;gap:14px;direction:rtl;}}
.cd span{{width:44px;height:44px;border-radius:50%;border:5px solid {FIRE};}} .cd span.f{{background:{FIRE};}}
.poll{{position:absolute;left:0;right:0;top:1250px;text-align:center;font:800 38px 'Rubik';color:{AMBER};}}"""

MISSIONS = [   # v3 wording, 2026-10-05: each one must be clear to someone who never played
    ("סחר חליפין", "מקבלים אטב, ומחליפים אותו עם אנשים ברחוב בחפץ אחר. ואז שוב ושוב, עד שמישהו נותן לכם טוש.", 2),
    ("העצומה האבסורדית", "כותבים על דף עצומה מצחיקה: לבטל את חובת הרישיון לרכיבה על חמורים. צריך להחתים עליה חמש עשרה אנשים ברחוב.", 3),
    ("הקוד מהמכולת", "המדריך מתאם מראש עם המוכר. הקבוצה נכנסת, אומרת לו משפט סודי ומקבלת קוד. מקלידים אותו באפליקציה, והמשימה הבאה נפתחת.", 3),
    ("כתבת חדשות דחופה", "מצלמים כתבת חדשות על משהו מוזר שקרה ממש כאן. אחד הכתב, השאר העדים. בונוס: עובר אורח אמיתי שמסכים להגיד משפט למצלמה.", 4),
]


def main():
    # 1 · cover: the number, the promise, and the reward at the end
    slide(1, f"""<div class="mid q">נגמרו לכם הרעיונות לפעולה?</div><div class="mid k">5 משימות</div><div class="mid t">למירוץ<br>למיליון</div>
          <div class="mid s">שאפשר לעשות כבר בפעולה הבאה</div>
          <div class="r">בסוף: משחק מוכן, בחינם</div>""",
          f""".q{{top:170px;font:800 50px 'Rubik';color:{AMBER};}}
          .k{{top:250px;font:900 100px 'Rubik';color:#fff;}}
          .t{{top:375px;font:900 190px/0.98 'Rubik';color:{FIRE};}}
          .s{{top:770px;font:700 52px/1.3 'Rubik';color:{BONE};}}
          .r{{position:absolute;left:190px;right:190px;top:900px;text-align:center;font:800 46px 'Rubik';color:{DARK};
          background:{AMBER};border-radius:999px;padding:14px 0;}}""")
    for i, (name, text, lvl) in enumerate(MISSIONS, start=2):
        two = len(name) >= 11
        slide(i, f"""<div class="mid num">{i - 1}</div><div class="mid ttl">{name}</div>
              <div class="mid txt" style="top:{640 if two else 540}px">{text}</div>{courage(lvl, 990 if two else 900)}
              <div class="poll">הייתם עושים את זה? כן או אין סיכוי</div>""", MCSS, step=i - 1)
    # 6 · Titanic, the hardest
    poster = (RD / "img" / "titanic_poster.png").as_uri()
    ai = next((p for p in (RD / "img" / "titanic_ai.png", RD / "img" / "titanic_ai.jpg") if p.exists()), None)
    ai_html = f'<img src="{ai.as_uri()}">' if ai else '<div class="todo">תמונת AI</div>'
    slide(6, f"""<div class="mid num" style="top:140px;font-size:140px">5</div><div class="mid ttl" style="top:280px">טיטניק</div>
          <div class="mid txt" style="top:410px;font-size:44px">משחזרים את התמונה המפורסמת. כל הקבוצה חייבת להיות בתוכה.</div>
          <div class="pics"><figure><img src="{poster}"><figcaption>המקור</figcaption></figure>
          <figure>{ai_html}<figcaption>ככה זה אמור להיראות</figcaption></figure></div>{courage(5, 990)}""",
          MCSS + f""".pics{{position:absolute;left:80px;right:80px;top:560px;display:flex;gap:26px;direction:rtl;}}
          figure{{margin:0;flex:1;}} figure img,.todo{{width:100%;height:330px;object-fit:cover;border-radius:22px;display:block;background:#2b2622;}}
          .todo{{display:flex;align-items:center;justify-content:center;font:700 38px 'Rubik';color:#a8a29e;}}
          figcaption{{margin-top:8px;text-align:center;font:700 30px 'Rubik';color:#d6d3d1;}}""", step=5)
    # 7 · the reward + the asks
    slide(7, f"""<div class="mid a">איזו משימה הייתם<br>עושים ראשונה?</div><div class="mid b">כתבו את המספר בתגובות</div>
          <div class="mid c">בואו תצרו משחק לפעולה הבאה</div><div class="f">בחינם לגמרי</div>
          <div class="mid l">תשמרו את זה ליום שאין לכם פעולה<br>ותשלחו למדריך או למדריכה שיאהבו את זה</div>
          <div class="mid me">אני אחיה, מדריך בבני עקיבא. בניתי את זה בשביל פעולות כאלה.</div>
          <div class="mid u">הלינק ליצירת משחק בביו</div>""",
          f""".a{{top:200px;font:900 92px/1.08 'Rubik';color:#fff;}}
          .b{{top:430px;font:800 50px 'Rubik';color:{AMBER};}}
          .c{{top:580px;font:900 68px/1.1 'Rubik';color:#fff;}}
          .f{{position:absolute;left:300px;right:300px;top:690px;text-align:center;background:{FIRE};color:#fff;font:900 58px 'Rubik';padding:6px 0;border-radius:18px;}}
          .l{{top:830px;font:700 44px/1.45 'Rubik';color:{BONE};}}
          .me{{top:1010px;font:700 36px/1.4 'Rubik';color:#a8a29e;}}
          .u{{top:1235px;font:800 46px 'Rubik';color:{AMBER};}}""", step=5)
    from PIL import Image
    ims = [Image.open(OUT / f"slide_{i}.png").convert("RGB").resize((360, 450)) for i in range(1, 8)]
    o = Image.new("RGB", (360 * 7, 450))
    for i, im in enumerate(ims):
        o.paste(im, (i * 360, 0))
    o.save(OUT / "contact.jpg", quality=88)
    print("✔ 7 slides")


if __name__ == "__main__":
    main()
