# -*- coding: utf-8 -*-
"""המירוץ למיליון — neighbourhood recruitment poster. Philosophy: Contour Kinetics."""
import os, math, numpy as np
from PIL import Image, ImageDraw, ImageFont
from bidi.algorithm import get_display
import segno

OUT = os.path.dirname(os.path.abspath(__file__))
SS = 2
W, H = 2480 * SS, 3508 * SS          # A4 @ 300dpi, supersampled
M = 190 * SS
TZ = int(3508 * SS * 0.885)          # tear-off line

PHONE = "055-964-1404"
WA = "https://wa.me/972559641404?text=%D7%9E%D7%99%D7%A8%D7%95%D7%A5"

# ---- palette (Contour Kinetics: four notes) --------------------------------
BONE      = (244, 236, 223)
BONE_DEEP = (240, 231, 215)
INK       = (28, 26, 22)
ORANGE    = (222, 78, 26)
ORANGE_DK = (168, 52, 12)
GREEN     = (74, 96, 78)

FD = "C:/Windows/Fonts/"
CANVAS_FONTS = r"C:\Users\savir\AppData\Roaming\Claude\local-agent-mode-sessions\skills-plugin\4f382392-26bd-48f4-8d04-454ab8137a93\56bb1f00-8a70-4d1b-b7dc-e858268f2abf\skills\canvas-design\canvas-fonts"
def cf(name, size): return ImageFont.truetype(os.path.join(CANVAS_FONTS, name), size)
def wf(name, size): return ImageFont.truetype(FD + name, size)

f_head  = lambda s: wf("ahronbd.ttf", s)   # Aharoni Bold — heavy Israeli display
f_bold  = lambda s: wf("segoeuib.ttf", s)
f_sb    = lambda s: wf("seguisb.ttf", s)
f_reg   = lambda s: wf("segoeui.ttf", s)
f_hemn  = lambda s: wf("segoeui.ttf", s)   # tracked -> instrument-label feel
f_mono  = lambda s: cf("JetBrainsMono-Regular.ttf", s)   # Latin / digits only
f_monob = lambda s: cf("JetBrainsMono-Bold.ttf", s)
f_david = lambda s: wf("davidbd.ttf", s)

def He(s): return get_display(s, base_dir='R')

# =====================================================================
img = Image.new("RGB", (W, H), BONE)
draw = ImageDraw.Draw(img, "RGBA")
draw.rectangle([0, 0, int(W * 0.36), H], fill=BONE_DEEP)   # left survey-panel

# ---- 1. CONTOUR FIELD -------------------------------------------------
cont = Image.new("RGBA", (W, H), (0, 0, 0, 0))
cd = ImageDraw.Draw(cont, "RGBA")

def contour_family(cx, cy, n_rings, base_step, seed, squash=0.92,
                   amp=(0.075, 0.045, 0.028), max_r=None, tone="mix"):
    rng = np.random.default_rng(int(seed * 1000))
    ph = rng.uniform(0, 2 * math.pi, 6)
    th = np.linspace(0, 2 * math.pi, 900)
    drift = rng.uniform(-0.35, 0.35, 2) * base_step
    for i in range(1, n_rings):
        crowd = 0.55 + 0.45 * abs(math.sin(i * 0.17 + seed))
        r = i * base_step * crowd
        if max_r and r > max_r: break
        rad = r * (1
                   + amp[0] * np.sin(3 * th + ph[0])
                   + amp[1] * np.sin(5 * th + ph[1] + i * 0.03)
                   + amp[2] * np.sin(2 * th + ph[2])
                   + 0.015 * np.sin(7 * th + ph[3]))
        x = cx + drift[0] * i / n_rings + rad * np.cos(th)
        y = cy + drift[1] * i / n_rings + rad * np.sin(th) * squash
        pts = list(zip(x.tolist(), y.tolist()))
        idx = (i % 5 == 0)
        if tone == "green":
            col = (*GREEN, 44 if not idx else 70)
        else:
            col = (*INK, 30) if not idx else (*INK, 60)
        cd.line(pts, fill=col, width=(4 if idx else 2), joint="curve")

CX, CY = int(W * 0.42), int(H * 0.32)
contour_family(CX, CY, 150, 40 * SS, 3.1, 0.9,  max_r=int(H * 0.95))
contour_family(int(W * 0.06), int(H * 0.90), 70, 46 * SS, 7.7, 0.8, max_r=int(W * 0.5), tone="green")
contour_family(int(W * 1.02), int(H * 0.86), 60, 52 * SS, 1.9, 0.85, max_r=int(W * 0.42), tone="green")
contour_family(int(W * -0.02), int(H * 0.10), 55, 50 * SS, 5.2, 0.9, max_r=int(W * 0.4), tone="green")

img = Image.alpha_composite(img.convert("RGBA"), cont).convert("RGB")
draw = ImageDraw.Draw(img, "RGBA")

# ---- 2. ROUTE -------------------------------------------------------
def catmull(p, samples=26):
    out = []
    for i in range(len(p) - 1):
        p0 = p[max(i - 1, 0)]; p1 = p[i]; p2 = p[i + 1]; p3 = p[min(i + 2, len(p) - 1)]
        for t in np.linspace(0, 1, samples):
            t2, t3 = t * t, t * t * t
            x = 0.5 * ((2*p1[0]) + (-p0[0]+p2[0])*t + (2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2 + (-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3)
            y = 0.5 * ((2*p1[1]) + (-p0[1]+p2[1])*t + (2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2 + (-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3)
            out.append((x, y))
    return out

anchors = [
    (W * 0.31, H * 0.875), (W * 0.37, H * 0.82), (W * 0.28, H * 0.73),
    (W * 0.41, H * 0.63),  (W * 0.30, H * 0.53), (W * 0.45, H * 0.44),
    (W * 0.40, H * 0.375), (CX - 8 * SS, CY + 20 * SS),
]
path = catmull(anchors, 40)
seg = [0.0]
for a, b in zip(path, path[1:]):
    seg.append(seg[-1] + math.hypot(b[0]-a[0], b[1]-a[1]))
total = seg[-1]
def at(s):
    for i in range(1, len(seg)):
        if seg[i] >= s:
            f = (s - seg[i-1]) / max(seg[i]-seg[i-1], 1e-6)
            return (path[i-1][0] + f*(path[i][0]-path[i-1][0]),
                    path[i-1][1] + f*(path[i][1]-path[i-1][1]))
    return path[-1]

dash, gap = 34 * SS, 20 * SS
s = 0.0
while s < total:
    a, b = at(s), at(min(s + dash, total))
    if a[1] < TZ - 14 * SS and b[1] < TZ - 14 * SS:
        draw.line([a, b], fill=ORANGE, width=9 * SS)
    s += dash + gap

# ---- 3. STATIONS + hidden word (מ-י-ר-ו-ץ) ------------------------
frac = [0.09, 0.29, 0.49, 0.67, 0.85]
letters = ["מ", "י", "ר", "ו", "ץ"]
for k, fr in enumerate(frac):
    px, py = at(fr * total)
    R = 30 * SS
    draw.ellipse([px-R, py-R, px+R, py+R], fill=BONE, outline=ORANGE, width=6*SS)
    fn = f_monob(30 * SS)
    tb = draw.textbbox((0, 0), str(k+1), font=fn)
    draw.text((px-(tb[2]-tb[0])/2, py-(tb[3]-tb[1])/2 - tb[1]), str(k+1), font=fn, fill=INK)
    lx, ly = px - 82 * SS, py - 6 * SS
    draw.line([(px - R - 6*SS, py), (lx + 24*SS, ly)], fill=(*ORANGE_DK, 150), width=2*SS)
    draw.text((lx, ly), letters[k], font=f_david(46 * SS), fill=ORANGE_DK, anchor="mm")

rng = np.random.default_rng(11)
for _ in range(4):
    dx = rng.uniform(W*0.05, W*0.30); dy = rng.uniform(H*0.44, H*0.72)
    draw.text((dx, dy), rng.choice(list("אבגדהכלנספקשת")), font=f_david(30*SS),
              fill=(*INK, 55), anchor="mm")

# summit
draw.polygon([(CX, CY-26*SS), (CX-22*SS, CY+16*SS), (CX+22*SS, CY+16*SS)], fill=INK)
draw.text((CX - 40*SS, CY - 2*SS),  "1,000,000", font=f_mono(32*SS), fill=INK, anchor="rm")
draw.text((CX - 40*SS, CY + 30*SS), "PT",        font=f_mono(20*SS), fill=(*INK, 150), anchor="rm")

# =====================================================================
#                            TYPOGRAPHY
# =====================================================================
RIGHT = W - M

def rtext(y, s, font, fill=INK, tracking=0, right=RIGHT):
    disp = He(s)
    if not tracking:
        w = draw.textlength(disp, font=font)
        draw.text((right - w, y), disp, font=font, fill=fill); return
    widths = [draw.textlength(ch, font=font) for ch in disp]
    x = right - (sum(widths) + tracking * (len(disp) - 1))
    for ch, w in zip(disp, widths):
        draw.text((x, y), ch, font=font, fill=fill); x += w + tracking

def ctext(cx, y, s, font, fill=INK):
    disp = He(s); w = draw.textlength(disp, font=font)
    draw.text((cx - w/2, y), disp, font=font, fill=fill)

# --- top marginalia ---
draw.line([(RIGHT - 520*SS, M - 12*SS), (RIGHT, M - 12*SS)], fill=INK, width=3*SS)
rtext(M, "תצפית שדה · ירושלים", f_hemn(28*SS), tracking=7*SS)
ox, oy, r = M + 46*SS, M + 132*SS, 50*SS
for ang in range(0, 360, 45):
    a = math.radians(ang - 90)
    draw.line([(ox, oy), (ox + r*math.cos(a), oy + r*math.sin(a))], fill=(*INK, 120), width=2*SS)
draw.line([(ox, oy), (ox, oy - r)], fill=ORANGE, width=4*SS)
draw.text((ox, oy - r - 24*SS), "N", font=f_monob(24*SS), fill=INK, anchor="mm")
draw.text((ox - r, oy + r + 30*SS), "31°46'N  35°13'E", font=f_mono(22*SS), fill=(*INK, 150))

# --- headline ---
hy = M + 180*SS
HS = 322*SS
rtext(hy,          "המירוץ",  f_head(HS))
rtext(hy + 344*SS, "למיליון", f_head(HS), fill=ORANGE)
_ruley = hy + 344*SS + 336*SS
draw.line([(RIGHT - draw.textlength(He("למיליון"), font=f_head(HS)), _ruley),
           (RIGHT, _ruley)], fill=ORANGE, width=6*SS)

# --- resolve line ---
ry = _ruley + 74*SS
rtext(ry,         "יום הולדת אקשן בחוץ לגילאי 10\u201315.", f_bold(58*SS))
rtext(ry + 82*SS, "צוותים, משימות בטלפון, מרדף אחרי מיליון.", f_reg(54*SS), fill=(*INK, 225))

# --- spec strip ---
spy = ry + 200*SS
draw.line([(RIGHT - 1000*SS, spy - 14*SS), (RIGHT, spy - 14*SS)], fill=INK, width=2*SS)
rtext(spy, "90 דקות  ·  3\u20135 בצוות  ·  גיל 10\u201315  ·  עד 30 משתתפים",
      f_hemn(30*SS), tracking=1*SS)

# --- how it works (for anyone who doesn't know the format) ---
hwy = spy + 118*SS
steps = ["מתחלקים לצוותים של 3–5",
         "רצים בין תחנות עם משימות בטלפון",
         "הצוות הכי מהיר לוקח את המיליון"]
for i, txt in enumerate(steps):
    yy = hwy + i * 66*SS
    cxr, cyr, rr = RIGHT - 22*SS, yy + 22*SS, 21*SS
    draw.ellipse([cxr-rr, cyr-rr, cxr+rr, cyr+rr], outline=ORANGE, width=4*SS)
    draw.text((cxr, cyr), str(i+1), font=f_monob(24*SS), fill=INK, anchor="mm")
    rtext(yy, txt, f_reg(36*SS), fill=(*INK, 225), right=RIGHT - 68*SS)

# =====================================================================
#          THE TWIST — the poster is a playable teaser
# =====================================================================
ty = hwy + 3*66*SS + 96*SS
draw.line([(RIGHT - 1180*SS, ty - 26*SS), (RIGHT, ty - 26*SS)], fill=ORANGE, width=4*SS)
rtext(ty,          "חמש התחנות שעל המפה מסתירות מילה אחת.", f_bold(50*SS))
rtext(ty + 74*SS,  "קראו אותה לפי הסדר. אמרו אותה בטלפון —", f_reg(44*SS), fill=(*INK, 225))
rtext(ty + 134*SS, "ותקבלו מחיר מייסדים על היום הולדת.",   f_reg(44*SS), fill=(*INK, 225))

chip_txt = "מחיר מייסדים · 5 האירועים הראשונים בשכונה"
cfont = f_sb(32*SS)
cw = draw.textlength(He(chip_txt), font=cfont) + 78*SS
ch = 92*SS
cx0, cy0 = RIGHT - cw, ty + 208*SS
draw.rounded_rectangle([cx0, cy0, cx0+cw, cy0+ch], radius=12*SS, fill=INK)
ctext(cx0 + cw/2, cy0 + 22*SS, chip_txt, cfont, fill=BONE)

pgy = cy0 + ch + 58*SS
rtext(pgy,         "הכול רץ בתוך אזור בטוח שמסומן מראש, עם התראה", f_reg(37*SS), fill=(*INK, 215))
rtext(pgy + 54*SS, "אם צוות מתרחק. מבוגר מלווה. אתם רק מביאים עוגה.", f_reg(37*SS), fill=(*INK, 215))
rtext(pgy + 148*SS, "כולל: הפעלה מלאה · לוח תוצאות חי · טקס סיום · כרטיסי סטורי",
      f_reg(31*SS), fill=(*INK, 210))

# =====================================================================
#                     CTA panel  +  QR
# =====================================================================
pan_x0, pan_y0 = RIGHT - 1170*SS, pgy + 210*SS
pan_h = 318*SS
draw.rounded_rectangle([pan_x0, pan_y0, RIGHT, pan_y0 + pan_h],
                       radius=16*SS, fill=(238, 227, 208), outline=INK, width=3*SS)
rtext(pan_y0 + 38*SS, "לתיאום תאריך — שיחה קצרה, בלי התחייבות", f_sb(36*SS), right=RIGHT - 46*SS)
pf = f_head(116*SS)
draw.text((RIGHT - 46*SS - draw.textlength(PHONE, font=pf), pan_y0 + 96*SS),
          PHONE, font=pf, fill=INK)

qr = segno.make(WA, error='h')
qp = os.path.join(OUT, "_qr.png")
qr.save(qp, scale=20, dark="#1c1a16", light="#f4ecdf", border=2)
QS = 348 * SS
qim = Image.open(qp).convert("RGB").resize((QS, QS), Image.NEAREST)
qx, qy = M, pan_y0 + pan_h//2 - QS//2
img.paste(qim, (qx, qy))
draw.rectangle([qx, qy, qx+QS, qy+QS], outline=INK, width=3*SS)
for mx, my in [(qx,qy),(qx+QS,qy),(qx,qy+QS),(qx+QS,qy+QS)]:
    draw.line([(mx-18*SS,my),(mx+18*SS,my)], fill=INK, width=3*SS)
    draw.line([(mx,my-18*SS),(mx,my+18*SS)], fill=INK, width=3*SS)
ctext(qx + QS/2, qy + QS + 14*SS, "סריקה = וואטסאפ עם הקוד מוכן", f_hemn(23*SS))

tz0 = TZ
draw.line([(M, tz0), (W - M, tz0)], fill=INK, width=3*SS)
rtext(tz0 - 58*SS, "גזרו · קחו · התקשרו", f_sb(38*SS))
draw.text((M, tz0 - 50*SS), "\u2193 \u2193 \u2193", font=f_reg(34*SS), fill=ORANGE)
NST = 9
sw = (W - 2*M) / NST
strip_h = int(H - M*0.5 - tz0 - 28*SS)
for i in range(NST):
    x = M + i * sw
    if i:
        for yy in range(int(tz0)+8*SS, H - int(M*0.5), 26*SS):
            draw.line([(x, yy), (x, yy+13*SS)], fill=(*INK, 140), width=2*SS)
    strip = Image.new("RGBA", (strip_h, int(sw)), (0, 0, 0, 0))
    sdr = ImageDraw.Draw(strip)
    sdr.text((20*SS, strip.height*0.20), He("המירוץ למיליון"), font=f_sb(29*SS), fill=INK)
    sdr.text((20*SS, strip.height*0.44), He("יום הולדת · גיל 10–15"), font=f_reg(20*SS), fill=(*INK, 190))
    sdr.text((20*SS, strip.height*0.66), PHONE, font=f_monob(27*SS), fill=ORANGE_DK)
    img.paste(strip.rotate(90, expand=True), (int(x + 5*SS), int(tz0 + 22*SS)), strip.rotate(90, expand=True))

fy = H - int(M*0.46)
draw.text((W - M, fy), He("מופעל דרך אפליקציית RushPoint"), font=f_reg(22*SS), fill=(*INK, 155), anchor="ra")
draw.text((M, fy), "SHEET RP-01 · ED. A · SCALE 1:NEIGHBOURHOOD", font=f_mono(22*SS), fill=(*INK, 155))

sbx, sby = M, M + 300*SS
for i in range(4):
    draw.rectangle([sbx + i*44*SS, sby, sbx + (i+1)*44*SS, sby + 12*SS],
                   fill=INK if i % 2 == 0 else BONE, outline=INK, width=2*SS)
draw.text((sbx, sby + 20*SS), "0        200 m", font=f_mono(20*SS), fill=(*INK, 150))

# neatline between the terrain and the document column
dvx = int(W * 0.375)
draw.line([(dvx, M//2), (dvx, TZ)], fill=(*INK, 70), width=2*SS)
for ty2 in range(M, TZ, 210*SS):
    draw.line([(dvx - 9*SS, ty2), (dvx + 9*SS, ty2)], fill=(*INK, 70), width=2*SS)

draw.rectangle([M//2, M//2, W - M//2, H - M//2], outline=(*INK, 110), width=2*SS)

# =====================================================================
out = img.resize((W // SS, H // SS), Image.LANCZOS)
png = os.path.join(OUT, "mirotz-lamillion-poster.png")
pdf = os.path.join(OUT, "mirotz-lamillion-poster.pdf")
out.save(png, dpi=(300, 300))
out.save(pdf, "PDF", resolution=300.0)
os.remove(qp)
print("wrote", png, "and", pdf)
