# -*- coding: utf-8 -*-
"""המירוץ למיליון — personal WhatsApp/Instagram status (1080x1920), photo-led.
Three real photos + a first-person note. One running cursor + measured glyph
heights, so nothing overlaps."""
import os, math, numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = os.path.dirname(os.path.abspath(__file__))
SS = 2
W, H = 1080 * SS, 1920 * SS
M = 70 * SS

PHONE = "055 964 1404"

BONE   = (245, 238, 225)
INK    = (33, 30, 25)
SOFT   = (78, 71, 60)
ORANGE = (208, 78, 28)
ORANGE_DK = (150, 46, 12)
GREEN  = (74, 92, 74)

FD = "C:/Windows/Fonts/"
def wf(n, s): return ImageFont.truetype(FD + n, s)
f_head = lambda s: wf("ahronbd.ttf", s)
f_sb   = lambda s: wf("seguisb.ttf", s)
f_reg  = lambda s: wf("segoeui.ttf", s)
f_sig  = lambda s: wf("davidbd.ttf", s)
f_mono = lambda s: ImageFont.truetype(
    r"C:\Users\savir\AppData\Roaming\Claude\local-agent-mode-sessions\skills-plugin\4f382392-26bd-48f4-8d04-454ab8137a93\56bb1f00-8a70-4d1b-b7dc-e858268f2abf\skills\canvas-design\canvas-fonts\JetBrainsMono-Bold.ttf", s)

from bidi.algorithm import get_display
def He(s): return get_display(s, base_dir='R')

def fit_crop(path, tw, th, ybias=0.5):
    im = Image.open(path).convert("RGB")
    s = max(tw/im.width, th/im.height)
    nw, nh = max(tw, int(im.width*s+0.5)), max(th, int(im.height*s+0.5))
    im = im.resize((nw, nh), Image.LANCZOS)
    x = (nw - tw)//2
    y = int((nh - th) * ybias)
    return im.crop((x, y, x+tw, y+th))

img = Image.new("RGB", (W, H), BONE)
draw = ImageDraw.Draw(img, "RGBA")

# ---- faint contour texture behind everything ----------------------
cont = Image.new("RGBA", (W, H), (0, 0, 0, 0))
cd = ImageDraw.Draw(cont, "RGBA")
def family(cx, cy, n, step, seed, squash=0.9, max_r=None):
    rng = np.random.default_rng(int(seed*1000))
    ph = rng.uniform(0, 2*math.pi, 6); th = np.linspace(0, 2*math.pi, 800)
    for i in range(1, n):
        r = i*step*(0.55 + 0.45*abs(math.sin(i*0.17+seed)))
        if max_r and r > max_r: break
        rad = r*(1 + 0.075*np.sin(3*th+ph[0]) + 0.045*np.sin(5*th+ph[1]) + 0.028*np.sin(2*th+ph[2]))
        x = cx + rad*np.cos(th); y = cy + rad*np.sin(th)*squash
        a = 26 if i % 5 else 40
        cd.line(list(zip(x.tolist(), y.tolist())), fill=(*INK, a), width=(3 if i%5==0 else 2), joint="curve")
family(int(W*0.30), int(H*0.72), 120, 34*SS, 3.1, 0.9, max_r=int(H*0.6))
img = Image.alpha_composite(img.convert("RGBA"), cont).convert("RGB")
draw = ImageDraw.Draw(img, "RGBA")

# =====================================================================
#                     HERO PHOTO + TITLE
# =====================================================================
HERO_H = int(H*0.415)
hero = fit_crop(os.path.join(OUT, "src_2.jpg"), W, HERO_H, ybias=0.68)
img.paste(hero, (0, 0))
# gradient scrim on the lower part of the hero (soft top, near-solid base for the title)
scrim_h = 460*SS
grad = Image.new("L", (1, scrim_h), 0)
for i in range(scrim_h):
    f = i/scrim_h
    grad.putpixel((0, i), int(min(252, 252 * (f**1.25) + 30*f)))
grad = grad.resize((W, scrim_h))
black = Image.new("RGB", (W, scrim_h), (14, 11, 8))
img.paste(black, (0, HERO_H-scrim_h), grad)
draw = ImageDraw.Draw(img, "RGBA")

RIGHT = W - M
def gh(font, s="Aבגהקך0"):
    b = font.getbbox(s); return b[3]-b[1]
def rtext(y, s, font, fill=INK, right=RIGHT):
    disp = He(s); draw.text((right - draw.textlength(disp, font=font), y), disp, font=font, fill=fill)

# title on the scrim
tf = f_head(118*SS); kf = f_sb(36*SS)
kick_y = HERO_H - 40*SS - gh(tf) - 20*SS - gh(kf)
rtext(kick_y, "יום הולדת אקשן בחוץ · גילאי 10 עד 15 · עד 30 משתתפים", kf, fill=BONE)
rtext(kick_y + gh(kf) + 20*SS, "המירוץ למיליון", tf, fill=BONE)
draw.line([(RIGHT-draw.textlength(He("המירוץ למיליון"), font=tf), HERO_H-30*SS),
           (RIGHT, HERO_H-30*SS)], fill=ORANGE, width=6*SS)

# =====================================================================
#                     THE PERSONAL NOTE
# =====================================================================
yc = HERO_H + 66*SS

# --- the hook (the line that stops the scroll) ---
hkf = f_sb(32*SS); hkl = gh(hkf) + 16*SS
for ln in ["יש רגע אחד ביום ההולדת שבו כולם שותקים:",
           "השנייה לפני שהמשימה הראשונה נפתחת בטלפון."]:
    rtext(yc, ln, hkf, fill=INK); yc += hkl
yc += 40*SS

# --- who I am ---
nf = f_reg(29*SS); nlead = gh(nf) + 14*SS
for ln in ["אני אחיה, בן 17. בניתי אפליקציה למשחקי פעולה בחוץ,",
           "ועכשיו אני מתחיל להפעיל איתה ימי הולדת."]:
    rtext(yc, ln, nf, fill=SOFT); yc += nlead
yc += 46*SS

# --- the two audiences, side by side ---
lbf = f_sb(29*SS); bdf = f_reg(29*SS)
def labeled(y, label, rest):
    lab = He(label); lw = draw.textlength(lab, font=lbf)
    draw.text((RIGHT - lw, y), lab, font=lbf, fill=ORANGE_DK)
    rst = He(rest)
    draw.text((RIGHT - lw - 12*SS - draw.textlength(rst, font=bdf), y), rst, font=bdf, fill=INK)
labeled(yc, "להורים:", "אתם תדאגו לכיבוד, אני אדאג לתוכן שלא יישכח.")
yc += gh(bdf) + 20*SS
labeled(yc, "לילדים:", "יום ההולדת שידברו עליו בכיתה שבועיים.")
yc += gh(bdf) + 42*SS

# --- the offer ---
of = f_sb(29*SS)
draw.line([(RIGHT-430*SS, yc-12*SS),(RIGHT, yc-12*SS)], fill=ORANGE, width=3*SS)
rtext(yc, "5 האירועים הראשונים במחיר היכרות.", of, fill=INK)
yc += gh(of) + 34*SS

# =====================================================================
#                     TWO SNAPSHOTS
# =====================================================================
gap = 26*SS
tw = (W - 2*M - gap)//2
tph = int(tw*0.64)
for k, src in enumerate(["src_3.jpg", "src_5.jpg"]):
    tx = M + k*(tw+gap)
    tile = fit_crop(os.path.join(OUT, src), tw, tph, ybias=0.5)
    img.paste(tile, (tx, yc))
    draw = ImageDraw.Draw(img, "RGBA")
    draw.rectangle([tx, yc, tx+tw, yc+tph], outline=(*INK,180), width=3*SS)
yc += tph + 36*SS

# =====================================================================
#                     CTA  +  SIGNATURE
# =====================================================================
cf = f_sb(31*SS)
rtext(yc, "רוצים כזה ליום הולדת? כתבו לי:", cf); yc += gh(cf) + 20*SS
pf = f_head(82*SS)
pw = draw.textlength(PHONE, font=pf)
draw.text((RIGHT - pw, yc), PHONE, font=pf, fill=ORANGE_DK)
draw.line([(RIGHT-pw, yc+gh(pf)+13*SS),(RIGHT, yc+gh(pf)+13*SS)], fill=(*ORANGE_DK,150), width=3*SS)
yc += gh(pf) + 40*SS
sgf = f_sig(30*SS)
rtext(yc, "שלכם, אחיה", sgf, fill=INK)
yc += gh(sgf) + 26*SS
rpf = f_sb(21*SS)
rtext(yc, "מופעל על RushPoint · פלטפורמה מקצועית למשחקי פעולה", rpf, fill=(*SOFT, 160))

draw.rectangle([M//2, M//2, W-M//2, H-M//2], outline=(*INK,70), width=2*SS)

print("content bottom:", (yc + gh(rpf))/SS, "frame bottom:", (H-M//2)/SS)
out = img.resize((W//SS, H//SS), Image.LANCZOS)
png = os.path.join(OUT, "mirotz-lamillion-status.png")
out.save(png, quality=95)
print("wrote", png)
