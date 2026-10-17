# -*- coding: utf-8 -*-
"""The screen he is about to press: 1080x2340, light app theme, one huge orange button."""
import sys
from pathlib import Path
ENG = Path(r"C:\Users\savir\Projects\Rushpoint\.claude\skills\reel-studio\engine")
sys.path.insert(0, str(ENG))
from lib.html_render import page, render
W, H = 1080, 2340
BX, BY, BR = 594, 1450, 340      # button centre and radius (under his fingertip at the press)

def ui(pressed: bool):
    col = "#D9441A" if pressed else "#FF5722"
    sh = "0 6px 0 #b83c14, 0 18px 50px rgba(255,87,34,.45)" if not pressed else "0 2px 0 #9c3311, 0 6px 18px rgba(255,87,34,.4)"
    dy = 6 if pressed else 0
    css = f"""body{{background:#F5EFE6;font-family:'Rubik';direction:rtl;}}
    .bar{{position:absolute;left:0;right:0;top:0;height:230px;background:#1C1917;}}
    .bar .t{{position:absolute;right:70px;top:108px;font:800 68px 'Rubik';color:#F5EFE6;}}
    .bar .live{{position:absolute;left:70px;top:118px;font:700 44px 'Rubik';color:#1C1917;background:#FFB300;border-radius:999px;padding:6px 34px;}}
    .k{{position:absolute;left:0;right:0;top:330px;text-align:center;font:700 74px 'Rubik';color:#57534e;}}
    .n{{position:absolute;left:0;right:0;top:420px;text-align:center;font:900 420px/1 'Rubik';color:#1C1917;letter-spacing:-8px;direction:ltr;}}
    .s{{position:absolute;left:0;right:0;top:850px;text-align:center;font:800 92px 'Rubik';color:#1C1917;}}
    .ring{{position:absolute;left:{BX-BR-46}px;top:{BY-BR-46}px;width:{2*BR+92}px;height:{2*BR+92}px;border-radius:50%;background:rgba(255,87,34,.16);}}
    .btn{{position:absolute;left:{BX-BR}px;top:{BY-BR+dy}px;width:{2*BR}px;height:{2*BR}px;border-radius:50%;background:{col};
      box-shadow:{sh};display:flex;align-items:center;justify-content:center;flex-direction:column;}}
    .btn .a{{font:900 150px/1 'Rubik';color:#fff;}}
    .btn .b{{font:700 60px 'Rubik';color:#ffe3d6;margin-top:14px;}}
    .f{{position:absolute;left:0;right:0;top:1920px;text-align:center;font:700 62px 'Rubik';color:#78716c;}}"""
    body = f"""<div class="bar"><div class="t">המירוץ לציון</div><div class="live">מוכן</div></div>
    <div class="k">ממתינים בנקודת הזינוק</div><div class="n">350</div><div class="s">תלמידים</div>
    <div class="ring"></div><div class="btn"><div class="a">התחל</div><div class="b">את המרוץ</div></div>
    <div class="f">לחיצה אחת מפעילה את כל הטלפונים</div>"""
    return page(body, css, W, H, "#F5EFE6")

for name, p in (("ui_idle", False), ("ui_pressed", True)):
    render(ui(p), Path(__file__).parent / f"{name}.png", W, H)
    print(name)
