# -*- coding: utf-8 -*-
"""Birthday-organiser poster TEMPLATE - Contour Kinetics style, generic.
Run:  python tpl_poster.py qr        -> tpl-poster-qr.png / .pdf
      python tpl_poster.py tearoff   -> tpl-poster-tearoff.png / .pdf
Every organiser-specific value is a [bracketed] placeholder.
"""
import os, sys, math, numpy as np
from PIL import Image, ImageDraw, ImageFont
from bidi.algorithm import get_display
import segno

MODE = sys.argv[1] if len(sys.argv) > 1 else "qr"
assert MODE in ("qr", "tearoff")
BG = os.environ.get("BG_ONLY") == "1"

OUT = os.path.dirname(os.path.abspath(__file__))
SS = 2
W, H = 2480 * SS, 3508 * SS
M = 172 * SS
TZ = int(H * 0.808)
BOT = int(H * (0.70 if MODE == "tearoff" else 0.775))

PHONE_BIG = "05X-XXX-XXXX"
WA_SAMPLE = "https://wa.me/972000000000"

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

cont = Image.new("RGBA", (W, H), (0, 0, 0, 0))
cd = ImageDraw.Draw(cont, "RGBA")
def family(cx, cy, n, step, seed, squash=0.9, max_r=None, tone="mix"):
    rng = np.random.default_rng(int(seed * 1000))
    ph = rng.uniform(0, 2 * math.pi, 6); th = np.linspace(0, 2 * math.pi, 900)
    dr = rng.uniform(-0.35, 0.35, 2) * step
    for i in range(1, n):
        crowd = 0.55 + 0.45 * abs(math.sin(i * 0.17 + seed))
        r = i * step * crowd
        if max_r and r > max_r:
            break
        rad = r * (1 + 0.075 * np.sin(3 * th + ph[0]) + 0.045 * np.sin(5 * th + ph[1] + i * 0.03)
                   + 0.028 * np.sin(2 * th + ph[2]) + 0.015 * np.sin(7 * th + ph[3]))
        x = cx + dr[0] * i / n + rad * np.cos(th)
        y = cy + dr[1] * i / n + rad * np.sin(th) * squash
        idx = (i % 5 == 0)
        col = ((*GREEN, 50 if not idx else 82) if tone == "green"
               else ((*INK, 38) if not idx else (*INK, 80)))
        cd.line(list(zip(x.tolist(), y.tolist())), fill=col, width=(5 if idx else 2), joint="curve")
CX, CY = int(W * 0.30), int(H * 0.275)
family(CX, CY, 170, 37 * SS, 3.1, 0.88, max_r=int(H * 1.05))
family(int(W * 0.02), int(H * 0.05), 60, 44 * SS, 8.4, 0.9, max_r=int(W * 0.5), tone="green")
family(int(W * 0.99), int(H * 0.18), 72, 50 * SS, 2.7, 0.85, max_r=int(W * 0.55), tone="green")
family(int(W * 0.08), int(H * 0.99), 82, 45 * SS, 5.9, 0.8, max_r=int(W * 0.62), tone="green")
family(int(W * 1.06), int(H * 0.9), 60, 52 * SS, 1.4, 0.85, max_r=int(W * 0.45), tone="green")
img = Image.alpha_composite(img.convert("RGBA"), cont).convert("RGB")
draw = ImageDraw.Draw(img, "RGBA")

def catmull(p, k=40):
    o = []
    for i in range(len(p) - 1):
        p0, p1, p2, p3 = p[max(i - 1, 0)], p[i], p[i + 1], p[min(i + 2, len(p) - 1)]
        for t in np.linspace(0, 1, k):
            t2, t3 = t * t, t * t * t
            x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3)
            y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
            o.append((x, y))
    return o
anchors = [(W * 0.31, H * 0.765), (W * 0.21, H * 0.66), (W * 0.35, H * 0.58),
           (W * 0.19, H * 0.49), (W * 0.34, H * 0.41), (W * 0.22, H * 0.34),
           (CX + 4 * SS, CY + 8 * SS)]
path = catmull(anchors)
seg = [0.0]
for a, b in zip(path, path[1:]):
    seg.append(seg[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
total = seg[-1]
def at(s):
    for i in range(1, len(seg)):
        if seg[i] >= s:
            f = (s - seg[i - 1]) / max(seg[i] - seg[i - 1], 1e-6)
            return (path[i - 1][0] + f * (path[i][0] - path[i - 1][0]), path[i - 1][1] + f * (path[i][1] - path[i - 1][1]))
    return path[-1]
d, g = 42 * SS, 24 * SS
s = 0.0
while s < total:
    a, b = at(s), at(min(s + d, total))
    if a[1] < BOT and b[1] < BOT:
        draw.line([a, b], fill=ORANGE, width=13 * SS)
    s += d + g

frac = [0.11, 0.30, 0.49, 0.68, 0.87]
LET = ["\u05de", "\u05d9", "\u05e8", "\u05d5", "\u05e5"]
for k, fr in enumerate(frac):
    px, py = at(fr * total)
    R = 46 * SS
    draw.ellipse([px - R, py - R, px + R, py + R], fill=BONE, outline=ORANGE, width=10 * SS)
    fn = f_monob(46 * SS); tb = draw.textbbox((0, 0), str(k + 1), font=fn)
    draw.text((px - (tb[2] - tb[0]) / 2, py - (tb[3] - tb[1]) / 2 - tb[1]), str(k + 1), font=fn, fill=INK)
    draw.text((px + 78 * SS, py), LET[k], font=f_david(58 * SS), fill=ORANGE_DK, anchor="mm")

GX = M
draw.text((GX, H * 0.30), He("\u05d4\u05e7\u05d5\u05e4\u05d4"), font=f_sb(32 * SS), fill=(*ORANGE_DK, 230))
for (gy, amt, dx) in [(0.735, "100,000", 26 * SS), (0.62, "300,000", 0), (0.50, "500,000", 0),
                      (0.375, "700,000", 0), (0.245, "900,000", 0)]:
    yy = H * gy
    draw.line([(GX + dx, yy), (GX + dx + 30 * SS, yy)], fill=(*INK, 120), width=3 * SS)
    draw.text((GX + dx + 44 * SS, yy), amt, font=f_mono(32 * SS), fill=(*INK, 170), anchor="lm")

draw.polygon([(CX, CY - 40 * SS), (CX - 32 * SS, CY + 22 * SS), (CX + 32 * SS, CY + 22 * SS)], fill=INK)
draw.text((CX + 54 * SS, CY - 6 * SS), "1,000,000", font=f_monob(48 * SS), fill=INK, anchor="lm")
draw.text((CX + 54 * SS, CY + 48 * SS), He("\u05d4\u05e7\u05d5\u05e4\u05d4 \u05d4\u05de\u05dc\u05d0\u05d4"), font=f_sb(27 * SS), fill=(*INK, 165), anchor="lm")

if BG:
    draw.rectangle([M // 2, M // 2, W - M // 2, H - M // 2], outline=(*INK, 105), width=2 * SS)
    ndv = int(W * 0.40)
    nend = int(H * (0.808 if MODE == "tearoff" else 0.98))
    draw.line([(ndv, M // 2), (ndv, nend)], fill=(*INK, 50), width=2 * SS)
    for yy in range(M, nend, 230 * SS):
        draw.line([(ndv - 10 * SS, yy), (ndv + 10 * SS, yy)], fill=(*INK, 50), width=2 * SS)
    out = img.resize((W // SS, H // SS), Image.LANCZOS)
    out.save(os.path.join(OUT, "bg-poster-" + MODE + ".png"))
    print("BG only ->", "bg-poster-" + MODE + ".png")
    raise SystemExit

RIGHT = W - M
def tl(s, font): return draw.textlength(He(s), font=font)
def rtext(y, s, font, fill=INK, tracking=0, right=RIGHT):
    disp = He(s)
    if not tracking:
        draw.text((right - draw.textlength(disp, font=font), y), disp, font=font, fill=fill); return
    ws = [draw.textlength(c, font=font) for c in disp]; x = right - (sum(ws) + tracking * (len(disp) - 1))
    for ch, w in zip(disp, ws):
        draw.text((x, y), ch, font=font, fill=fill); x += w + tracking
def ctext(cx, y, s, font, fill=INK):
    disp = He(s); draw.text((cx - draw.textlength(disp, font=font) / 2, y), disp, font=font, fill=fill)
def ltext_right(right_x, y, s, font, fill, tracking=0):
    ws = [draw.textlength(c, font=font) for c in s]
    tot = sum(ws) + tracking * (len(s) - 1); x = right_x - tot
    for ch, w in zip(s, ws):
        draw.text((x, y), ch, font=font, fill=fill); x += w + tracking
    return tot
def glyph_h(font, s="Ab\u05d2\u05d4\u05e7\u05da0"):
    b = font.getbbox(s); return b[3] - b[1]
def Y(f): return int(H * f)

l1, f1 = "\u05e8\u05e7 5 \u05ea\u05d0\u05e8\u05d9\u05db\u05d9\u05dd \u05e8\u05d0\u05e9\u05d5\u05e0\u05d9\u05dd", f_bold(52 * SS)
l2, f2 = "\u05d1\u05de\u05d7\u05d9\u05e8 \u05d4\u05d9\u05db\u05e8\u05d5\u05ea", f_sb(42 * SS)
pad = 40 * SS
bw = max(tl(l1, f1), tl(l2, f2)) + 2 * pad
bh = 200 * SS
bx0, by0 = M, Y(0.104)
draw.rectangle([bx0, by0, bx0 + bw, by0 + bh], fill=ORANGE)
draw.rectangle([bx0 + 10 * SS, by0 + 10 * SS, bx0 + bw - 10 * SS, by0 + bh - 10 * SS], outline=(*BONE, 150), width=2 * SS)
ctext(bx0 + bw / 2, by0 + 34 * SS, l1, f1, fill=BONE)
ctext(bx0 + bw / 2, by0 + 116 * SS, l2, f2, fill=BONE)

ox, oy, r = M + 40 * SS, M + 76 * SS, 34 * SS
for a in range(0, 360, 45):
    aa = math.radians(a - 90)
    draw.line([(ox, oy), (ox + r * math.cos(aa), oy + r * math.sin(aa))], fill=(*INK, 110), width=2 * SS)
draw.line([(ox, oy), (ox, oy - r)], fill=ORANGE, width=4 * SS)
draw.text((ox, oy - r - 20 * SS), "N", font=f_monob(20 * SS), fill=INK, anchor="mm")

draw.line([(RIGHT - 560 * SS, M - 4 * SS), (RIGHT, M - 4 * SS)], fill=INK, width=3 * SS)
rtext(M + 8 * SS, "\u05ea\u05e6\u05e4\u05d9\u05ea \u05e9\u05d3\u05d4 \u00b7 [\u05e2\u05d9\u05e8]", f_reg(34 * SS), tracking=8 * SS)

htxt = "[\u05e9\u05dd \u05d4\u05d0\u05d9\u05e8\u05d5\u05e2]"
hs = 300 * SS
colw = RIGHT - int(W * 0.40) - 30 * SS
while draw.textlength(He(htxt), font=f_head(hs)) > colw and hs > 120 * SS:
    hs -= 8 * SS
rtext(Y(0.12), htxt, f_head(hs), fill=INK)
uy = Y(0.12) + glyph_h(f_head(hs)) + 40 * SS
draw.line([(RIGHT - draw.textlength(He(htxt), font=f_head(hs)), uy), (RIGHT, uy)], fill=ORANGE, width=9 * SS)

rbx0, rby0 = int(W * 0.40), Y(0.318)
rpf1, rpf2 = f_bold(64 * SS), f_sb(38 * SS)
rph = 34 * SS + 76 * SS + 16 * SS + 50 * SS + 30 * SS
draw.rectangle([rbx0, rby0, RIGHT, rby0 + rph], fill=INK)
ctext((rbx0 + RIGHT) / 2, rby0 + 34 * SS, "\u05e8\u05e5 \u05e2\u05dc RushPoint", rpf1, fill=BONE)
ctext((rbx0 + RIGHT) / 2, rby0 + 34 * SS + 76 * SS + 16 * SS, "\u05e4\u05dc\u05d8\u05e4\u05d5\u05e8\u05de\u05d4 \u05de\u05e7\u05e6\u05d5\u05e2\u05d9\u05ea \u05dc\u05de\u05e9\u05d7\u05e7\u05d9 \u05e4\u05e2\u05d5\u05dc\u05d4", rpf2, fill=BONE)

rtext(Y(0.416), "\u05d9\u05d5\u05dd \u05d4\u05d5\u05dc\u05d3\u05ea \u05d0\u05e7\u05e9\u05df \u05d1\u05d7\u05d5\u05e5 \u00b7 \u05dc\u05d2\u05d9\u05dc\u05d0\u05d9 10 \u05e2\u05d3 15", f_bold(64 * SS))
rtext(Y(0.486), "\u05de\u05ea\u05d7\u05dc\u05e7\u05d9\u05dd \u05dc\u05e6\u05d5\u05d5\u05ea\u05d9\u05dd \u05d5\u05e8\u05e6\u05d9\u05dd \u05d1\u05d9\u05df \u05ea\u05d7\u05e0\u05d5\u05ea \u05e2\u05dd \u05de\u05e9\u05d9\u05de\u05d5\u05ea \u05d1\u05d8\u05dc\u05e4\u05d5\u05df.", f_reg(52 * SS))
rtext(Y(0.522), "\u05db\u05dc \u05de\u05e9\u05d9\u05de\u05d4 \u05de\u05e7\u05e4\u05d9\u05e6\u05d4 \u05d0\u05ea \u05d4\u05e7\u05d5\u05e4\u05d4 \u05d4\u05de\u05e9\u05d5\u05ea\u05e4\u05ea \u05dc\u05de\u05e2\u05dc\u05d4.", f_reg(52 * SS))
draw.line([(RIGHT - 1200 * SS, Y(0.572) - 20 * SS), (RIGHT, Y(0.572) - 20 * SS)], fill=INK, width=2 * SS)
rtext(Y(0.576), "\u05e2\u05d3 30 \u05de\u05e9\u05ea\u05ea\u05e4\u05d9\u05dd   \u00b7   \u05de\u05e9\u05da \u05d6\u05de\u05df \u05d2\u05de\u05d9\u05e9", f_sb(50 * SS))
rtext(Y(0.614), "\u05d4\u05de\u05e9\u05d7\u05e7 \u05de\u05d5\u05ea\u05d0\u05dd \u05d0\u05d9\u05e9\u05d9\u05ea \u05dc\u05d0\u05d9\u05e8\u05d5\u05e2 \u05e9\u05dc\u05db\u05dd", f_sb(50 * SS))

draw.line([(RIGHT - 1320 * SS, Y(0.666) - 30 * SS), (RIGHT, Y(0.666) - 30 * SS)], fill=ORANGE, width=5 * SS)
rtext(Y(0.670), "\u05d7\u05de\u05e9 \u05d4\u05ea\u05d7\u05e0\u05d5\u05ea \u05e9\u05e2\u05dc \u05d4\u05de\u05e4\u05d4 \u05de\u05e1\u05ea\u05d9\u05e8\u05d5\u05ea \u05de\u05d9\u05dc\u05d4.", f_bold(64 * SS))
if MODE == "qr":
    rtext(Y(0.714), "\u05d0\u05de\u05e8\u05d5 \u05d0\u05d5\u05ea\u05d4 \u05d1\u05d8\u05dc\u05e4\u05d5\u05df, \u05d5\u05d6\u05d4 \u05de\u05d7\u05d9\u05e8 \u05d4\u05d4\u05d9\u05db\u05e8\u05d5\u05ea \u05e9\u05dc\u05db\u05dd.", f_reg(54 * SS))
    rtext(Y(0.756), "\u05d0\u05d6\u05d5\u05e8 \u05d1\u05d8\u05d5\u05d7 \u05de\u05e1\u05d5\u05de\u05df \u05de\u05e8\u05d0\u05e9 \u00b7 \u05de\u05d1\u05d5\u05d2\u05e8 \u05de\u05dc\u05d5\u05d5\u05d4 \u00b7 \u05d0\u05e0\u05d9 \u05de\u05d2\u05d9\u05e2 \u05d5\u05de\u05e4\u05e2\u05d9\u05dc.", f_reg(44 * SS))
else:
    rtext(Y(0.700), "\u05d0\u05de\u05e8\u05d5 \u05d0\u05d5\u05ea\u05d4 \u05d1\u05e9\u05d9\u05d7\u05d4 \u00b7 \u05d0\u05d6\u05d5\u05e8 \u05d1\u05d8\u05d5\u05d7 \u00b7 \u05de\u05d1\u05d5\u05d2\u05e8 \u05de\u05dc\u05d5\u05d5\u05d4 \u00b7 \u05d0\u05e0\u05d9 \u05de\u05d2\u05d9\u05e2 \u05d5\u05de\u05e4\u05e2\u05d9\u05dc.", f_reg(38 * SS))

label_s = "\u05dc\u05ea\u05d9\u05d0\u05d5\u05dd \u05ea\u05d0\u05e8\u05d9\u05da \u00b7 \u05e9\u05d9\u05d7\u05d4 \u05e7\u05e6\u05e8\u05d4, \u05d1\u05dc\u05d9 \u05d4\u05ea\u05d7\u05d9\u05d9\u05d1\u05d5\u05ea"
code_s  = "\u05d4\u05de\u05d9\u05dc\u05d4 \u05de\u05d4\u05de\u05e4\u05d4 \u05d4\u05d9\u05d0 \u05d4\u05e7\u05d5\u05d3 \u05e9\u05d0\u05d5\u05de\u05e8\u05d9\u05dd \u05d1\u05e9\u05d9\u05d7\u05d4"
label_f, phone_f, code_f = f_sb(42 * SS), f_monob(66 * SS), f_sb(32 * SS)
pad_t, gap_t, track = 40 * SS, 26 * SS, 3 * SS
label_h, phone_h, code_h = glyph_h(label_f), glyph_h(phone_f), glyph_h(code_f)

if MODE == "qr":
    text_col_h = label_h + gap_t + phone_h + gap_t + code_h
    phone_w = sum(draw.textlength(c, font=phone_f) for c in PHONE_BIG) + track * (len(PHONE_BIG) - 1)
    text_w = max(tl(label_s, label_f), phone_w, tl(code_s, code_f)) + 2 * pad_t + 20 * SS
    text_h = text_col_h + 2 * pad_t
    BAND_Y = Y(0.796)
    QS = 340 * SS
    qc_s = "\u05e1\u05e8\u05e7\u05d5 \u05dc\u05ea\u05d9\u05d0\u05d5\u05dd \u05d1\u05d5\u05d5\u05d0\u05d8\u05e1\u05d0\u05e4"
    qc_f = f_sb(38 * SS); pad_q, cap_gap = 32 * SS, 18 * SS
    qc_h = glyph_h(qc_f)
    q_w = max(QS, draw.textlength(He(qc_s), font=qc_f)) + 2 * pad_q
    q_h = QS + cap_gap + qc_h + 2 * pad_q
    q_x0 = M; q_x1 = q_x0 + q_w; q_y0 = BAND_Y
    draw.rounded_rectangle([q_x0, q_y0, q_x1, q_y0 + q_h], radius=18 * SS, fill=INK)
    text_x0 = RIGHT - text_w
    text_y0 = BAND_Y + (q_h - text_h) // 2
    draw.rounded_rectangle([text_x0, text_y0, RIGHT, text_y0 + text_h], radius=18 * SS, fill=INK)
    tr = RIGHT - pad_t; tyy = text_y0 + pad_t
    rtext(tyy, label_s, label_f, fill=BONE, right=tr); tyy += label_h + gap_t
    ltext_right(tr, tyy, PHONE_BIG, phone_f, BONE, tracking=track); tyy += phone_h + gap_t
    rtext(tyy, code_s, code_f, fill=BONE, right=tr)
    qr = segno.make(WA_SAMPLE, error='h')
    qp = os.path.join(OUT, "_qr.png")
    qr.save(qp, scale=20, dark="#3a352d", light="#e9e2d3", border=1)
    qim = Image.open(qp).convert("RGB").resize((QS, QS), Image.NEAREST)
    qx, qy = int(q_x0 + (q_w - QS) // 2), int(q_y0 + pad_q)
    img.paste(qim, (qx, qy)); draw = ImageDraw.Draw(img, "RGBA")
    ov = Image.new("RGBA", (QS, QS), (25, 23, 19, 234))
    img.paste(Image.alpha_composite(img.crop((qx, qy, qx + QS, qy + QS)).convert("RGBA"), ov).convert("RGB"), (qx, qy))
    draw = ImageDraw.Draw(img, "RGBA")
    draw.rectangle([qx, qy, qx + QS, qy + QS], outline=(*BONE, 140), width=3 * SS)
    iy = qy + 30 * SS
    ctext(qx + QS / 2, iy, "\u05d4-QR \u05d4\u05d6\u05d4 \u05dc\u05d3\u05d5\u05d2\u05de\u05d4", f_bold(32 * SS), fill=ORANGE); iy += 54 * SS
    ctext(qx + QS / 2, iy, "\u05e6\u05e8\u05d5 \u05e7\u05d5\u05d3 \u05de\u05e9\u05dc\u05db\u05dd:", f_sb(28 * SS), fill=BONE); iy += 52 * SS
    for ln in ["1.  qrcode-monkey.com",
               "2.  \u05d4\u05d3\u05d1\u05d9\u05e7\u05d5  wa.me/972",
               "     + \u05d4\u05d8\u05dc\u05e4\u05d5\u05df \u05d1\u05dc\u05d9 \u05d4-0",
               "3.  \u05d4\u05d7\u05dc\u05d9\u05e4\u05d5 \u05d0\u05ea \u05d4\u05e8\u05d9\u05d1\u05d5\u05e2 \u05d4\u05d6\u05d4"]:
        ctext(qx + QS / 2, iy, ln, f_reg(25 * SS), fill=(*BONE, 225)); iy += 46 * SS
    ctext(q_x0 + q_w / 2, qy + QS + cap_gap, qc_s, qc_f, fill=BONE)
    os.remove(qp)
    band_bot = BAND_Y + max(text_h, q_h)
else:
    text_col_h = label_h + gap_t + phone_h
    phone_w = sum(draw.textlength(c, font=phone_f) for c in PHONE_BIG) + track * (len(PHONE_BIG) - 1)
    text_w = max(tl(label_s, label_f), phone_w) + 2 * pad_t
    text_h = text_col_h + 2 * pad_t
    tpad = 32 * SS
    text_h = label_h + 18 * SS + glyph_h(phone_f) + 2 * tpad
    text_w = RIGHT - int(W * 0.40) - 30 * SS
    BAND_Y = Y(0.724)
    text_x0 = RIGHT - text_w
    draw.rounded_rectangle([text_x0, BAND_Y, RIGHT, BAND_Y + text_h], radius=18 * SS, fill=INK)
    tr = RIGHT - pad_t; tyy = BAND_Y + tpad
    rtext(tyy, label_s, label_f, fill=BONE, right=tr); tyy += label_h + 18 * SS
    ltext_right(tr, tyy, PHONE_BIG, phone_f, BONE, tracking=track)
    rtext(BAND_Y + text_h - glyph_h(f_reg(26 * SS)) - 6 * SS, "( המספר שלכם )", f_reg(26 * SS), fill=(*INK, 170), right=text_x0 - 34 * SS)
    band_bot = TZ
    draw.rectangle([M // 2 + 2 * SS, TZ, W - M // 2 - 2 * SS, H - M // 2 - 2 * SS], fill=BONE)
    draw.line([(M, TZ), (W - M, TZ)], fill=INK, width=4 * SS)
    rtext(TZ - 40 * SS, "\u05d2\u05d6\u05e8\u05d5 \u00b7 \u05e7\u05d7\u05d5 \u00b7 \u05d4\u05ea\u05e7\u05e9\u05e8\u05d5", f_sb(30 * SS))
    draw.text((M, TZ - 36 * SS), "\u2193 \u2193 \u2193", font=f_reg(28 * SS), fill=ORANGE)
    NST = 8
    sw = (W - 2 * M) / NST
    sh = int(H - M * 0.5 - TZ - 34 * SS); sbot = int(H - M * 0.5)
    for i in range(NST):
        x = M + i * sw
        if i % 2:
            draw.rectangle([x, TZ + 2 * SS, x + sw, sbot], fill=BONE_DEEP)
        if i:
            for yy in range(int(TZ) + 12 * SS, sbot, 30 * SS):
                draw.line([(x, yy), (x, yy + 16 * SS)], fill=(*INK, 150), width=2 * SS)
        tmp = Image.new("RGBA", (sh, int(sw)), (0, 0, 0, 0)); td = ImageDraw.Draw(tmp)
        td.text((sh * 0.06, sw * 0.5), He("[\u05e9\u05dd \u05d4\u05d0\u05d9\u05e8\u05d5\u05e2]"), font=f_sb(34 * SS), fill=INK, anchor="lm")
        td.text((sh * 0.55, sw * 0.5), PHONE_BIG, font=f_monob(30 * SS), fill=ORANGE_DK, anchor="lm")
        strip = tmp.rotate(-90, expand=True)
        img.paste(strip, (int(x + (sw - strip.width) / 2), int(TZ + 22 * SS)), strip)

fy = H - int(M * (0.42 if MODE == "tearoff" else 0.80))
rtext(fy - 2 * SS, "\u05de\u05d5\u05e4\u05e2\u05dc \u05e2\u05dc RushPoint \u00b7 \u05e4\u05dc\u05d8\u05e4\u05d5\u05e8\u05de\u05d4 \u05de\u05e7\u05e6\u05d5\u05e2\u05d9\u05ea \u05dc\u05de\u05e9\u05d7\u05e7\u05d9 \u05e4\u05e2\u05d5\u05dc\u05d4", f_sb(26 * SS), fill=(*INK, 170))
draw.text((M, fy), "TEMPLATE", font=f_mono(22 * SS), fill=(*INK, 150))
ndv = int(W * 0.40)
nend = TZ if MODE == "tearoff" else Y(0.775)
draw.line([(ndv, M // 2), (ndv, nend)], fill=(*INK, 50), width=2 * SS)
for yy in range(M, int(nend), 230 * SS):
    draw.line([(ndv - 10 * SS, yy), (ndv + 10 * SS, yy)], fill=(*INK, 50), width=2 * SS)
draw.rectangle([M // 2, M // 2, W - M // 2, H - M // 2], outline=(*INK, 105), width=2 * SS)

out = img.resize((W // SS, H // SS), Image.LANCZOS)
name = "tpl-poster-" + MODE
out.save(os.path.join(OUT, name + ".png"), dpi=(300, 300))
out.save(os.path.join(OUT, name + ".pdf"), "PDF", resolution=300.0)
print(f"[{MODE}] band {band_bot/SS:.0f} / tear {TZ/SS:.0f} / frame {(H-M//2)/SS:.0f} -> {name}")
