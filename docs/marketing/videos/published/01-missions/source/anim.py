# -*- coding: utf-8 -*-
import os, math
from PIL import Image, ImageDraw, ImageFont
from bidi.algorithm import get_display
FONT = os.path.expanduser("~/.claude/toolkits/video-editing/fonts/Rubik.ttf")
W,H=1080,1920
ORANGE=(255,87,34); AMBER=(255,179,0); MUTED=(120,112,104); BG=(14,13,12); CARD=(28,26,24)
TEAMS=["הפוקפוקים",""]; TOTAL=10; FPS=30
def f(sz,bold=True):
    ft=ImageFont.truetype(FONT,sz)
    try: ft.set_variation_by_name("Bold" if bold else "Regular")
    except Exception: pass
    return ft
TTL,SUB,PZ,ROW,NUM=f(74),f(40,False),f(34,False),f(46),f(38)
def ease_out_back(t,s=1.70158):
    t-=1; return t*t*((s+1)*t+s)+1
def frame(n):
    img=Image.new("RGB",(W,H),BG); d=ImageDraw.Draw(img)
    def fade(txt,fnt,y,col,t0,dur=8):
        a=max(0.0,min(1.0,(n-t0)/dur))
        if a<=0: return
        c=tuple(int(BG[i]+(col[i]-BG[i])*a) for i in range(3))
        d.text(((W-d.textlength(txt,font=fnt))/2,y),txt,font=fnt,fill=c)
    fade(get_display("עשרה מקומות"),TTL,168,(255,255,255),0)
    fade(get_display("8 עדיין פנויים"),SUB,272,AMBER,6)
    if n>=12:
        p=get_display("פרס מעל 1,000 ₪ לקבוצה המנצחת"); pw=d.textlength(p,font=PZ)
        a=max(0.0,min(1.0,(n-12)/8))
        d.rounded_rectangle([(W-pw)/2-26,330,(W+pw)/2+26,392],radius=18,
                            fill=tuple(int(BG[i]+((40,36,32)[i]-BG[i])*a) for i in range(3)))
        d.text(((W-pw)/2,342),p,font=PZ,fill=tuple(int(BG[i]+(AMBER[i]-BG[i])*a) for i in range(3)))
    top,gap,hgt,mx=430,16,112,96
    for i in range(TOTAL):
        t0=22+i*4
        if n<t0: continue
        p=min(1.0,(n-t0)/11)
        taken=i<len(TEAMS)
        y=top+i*(hgt+gap)
        if taken:
            e=ease_out_back(p)                      # slide in from the right with overshoot
            off=(1-e)*260
            box=[mx+off,y,W-mx+off,y+hgt]
            flash=max(0.0,1-(n-t0)/9)               # brief bright pop as it lands
            col=tuple(min(255,int(ORANGE[c]+(255-ORANGE[c])*flash*0.55)) for c in range(3))
            d.rounded_rectangle(box,radius=22,fill=col)
            lbl=TEAMS[i] if TEAMS[i] else "קבוצה רשומה"
            lt=get_display(lbl)
            d.text((W-mx-34-d.textlength(lt,font=ROW)+off,y+hgt/2-32),lt,font=ROW,fill=(255,255,255))
            d.text((mx+34+off,y+hgt/2-28),get_display(f"{i+1}"),font=NUM,fill=(255,255,255))
        else:
            a=p
            d.rounded_rectangle([mx,y,W-mx,y+hgt],radius=22,width=3,
                outline=tuple(int(BG[c]+((70,64,58)[c]-BG[c])*a) for c in range(3)),
                fill=tuple(int(BG[c]+(CARD[c]-BG[c])*a) for c in range(3)))
            # gentle breathing on the open slots once they have settled
            br=0.0 if n<t0+12 else (math.sin((n-t0-12)/9.0)*0.5+0.5)*0.35
            mc=tuple(int(MUTED[c]+(AMBER[c]-MUTED[c])*br*a) for c in range(3))
            lt=get_display("אתם?")
            d.text((W-mx-34-d.textlength(lt,font=ROW),y+hgt/2-32),lt,font=ROW,fill=mc)
            d.text((mx+34,y+hgt/2-28),get_display(f"{i+1}"),font=NUM,
                   fill=tuple(int(BG[c]+((86,79,72)[c]-BG[c])*a) for c in range(3)))
    return img
os.makedirs("af",exist_ok=True)
N=130
for n in range(N): frame(n).save(f"af/{n:03d}.png")
print(f"{N} frames = {N/FPS:.2f}s")
