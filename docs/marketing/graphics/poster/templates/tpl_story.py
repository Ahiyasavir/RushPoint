# -*- coding: utf-8 -*-
"""Birthday-organiser STORY template (1080x1920). Photo-frame placeholders +
generic first-person copy. Every organiser-specific value is [bracketed].
"""
import os, math, numpy as np
from PIL import Image, ImageDraw, ImageFont
from bidi.algorithm import get_display

OUT = os.path.dirname(os.path.abspath(__file__))
BG = os.environ.get("BG_ONLY") == "1"
SS = 2
W, H = 1080 * SS, 1920 * SS
M = 70 * SS

PHONE = "05X-XXX-XXXX"

BONE   = (245, 238, 225)
BONE_D = (235, 227, 212)
INK    = (33, 30, 25)
SOFT   = (78, 71, 60)
ORANGE = (208, 78, 28)
ORANGE_DK = (150, 46, 12)

FD = "C:/Windows/Fonts/"
def wf(n, s): return ImageFont.truetype(FD + n, s)
f_head = lambda s: wf("ahronbd.ttf", s)
f_sb   = lambda s: wf("seguisb.ttf", s)
f_reg  = lambda s: wf("segoeui.ttf", s)
f_sig  = lambda s: wf("davidbd.ttf", s)
f_mono = lambda s: ImageFont.truetype(
    r"C:\Users\savir\AppData\Roaming\Claude\local-agent-mode-sessions\skills-plugin\4f382392-26bd-48f4-8d04-454ab8137a93\56bb1f00-8a70-4d1b-b7dc-e858268f2abf\skills\canvas-design\canvas-fonts\JetBrainsMono-Bold.ttf", s)
def He(s): return get_display(s, base_dir='R')

img = Image.new("RGB", (W, H), BONE)
draw = ImageDraw.Draw(img, "RGBA")

# faint contour texture
cont = Image.new("RGBA", (W, H), (0, 0, 0, 0))
cd = ImageDraw.Draw(cont, "RGBA")
def family(cx, cy, n, step, seed, squash=0.9, max_r=None):
    rng = np.random.default_rng(int(seed * 1000))
    ph = rng.uniform(0, 2 * math.pi, 6); th = np.linspace(0, 2 * math.pi, 800)
    for i in range(1, n):
        r = i * step * (0.55 + 0.45 * abs(math.sin(i * 0.17 + seed)))
        if max_r and r > max_r:
            break
        rad = r * (1 + 0.075 * np.sin(3 * th + ph[0]) + 0.045 * np.sin(5 * th + ph[1]) + 0.028 * np.sin(2 * th + ph[2]))
        x = cx + rad * np.cos(th); y = cy + rad * np.sin(th) * squash
        a = 26 if i % 5 else 40
        cd.line(list(zip(x.tolist(), y.tolist())), fill=(*INK, a), width=(3 if i % 5 == 0 else 2), joint="curve")
family(int(W * 0.30), int(H * 0.72), 120, 34 * SS, 3.1, 0.9, max_r=int(H * 0.6))
img = Image.alpha_composite(img.convert("RGBA"), cont).convert("RGB")
draw = ImageDraw.Draw(img, "RGBA")

if BG:
    # scrim band where the hero photo will sit (top ~40%)
    HH = int(H * 0.40)
    sh_ = 300 * SS
    gr = Image.new("L", (1, sh_), 0)
    for i in range(sh_):
        gr.putpixel((0, i), int(min(230, 230 * (i / sh_) ** 1.3)))
    gr = gr.resize((W, sh_))
    img.paste(Image.new("RGB", (W, sh_), (14, 11, 8)), (0, HH - sh_), gr)
    d2 = ImageDraw.Draw(img, "RGBA")
    d2.rectangle([M // 2, M // 2, W - M // 2, H - M // 2], outline=(33, 30, 25, 70), width=2 * SS)
    img.resize((W // SS, H // SS), Image.LANCZOS).save(os.path.join(OUT, "bg-story.png"))
    print("bg-story.png"); raise SystemExit

RIGHT = W - M
def gh(font, s="Ab\u05d2\u05d4\u05e7\u05da0"):
    b = font.getbbox(s); return b[3] - b[1]
def rtext(y, s, font, fill=INK, right=RIGHT):
    disp = He(s); draw.text((right - draw.textlength(disp, font=font), y), disp, font=font, fill=fill)
def ctext(cx, y, s, font, fill=INK):
    disp = He(s); draw.text((cx - draw.textlength(disp, font=font) / 2, y), disp, font=font, fill=fill)

def frame(x0, y0, x1, y1, caption):
    draw.rectangle([x0, y0, x1, y1], fill=BONE_D, outline=(*INK, 150), width=3 * SS)
    for gx in range(int(x0), int(x1), 26 * SS):
        draw.line([(gx, y0), (min(gx + 13 * SS, x1), y0)], fill=(*INK, 90), width=2 * SS)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    r = 30 * SS
    draw.ellipse([cx - r, cy - r - 22 * SS, cx + r, cy + r - 22 * SS], outline=ORANGE, width=4 * SS)
    draw.line([(cx - 14 * SS, cy - 22 * SS), (cx + 14 * SS, cy - 22 * SS)], fill=ORANGE, width=4 * SS)
    draw.line([(cx, cy - 22 * SS - 14 * SS), (cx, cy - 22 * SS + 14 * SS)], fill=ORANGE, width=4 * SS)
    ctext(cx, cy + 22 * SS, caption, f_sb(24 * SS), fill=SOFT)

# ===================== HERO FRAME + TITLE ============================
HERO_H = int(H * 0.40)
frame(0, 0, W, HERO_H, "\u05d4\u05d5\u05e1\u05d9\u05e4\u05d5 \u05ea\u05de\u05d5\u05e0\u05d4 \u05de\u05d0\u05d9\u05e8\u05d5\u05e2 \u05e9\u05dc\u05db\u05dd")
scrim_h = 300 * SS
grad = Image.new("L", (1, scrim_h), 0)
for i in range(scrim_h):
    grad.putpixel((0, i), int(min(240, 240 * (i / scrim_h) ** 1.3 + 20 * i / scrim_h)))
grad = grad.resize((W, scrim_h))
black = Image.new("RGB", (W, scrim_h), (14, 11, 8))
img.paste(black, (0, HERO_H - scrim_h), grad)
draw = ImageDraw.Draw(img, "RGBA")

tf = f_head(112 * SS); kf = f_sb(30 * SS)
kick_y = HERO_H - 40 * SS - gh(tf) - 20 * SS - gh(kf)
rtext(kick_y, "\u05d9\u05d5\u05dd \u05d4\u05d5\u05dc\u05d3\u05ea \u05d0\u05e7\u05e9\u05df \u05d1\u05d7\u05d5\u05e5 \u00b7 \u05d2\u05d9\u05dc\u05d0\u05d9 10 \u05e2\u05d3 15 \u00b7 \u05e2\u05d3 30 \u05de\u05e9\u05ea\u05ea\u05e4\u05d9\u05dd", kf, fill=BONE)
rtext(kick_y + gh(kf) + 20 * SS, "[\u05e9\u05dd \u05d4\u05d0\u05d9\u05e8\u05d5\u05e2]", tf, fill=BONE)
draw.line([(RIGHT - draw.textlength(He("[\u05e9\u05dd \u05d4\u05d0\u05d9\u05e8\u05d5\u05e2]"), font=tf), HERO_H - 30 * SS),
           (RIGHT, HERO_H - 30 * SS)], fill=ORANGE, width=6 * SS)

# ===================== THE NOTE ======================================
yc = HERO_H + 58 * SS
hkf = f_sb(32 * SS); hkl = gh(hkf) + 16 * SS
for ln in ["\u05d9\u05e9 \u05e8\u05d2\u05e2 \u05d0\u05d7\u05d3 \u05d1\u05d9\u05d5\u05dd \u05d4\u05d4\u05d5\u05dc\u05d3\u05ea \u05e9\u05d1\u05d5 \u05db\u05d5\u05dc\u05dd \u05e9\u05d5\u05ea\u05e7\u05d9\u05dd:",
           "\u05d4\u05e9\u05e0\u05d9\u05d9\u05d4 \u05dc\u05e4\u05e0\u05d9 \u05e9\u05d4\u05de\u05e9\u05d9\u05de\u05d4 \u05d4\u05e8\u05d0\u05e9\u05d5\u05e0\u05d4 \u05e0\u05e4\u05ea\u05d7\u05ea \u05d1\u05d8\u05dc\u05e4\u05d5\u05df."]:
    rtext(yc, ln, hkf, fill=INK); yc += hkl
yc += 32 * SS

nf = f_reg(29 * SS); nlead = gh(nf) + 14 * SS
for ln in ["\u05d0\u05e0\u05d9 [\u05d4\u05e9\u05dd], \u05de\u05d0\u05e8\u05d2\u05df/\u05ea \u05d9\u05de\u05d9 \u05d4\u05d5\u05dc\u05d3\u05ea \u05d0\u05e7\u05e9\u05df.",
           "\u05d4\u05e6\u05d5\u05d5\u05ea\u05d9\u05dd \u05e8\u05e6\u05d9\u05dd \u05d1\u05d9\u05df \u05ea\u05d7\u05e0\u05d5\u05ea \u05e2\u05dd \u05de\u05e9\u05d9\u05de\u05d5\u05ea \u05d1\u05d8\u05dc\u05e4\u05d5\u05df,",
           "\u05d5\u05db\u05dc \u05d0\u05d9\u05e8\u05d5\u05e2 \u05e0\u05d1\u05e0\u05d4 \u05e1\u05d1\u05d9\u05d1\u05db\u05dd."]:
    rtext(yc, ln, nf, fill=SOFT); yc += nlead
yc += 34 * SS

lbf = f_sb(29 * SS); bdf = f_reg(29 * SS)
def labeled(y, label, rest):
    lab = He(label); lw = draw.textlength(lab, font=lbf)
    draw.text((RIGHT - lw, y), lab, font=lbf, fill=ORANGE_DK)
    rst = He(rest)
    draw.text((RIGHT - lw - 12 * SS - draw.textlength(rst, font=bdf), y), rst, font=bdf, fill=INK)
labeled(yc, "\u05dc\u05d4\u05d5\u05e8\u05d9\u05dd:", "\u05d0\u05ea\u05dd \u05ea\u05d3\u05d0\u05d2\u05d5 \u05dc\u05db\u05d9\u05d1\u05d5\u05d3, \u05d0\u05e0\u05d9 \u05d0\u05d3\u05d0\u05d2 \u05dc\u05ea\u05d5\u05db\u05df \u05e9\u05dc\u05d0 \u05d9\u05d9\u05e9\u05db\u05d7.")
yc += gh(bdf) + 20 * SS
labeled(yc, "\u05dc\u05d9\u05dc\u05d3\u05d9\u05dd:", "\u05d9\u05d5\u05dd \u05d4\u05d4\u05d5\u05dc\u05d3\u05ea \u05e9\u05d9\u05d3\u05d1\u05e8\u05d5 \u05e2\u05dc\u05d9\u05d5 \u05d1\u05db\u05d9\u05ea\u05d4 \u05e9\u05d1\u05d5\u05e2\u05d9\u05d9\u05dd.")
yc += gh(bdf) + 34 * SS

of = f_sb(29 * SS)
draw.line([(RIGHT - 430 * SS, yc - 12 * SS), (RIGHT, yc - 12 * SS)], fill=ORANGE, width=3 * SS)
rtext(yc, "5 \u05d4\u05d0\u05d9\u05e8\u05d5\u05e2\u05d9\u05dd \u05d4\u05e8\u05d0\u05e9\u05d5\u05e0\u05d9\u05dd \u05d1\u05de\u05d7\u05d9\u05e8 \u05d4\u05d9\u05db\u05e8\u05d5\u05ea.", of, fill=INK)
yc += gh(of) + 28 * SS

# ===================== TWO PHOTO FRAMES ==============================
gap = 26 * SS
tw = (W - 2 * M - gap) // 2
tph = int(tw * 0.70)
frame(M, yc, M + tw, yc + tph, "\u05d4\u05e6\u05d5\u05d5\u05ea \u05d1\u05de\u05e9\u05d7\u05e7")
frame(M + tw + gap, yc, M + 2 * tw + gap, yc + tph, "\u05d4\u05d0\u05e4\u05dc\u05d9\u05e7\u05e6\u05d9\u05d4 \u05d1\u05e4\u05e2\u05d5\u05dc\u05d4")
yc += tph + 30 * SS

# ===================== CTA + SIGNATURE ==============================
cf = f_sb(31 * SS)
rtext(yc, "\u05e8\u05d5\u05e6\u05d9\u05dd \u05db\u05d6\u05d4 \u05dc\u05d9\u05d5\u05dd \u05d4\u05d5\u05dc\u05d3\u05ea? \u05db\u05ea\u05d1\u05d5 \u05dc\u05d9:", cf); yc += gh(cf) + 20 * SS
pf = f_mono(64 * SS)
pw = draw.textlength(PHONE, font=pf)
draw.text((RIGHT - pw, yc), PHONE, font=pf, fill=ORANGE_DK)
draw.line([(RIGHT - pw, yc + gh(pf) + 12 * SS), (RIGHT, yc + gh(pf) + 12 * SS)], fill=(*ORANGE_DK, 150), width=3 * SS)
yc += gh(pf) + 38 * SS
sgf = f_sig(30 * SS)
rtext(yc, "\u05e9\u05dc\u05db\u05dd, [\u05d4\u05e9\u05dd]", sgf, fill=INK)
yc += gh(sgf) + 24 * SS
rpf = f_sb(21 * SS)
rtext(yc, "\u05de\u05d5\u05e4\u05e2\u05dc \u05e2\u05dc RushPoint \u00b7 \u05e4\u05dc\u05d8\u05e4\u05d5\u05e8\u05de\u05d4 \u05de\u05e7\u05e6\u05d5\u05e2\u05d9\u05ea \u05dc\u05de\u05e9\u05d7\u05e7\u05d9 \u05e4\u05e2\u05d5\u05dc\u05d4", rpf, fill=(*SOFT, 160))

draw.rectangle([M // 2, M // 2, W - M // 2, H - M // 2], outline=(*INK, 70), width=2 * SS)
print("content bottom:", (yc + gh(rpf)) / SS, "frame:", (H - M // 2) / SS)
out = img.resize((W // SS, H // SS), Image.LANCZOS)
out.save(os.path.join(OUT, "tpl-story.png"), quality=95)
print("wrote tpl-story.png")
