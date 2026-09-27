# -*- coding: utf-8 -*-
"""המירוץ בבית — bold story image (1080x1920) aimed at PARENTS.
Deliberately different from the topographic neighbourhood poster: dark ground,
huge type, a floor-plan instead of contour lines, and FREE as the loudest thing
after the title. No QR — the link is pasted under the story.
One running cursor + measured glyph heights, so nothing can overlap."""
import os, math
from PIL import Image, ImageDraw, ImageFont
from bidi.algorithm import get_display

OUT = os.path.dirname(os.path.abspath(__file__))
SS = 2
W, H = 1080 * SS, 1920 * SS
M = 76 * SS

INK    = (22, 20, 17)          # ground
INK_2  = (34, 31, 26)
BONE   = (247, 241, 230)
SOFT   = (112, 102, 88)
ORANGE = (232, 88, 30)
ORANGE_D = (176, 58, 16)
LINE   = (146, 133, 114)       # floor-plan line art on the light ground

FD = "C:/Windows/Fonts/"
def wf(n, s): return ImageFont.truetype(FD + n, s)
f_head = lambda s: wf("ahronbd.ttf", s)
f_bold = lambda s: wf("segoeuib.ttf", s)
f_sb   = lambda s: wf("seguisb.ttf", s)
f_reg  = lambda s: wf("segoeui.ttf", s)
f_mono = lambda s: ImageFont.truetype(
    r"C:\Users\savir\AppData\Roaming\Claude\local-agent-mode-sessions\skills-plugin\4f382392-26bd-48f4-8d04-454ab8137a93\56bb1f00-8a70-4d1b-b7dc-e858268f2abf\skills\canvas-design\canvas-fonts\JetBrainsMono-Bold.ttf", s)
def He(s): return get_display(s, base_dir='R')

img = Image.new("RGB", (W, H), BONE)
draw = ImageDraw.Draw(img, "RGBA")

RIGHT = W - M
def gh(f, s="Aבגהקך0"):
    b = f.getbbox(s); return b[3]-b[1]
def tl(s, f): return draw.textlength(He(s), font=f)
def rtext(y, s, f, fill=INK, right=RIGHT, tracking=0):
    d = He(s)
    if not tracking:
        draw.text((right - draw.textlength(d, font=f), y), d, font=f, fill=fill); return
    ws = [draw.textlength(c, font=f) for c in d]
    x = right - (sum(ws) + tracking*(len(d)-1))
    for c, w in zip(d, ws):
        draw.text((x, y), c, font=f, fill=fill); x += w + tracking
def ctext(cx, y, s, f, fill=INK):
    d = He(s); draw.text((cx - draw.textlength(d, font=f)/2, y), d, font=f, fill=fill)

# ── faint floor-plan wash across the whole ground ─────────────────────
plan = Image.new("RGBA", (W, H), (0,0,0,0))
pd = ImageDraw.Draw(plan, "RGBA")
px0, py0, px1, py1 = int(W*0.06), int(H*0.478), int(W*0.94), int(H*0.738)
pd.rectangle([px0, py0, px1, py1], outline=(*LINE, 210), width=5*SS)
midx = int(px0 + (px1-px0)*0.54)
midy = int(py0 + (py1-py0)*0.52)
for seg in [ [(midx, py0), (midx, midy)], [(px0, midy), (px1, midy)],
             [(int(px0+(midx-px0)*0.55), midy), (int(px0+(midx-px0)*0.55), py1)] ]:
    pd.line(seg, fill=(*LINE, 190), width=5*SS)
# doorway gaps punched back out in the ground colour
for gap in [ (midx, int(py0+(midy-py0)*0.62), 0), (int(px0+(px1-px0)*0.30), midy, 1),
             (int(px0+(px1-px0)*0.80), midy, 1) ]:
    gx, gy, horiz = gap
    if horiz: pd.line([(gx-46*SS, gy), (gx+46*SS, gy)], fill=(*BONE, 255), width=11*SS)
    else:     pd.line([(gx, gy-46*SS), (gx, gy+46*SS)], fill=(*BONE, 255), width=11*SS)
img = Image.alpha_composite(img.convert("RGBA"), plan).convert("RGB")
draw = ImageDraw.Draw(img, "RGBA")

# room labels + numbered mission pins on the plan
ROOMS = [("חדר ילדים", 0.24, 0.545, 1), ("סלון", 0.68, 0.545, 2),
         ("מטבח", 0.20, 0.678, 3), ("אמבטיה", 0.62, 0.678, 4)]
pts = [(W*r[1], H*r[2]) for r in ROOMS]
for a, b in zip(pts, pts[1:]):
    dist = math.hypot(b[0]-a[0], b[1]-a[1]); steps = max(int(dist/(30*SS)), 1)
    for k in range(steps):
        if k % 2: continue
        t0, t1 = k/steps, min((k+0.62)/steps, 1)
        draw.line([(a[0]+(b[0]-a[0])*t0, a[1]+(b[1]-a[1])*t0),
                   (a[0]+(b[0]-a[0])*t1, a[1]+(b[1]-a[1])*t1)], fill=(*ORANGE, 170), width=7*SS)
for name, fx, fy, n in ROOMS:
    cx, cy = W*fx, H*fy
    draw.text((cx, cy - 68*SS), He(name), font=f_sb(26*SS), fill=(*SOFT, 205), anchor="mm")
    r = 42*SS
    draw.ellipse([cx-r, cy-r, cx+r, cy+r], fill=ORANGE, outline=BONE, width=6*SS)
    draw.text((cx, cy), str(n), font=f_mono(38*SS), fill=BONE, anchor="mm")

# ═══════════════ TYPE ═══════════════
yc = M + 30*SS

kf = f_sb(30*SS)
draw.line([(RIGHT-360*SS, yc-4*SS), (RIGHT, yc-4*SS)], fill=ORANGE, width=4*SS)
rtext(yc + 14*SS, "משחק בית · לכל המשפחה", kf, fill=SOFT, tracking=6*SS)
yc += gh(kf) + 52*SS

TF = f_head(176*SS)
rtext(yc, "המירוץ", TF, fill=INK); yc += gh(TF) + 22*SS
rtext(yc, "בבית", TF, fill=ORANGE); yc += gh(TF) + 34*SS

sf = f_bold(46*SS)
rtext(yc, "המשחק שהופך את סידור הבית", sf, fill=INK); yc += gh(sf) + 14*SS
rtext(yc, "למירוץ בין צוותים", sf, fill=INK); yc += gh(sf) + 44*SS

# ── FREE badge: the loudest thing after the title ──
ff1, ff2 = f_head(96*SS), f_sb(32*SS)
bt1, bt2 = "חינם לגמרי", "בלי תשלום, בלי הרשמה"
bw = max(tl(bt1, ff1), tl(bt2, ff2)) + 76*SS
bh = 34*SS + gh(ff1) + 16*SS + gh(ff2) + 32*SS
draw.rounded_rectangle([RIGHT-bw, yc, RIGHT, yc+bh], radius=20*SS, fill=ORANGE)
ctext(RIGHT-bw/2, yc + 34*SS, bt1, ff1, fill=BONE)
ctext(RIGHT-bw/2, yc + 34*SS + gh(ff1) + 16*SS, bt2, ff2, fill=(*BONE, 225))
yc += bh

# ── the three how-it-works lines, under the plan band ──
yc = int(H*0.762)
nf, numf = f_reg(38*SS), f_mono(30*SS)
for i, line in enumerate(["מחלקים את הילדים לצוותים",
                          "כל צוות מקבל משימות בטלפון",
                          "מסדרים, משתפים פעולה, צוברים נקודות"]):
    cy = yc + gh(nf)/2
    draw.ellipse([RIGHT-46*SS, cy-23*SS, RIGHT, cy+23*SS], outline=ORANGE, width=4*SS)
    draw.text((RIGHT-23*SS, cy), str(i+1), font=numf, fill=ORANGE_D, anchor="mm")
    rtext(yc, line, nf, fill=INK, right=RIGHT-70*SS)
    yc += gh(nf) + 26*SS
yc += 16*SS

pf = f_sb(32*SS)
rtext(yc, "בלי הכנות · בלי ציוד · תוך דקה אתם משחקים", pf, fill=SOFT)
yc += gh(pf) + 52*SS

cf = f_bold(44*SS)
rtext(yc, "הקישור למשחק למטה", cf, fill=ORANGE)
yc += gh(cf) + 44*SS

rf = f_sb(24*SS)
rtext(yc, "מופעל על RushPoint · פלטפורמה מקצועית למשחקי פעולה", rf, fill=(*SOFT, 210))

draw.rectangle([M//2, M//2, W-M//2, H-M//2], outline=(*SOFT, 90), width=2*SS)
print("content bottom:", (yc + gh(rf))/SS, " frame:", (H-M//2)/SS)
out = img.resize((W//SS, H//SS), Image.LANCZOS)
p = os.path.join(OUT, "mirotz-babait-story.png")
out.save(p, quality=95); print("wrote", p)
