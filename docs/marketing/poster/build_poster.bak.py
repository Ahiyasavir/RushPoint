# -*- coding: utf-8 -*-
"""המירוץ למיליון — neighbourhood recruitment poster. Philosophy: Contour Kinetics.
v19 — no dashes in copy, blocks sized to their type, prominent RushPoint bar,
more (thinner) tear-off strips whose text spans most of the strip."""
import os, math, numpy as np
from PIL import Image, ImageDraw, ImageFont
from bidi.algorithm import get_display
import segno

OUT = os.path.dirname(os.path.abspath(__file__))
SS = 2
W, H = 2480 * SS, 3508 * SS
M = 172 * SS
TZ = int(H * 0.808)

PHONE = "055 964 1404"
WA = "https://wa.me/972559641404?text=%D7%9E%D7%99%D7%A8%D7%95%D7%A5"

BONE      = (244, 236, 222)
BONE_DEEP = (238, 229, 212)
INK       = (25, 23, 19)
ORANGE    = (216, 72, 22)
ORANGE_DK = (150, 45, 11)
GREEN     = (72, 92, 74)

FD = "C:/Windows/Fonts/"
CFD = r"C:\Users\savir\AppData\Roaming\Claude\local-agent-mode-sessions\skills-plugin\4f382392-26bd-48f4-8d04-454ab8137a93\56bb1f00-8a70-4d1b-b7dc-e858268f2abf\skills\canvas-design\canvas-fonts"
def cf(n, s): return ImageFont.truetype(os.path.join(CFD, n), s)
def wf(n, s): return ImageFont.truetype(FD + n, s)
f_head  = lambda s: wf("ahronbd.ttf", s)
f_bold  = lambda s: wf("segoeuib.ttf", s)
f_sb    = lambda s: wf("seguisb.ttf", s)
f_reg   = lambda s: wf("segoeui.ttf", s)
f_mono  = lambda s: cf("JetBrainsMono-Regular.ttf", s)
f_monob = lambda s: cf("JetBrainsMono-Bold.ttf", s)
f_david = lambda s: wf("davidbd.ttf", s)
def He(s): return get_display(s, base_dir='R')

img = Image.new("RGB", (W, H), BONE)
draw = ImageDraw.Draw(img, "RGBA")
draw.rectangle([0, 0, int(W * 0.40), H], fill=BONE_DEEP)

# ---- CONTOUR FIELD --------------------------------------------------
cont = Image.new("RGBA", (W, H), (0, 0, 0, 0))
cd = ImageDraw.Draw(cont, "RGBA")
def family(cx, cy, n, step, seed, squash=0.9, max_r=None, tone="mix"):
    rng = np.random.default_rng(int(seed*1000))
    ph = rng.uniform(0, 2*math.pi, 6); th = np.linspace(0, 2*math.pi, 900)
    dr = rng.uniform(-0.35, 0.35, 2) * step
    for i in range(1, n):
        crowd = 0.55 + 0.45*abs(math.sin(i*0.17 + seed))
        r = i*step*crowd
        if max_r and r > max_r: break
        rad = r*(1 + 0.075*np.sin(3*th+ph[0]) + 0.045*np.sin(5*th+ph[1]+i*0.03)
                   + 0.028*np.sin(2*th+ph[2]) + 0.015*np.sin(7*th+ph[3]))
        x = cx + dr[0]*i/n + rad*np.cos(th)
        y = cy + dr[1]*i/n + rad*np.sin(th)*squash
        idx = (i % 5 == 0)
        col = ((*GREEN, 50 if not idx else 82) if tone == "green"
               else ((*INK, 38) if not idx else (*INK, 80)))
        cd.line(list(zip(x.tolist(), y.tolist())), fill=col, width=(5 if idx else 2), joint="curve")
CX, CY = int(W*0.30), int(H*0.275)
family(CX, CY, 170, 37*SS, 3.1, 0.88, max_r=int(H*1.05))
family(int(W*0.02), int(H*0.05), 60, 44*SS, 8.4, 0.9, max_r=int(W*0.5), tone="green")
family(int(W*0.99), int(H*0.18), 72, 50*SS, 2.7, 0.85, max_r=int(W*0.55), tone="green")
family(int(W*0.08), int(H*0.99), 82, 45*SS, 5.9, 0.8, max_r=int(W*0.62), tone="green")
family(int(W*1.06), int(H*0.9), 60, 52*SS, 1.4, 0.85, max_r=int(W*0.45), tone="green")
img = Image.alpha_composite(img.convert("RGBA"), cont).convert("RGB")
draw = ImageDraw.Draw(img, "RGBA")

# ---- ROUTE --------------------------------------------------------
def catmull(p, k=40):
    o=[]
    for i in range(len(p)-1):
        p0,p1,p2,p3=p[max(i-1,0)],p[i],p[i+1],p[min(i+2,len(p)-1)]
        for t in np.linspace(0,1,k):
            t2,t3=t*t,t*t*t
            x=0.5*((2*p1[0])+(-p0[0]+p2[0])*t+(2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2+(-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3)
            y=0.5*((2*p1[1])+(-p0[1]+p2[1])*t+(2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2+(-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3)
            o.append((x,y))
    return o
anchors = [(W*0.30, H*0.80), (W*0.22, H*0.73), (W*0.35, H*0.63),
           (W*0.19, H*0.52), (W*0.34, H*0.42), (W*0.22, H*0.35),
           (CX + 4*SS, CY + 8*SS)]
path = catmull(anchors)
seg=[0.0]
for a,b in zip(path,path[1:]): seg.append(seg[-1]+math.hypot(b[0]-a[0],b[1]-a[1]))
total=seg[-1]
def at(s):
    for i in range(1,len(seg)):
        if seg[i]>=s:
            f=(s-seg[i-1])/max(seg[i]-seg[i-1],1e-6)
            return (path[i-1][0]+f*(path[i][0]-path[i-1][0]), path[i-1][1]+f*(path[i][1]-path[i-1][1]))
    return path[-1]
d,g = 42*SS, 24*SS
s=0.0
while s<total:
    a,b = at(s), at(min(s+d,total))
    if a[1] < TZ-18*SS and b[1] < TZ-18*SS:
        draw.line([a,b], fill=ORANGE, width=13*SS)
    s += d+g

frac = [0.11, 0.30, 0.49, 0.68, 0.87]
LET = ["מ","י","ר","ו","ץ"]
for k, fr in enumerate(frac):
    px, py = at(fr*total)
    R = 46*SS
    draw.ellipse([px-R,py-R,px+R,py+R], fill=BONE, outline=ORANGE, width=10*SS)
    fn = f_monob(46*SS); tb = draw.textbbox((0,0), str(k+1), font=fn)
    draw.text((px-(tb[2]-tb[0])/2, py-(tb[3]-tb[1])/2-tb[1]), str(k+1), font=fn, fill=INK)
    draw.text((px + 78*SS, py), LET[k], font=f_david(58*SS), fill=ORANGE_DK, anchor="mm")

# terrain = jackpot map: a pot gauge climbing the left edge
GX = M
draw.text((GX, H*0.30), He("הקופה"), font=f_sb(32*SS), fill=(*ORANGE_DK,230))
for (gy, amt) in [(0.66,"200,000"), (0.52,"400,000"), (0.375,"600,000"), (0.235,"800,000")]:
    yy = H*gy
    draw.line([(GX, yy),(GX+30*SS, yy)], fill=(*INK,120), width=3*SS)
    draw.text((GX+44*SS, yy), amt, font=f_mono(32*SS), fill=(*INK,170), anchor="lm")

draw.polygon([(CX, CY-40*SS),(CX-32*SS, CY+22*SS),(CX+32*SS, CY+22*SS)], fill=INK)
draw.text((CX+54*SS, CY-6*SS),  "1,000,000", font=f_monob(48*SS), fill=INK, anchor="lm")
draw.text((CX+54*SS, CY+48*SS), He("הקופה המלאה"), font=f_sb(27*SS), fill=(*INK,165), anchor="lm")

# =====================================================================
RIGHT = W - M
def tl(s, font): return draw.textlength(He(s), font=font)
def rtext(y, s, font, fill=INK, tracking=0, right=RIGHT):
    disp = He(s)
    if not tracking:
        draw.text((right - draw.textlength(disp, font=font), y), disp, font=font, fill=fill); return
    ws=[draw.textlength(c, font=font) for c in disp]; x = right-(sum(ws)+tracking*(len(disp)-1))
    for ch,w in zip(disp,ws): draw.text((x,y), ch, font=font, fill=fill); x += w+tracking
def ctext(cx, y, s, font, fill=INK):
    disp=He(s); draw.text((cx-draw.textlength(disp, font=font)/2, y), disp, font=font, fill=fill)
def Y(f): return int(H * f)

# ---- SCARCITY block, sized to its type -----------------------------
l1, f1 = "רק 5 תאריכים ראשונים", f_bold(52*SS)
l2, f2 = "במחיר מייסדים", f_sb(42*SS)
pad = 40*SS
bw = max(tl(l1, f1), tl(l2, f2)) + 2*pad
bh = 200*SS
bx0, by0 = M, Y(0.104)
draw.rectangle([bx0, by0, bx0+bw, by0+bh], fill=ORANGE)
draw.rectangle([bx0+10*SS, by0+10*SS, bx0+bw-10*SS, by0+bh-10*SS], outline=(*BONE,150), width=2*SS)
ctext(bx0+bw/2, by0 + 34*SS,  l1, f1, fill=BONE)
ctext(bx0+bw/2, by0 + 116*SS, l2, f2, fill=BONE)

# marginalia — small compass, well clear of the scarcity block and the gauge
ox, oy, r = M + 40*SS, M + 76*SS, 34*SS
for a in range(0,360,45):
    aa=math.radians(a-90)
    draw.line([(ox,oy),(ox+r*math.cos(aa),oy+r*math.sin(aa))], fill=(*INK,110), width=2*SS)
draw.line([(ox,oy),(ox,oy-r)], fill=ORANGE, width=4*SS)
draw.text((ox, oy-r-20*SS), "N", font=f_monob(20*SS), fill=INK, anchor="mm")

# kicker
draw.line([(RIGHT-560*SS, M-4*SS),(RIGHT, M-4*SS)], fill=INK, width=3*SS)
rtext(M + 8*SS, "תצפית שדה · ירושלים", f_reg(34*SS), tracking=8*SS)

# HEADLINE
HS = 336*SS
rtext(Y(0.086),  "המירוץ",  f_head(HS))
rtext(Y(0.193),  "למיליון", f_head(HS), fill=ORANGE)
uy = Y(0.286)
draw.line([(RIGHT-tl("למיליון", f_head(HS)), uy),(RIGHT, uy)], fill=ORANGE, width=9*SS)

# RushPoint bar — prominent, sized tight around its own type
rbx0, rby0 = int(W*0.40), Y(0.300)
rpf1, rpf2 = f_bold(58*SS), f_sb(34*SS)
rph = 30*SS + 68*SS + 14*SS + 44*SS + 26*SS
draw.rectangle([rbx0, rby0, RIGHT, rby0+rph], fill=INK)
ctext((rbx0+RIGHT)/2, rby0 + 30*SS, "רץ על RushPoint", rpf1, fill=BONE)
ctext((rbx0+RIGHT)/2, rby0 + 30*SS + 68*SS + 14*SS, "מערכת מקצועית למירוצי שטח", rpf2, fill=BONE)
rby1 = rby0 + rph

# sub
rtext(Y(0.372), "יום הולדת אקשן בחוץ · לגילאי 10 עד 15", f_bold(76*SS))
# explaining sentence
rtext(Y(0.424), "מתחלקים לצוותים ורצים בין תחנות עם משימות בטלפון.", f_reg(54*SS))
rtext(Y(0.456), "כל משימה מקפיצה את הקופה המשותפת למעלה.", f_reg(54*SS))
# spec
draw.line([(RIGHT-1120*SS, Y(0.502)-18*SS),(RIGHT, Y(0.502)-18*SS)], fill=INK, width=2*SS)
rtext(Y(0.506), "עד 50 משתתפים   ·   משך זמן גמיש", f_sb(46*SS))
rtext(Y(0.540), "המשחק מותאם אישית לאירוע שלכם", f_sb(46*SS))

# THE TWIST
draw.line([(RIGHT-1240*SS, Y(0.582)-28*SS),(RIGHT, Y(0.582)-28*SS)], fill=ORANGE, width=5*SS)
rtext(Y(0.586), "חמש התחנות שעל המפה מסתירות מילה.", f_bold(60*SS))
rtext(Y(0.626), "אמרו אותה בטלפון, וזה מחיר המייסדים שלכם.", f_reg(50*SS))

# safety
rtext(Y(0.664), "אזור בטוח מסומן מראש · מבוגר מלווה · אתם רק מביאים עוגה.", f_reg(42*SS))

# =====================================================================
#                CTA BLOCK  (phone + embedded QR) — sized to its own type
# =====================================================================
def ltext_right(right_x, y, s, font, fill, tracking=0):
    ws = [draw.textlength(c, font=font) for c in s]
    total = sum(ws) + tracking*(len(s)-1)
    x = right_x - total
    for ch, w in zip(s, ws):
        draw.text((x, y), ch, font=font, fill=fill); x += w + tracking
    return total

def glyph_h(font, s="Aבגהקך0"):
    b = font.getbbox(s)
    return b[3] - b[1]

def tl2(s, font): return draw.textlength(s, font=font)

# ---- CTA text block: narrow, sized to its own three lines ----------
label_s = "לתיאום תאריך · שיחה קצרה, בלי התחייבות"
code_s  = "המילה מהמפה היא הקוד שאומרים בשיחה"
label_f = f_sb(38*SS)
phone_f = f_head(120*SS)
code_f  = f_sb(28*SS)
pad_t, gap_t = 34*SS, 22*SS
track = 5*SS

label_h, phone_h, code_h = glyph_h(label_f), glyph_h(phone_f), glyph_h(code_f)
text_col_h = label_h + gap_t + phone_h + gap_t + code_h
phone_w = sum(tl2(c, phone_f) for c in PHONE) + track*(len(PHONE)-1)
text_w  = max(tl2(He(label_s), label_f), phone_w, tl2(He(code_s), code_f)) + 2*pad_t
text_h  = text_col_h + 2*pad_t

text_x1, text_y0 = RIGHT, Y(0.701)
text_x0 = text_x1 - text_w
draw.rounded_rectangle([text_x0, text_y0, text_x1, text_y0+text_h], radius=18*SS, fill=INK)
tr = text_x1 - pad_t
tyy = text_y0 + pad_t
rtext(tyy, label_s, label_f, fill=BONE, right=tr)
tyy += label_h + gap_t
ltext_right(tr, tyy, PHONE, phone_f, BONE, tracking=track)
tyy += phone_h + gap_t
rtext(tyy, code_s, code_f, fill=BONE, right=tr)

# ---- QR block: its own block, sitting just left of the text block --
QS = 212*SS   # a bit bigger than before, still budget-checked against TZ
qc_s = "סרקו לוואטסאפ עם הקוד"
qc_f = f_sb(25*SS)
pad_q, cap_gap = 26*SS, 16*SS
qc_h = glyph_h(qc_f)
q_w = QS + 2*pad_q
q_h = QS + cap_gap + qc_h + 2*pad_q

q_x1 = text_x0 - 46*SS
q_x0 = q_x1 - q_w
q_y0 = text_y0 + (text_h - q_h)//2
draw.rounded_rectangle([q_x0, q_y0, q_x1, q_y0+q_h], radius=18*SS, fill=INK)

qr = segno.make(WA, error='h')
qp = os.path.join(OUT, "_qr.png")
qr.save(qp, scale=20, dark="#191713", light="#f4ecde", border=1)
qim = Image.open(qp).convert("RGB").resize((QS, QS), Image.NEAREST)
qx, qy = int(q_x0 + pad_q), int(q_y0 + pad_q)
img.paste(qim, (qx, qy)); draw = ImageDraw.Draw(img, "RGBA")
draw.rectangle([qx,qy,qx+QS,qy+QS], outline=BONE, width=3*SS)
ctext(qx+QS/2, qy+QS+cap_gap, qc_s, qc_f, fill=BONE)

# =====================================================================
#                        TEAR-OFF STRIPS  (many, thin)
# =====================================================================
draw.rectangle([M//2+2*SS, TZ, W-M//2-2*SS, H-M//2-2*SS], fill=BONE)
draw.line([(M, TZ),(W-M, TZ)], fill=INK, width=4*SS)
rtext(TZ - 40*SS, "גזרו · קחו · התקשרו", f_sb(30*SS))
draw.text((M, TZ - 36*SS), "↓ ↓ ↓", font=f_reg(28*SS), fill=ORANGE)
NST = 11
sw = (W-2*M)/NST
sh = int(H - M*0.5 - TZ - 34*SS); sbot = int(H - M*0.5)
for i in range(NST):
    x = M + i*sw
    if i % 2: draw.rectangle([x, TZ+2*SS, x+sw, sbot], fill=BONE_DEEP)
    if i:
        for yy in range(int(TZ)+12*SS, sbot, 30*SS):
            draw.line([(x,yy),(x,yy+16*SS)], fill=(*INK,150), width=2*SS)
    tmp = Image.new("RGBA", (sh, int(sw)), (0,0,0,0)); td = ImageDraw.Draw(tmp)
    td.text((sh*0.07, sw*0.5), He("המירוץ למיליון"), font=f_sb(38*SS), fill=INK, anchor="lm")
    td.text((sh*0.58, sw*0.5), PHONE, font=f_monob(32*SS), fill=ORANGE_DK, anchor="lm")
    strip = tmp.rotate(-90, expand=True)
    img.paste(strip, (int(x+(sw-strip.width)/2), int(TZ+22*SS)), strip)

fy = H - int(M*0.42)
rtext(fy - 2*SS, "מופעל על RushPoint · מערכת מקצועית למירוצי שטח", f_sb(24*SS), fill=(*INK,170))
draw.text((M, fy), "SHEET RP 01 · REV A", font=f_mono(22*SS), fill=(*INK,150))

ndv = int(W*0.40)
draw.line([(ndv, M//2),(ndv, TZ)], fill=(*INK,50), width=2*SS)
for yy in range(M, int(TZ), 230*SS):
    draw.line([(ndv-10*SS, yy),(ndv+10*SS, yy)], fill=(*INK,50), width=2*SS)
draw.rectangle([M//2, M//2, W-M//2, H-M//2], outline=(*INK,105), width=2*SS)

out = img.resize((W//SS, H//SS), Image.LANCZOS)
png = os.path.join(OUT, "mirotz-lamillion-poster.png")
pdf = os.path.join(OUT, "mirotz-lamillion-poster.pdf")
out.save(png, dpi=(300,300)); out.save(pdf, "PDF", resolution=300.0)
os.remove(qp)
print("wrote", png, "and", pdf)
