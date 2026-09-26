# -*- coding: utf-8 -*-
import os, sys
from PIL import Image, ImageDraw, ImageFont
from bidi.algorithm import get_display
FONT = os.path.expanduser("~/.claude/toolkits/video-editing/fonts/Rubik.ttf")
W, H = 1080, 1920
ORANGE=(255,87,34); AMBER=(255,179,0); INK=(22,20,18); MUTED=(120,112,104)
BG=(14,13,12); CARD=(28,26,24)

# ── EDIT THIS: the teams that are actually confirmed ──
TEAMS = ["הפוקפוקים", ""]      # slot 2: put the second team name here
TOTAL = 10

def f(sz, bold=True):
    ft = ImageFont.truetype(FONT, sz)
    try: ft.set_variation_by_name("Bold" if bold else "Regular")
    except Exception: pass
    return ft

def draw_board(filled):
    img = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(img)
    ttl = f(74); sub = f(40, False); row = f(46); num = f(38)
    t = get_display("עשרה מקומות")
    d.text(((W-d.textlength(t,font=ttl))/2, 168), t, font=ttl, fill=(255,255,255))
    s = get_display(f"{TOTAL-filled} עדיין פנויים")
    d.text(((W-d.textlength(s,font=sub))/2, 272), s, font=sub, fill=AMBER)
    pz = f(34, False)
    p = get_display("פרס מעל 1,000 ₪ לקבוצה המנצחת")
    pw = d.textlength(p, font=pz)
    d.rounded_rectangle([(W-pw)/2-26, 330, (W+pw)/2+26, 392], radius=18, fill=(40,36,32))
    d.text(((W-pw)/2, 342), p, font=pz, fill=AMBER)
    top, gap, hgt, mx = 430, 16, 112, 96
    for i in range(TOTAL):
        y = top + i*(hgt+gap)
        box = [mx, y, W-mx, y+hgt]
        taken = i < filled
        if taken:
            d.rounded_rectangle(box, radius=22, fill=ORANGE)
            label = TEAMS[i] if i < len(TEAMS) and TEAMS[i] else "קבוצה רשומה"
            col = (255,255,255)
        else:
            d.rounded_rectangle(box, radius=22, outline=(70,64,58), width=3, fill=CARD)
            label = "אתם?"
            col = MUTED
        lt = get_display(label)
        d.text((W-mx-34-d.textlength(lt,font=row), y+hgt/2-32), lt, font=row, fill=col)
        nt = get_display(f"{i+1}")
        d.text((mx+34, y+hgt/2-28), nt, font=num, fill=(255,255,255) if taken else (86,79,72))
    return img

if __name__ == "__main__":
    draw_board(2).save("board_static.png")
    os.makedirs("frames", exist_ok=True)
    # reveal animation: slots land one by one, then the empties settle
    n=0
    for k in range(0, 3):
        for _ in range(10): draw_board(min(k,2)).save(f"frames/{n:03d}.png"); n+=1
    for _ in range(45): draw_board(2).save(f"frames/{n:03d}.png"); n+=1
    print("static + %d frames" % n)
