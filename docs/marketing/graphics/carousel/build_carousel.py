# -*- coding: utf-8 -*-
"""RushPoint carousel — "5 כלים שעזרו לי ויעזרו לכם" (8 slides, 1080x1350).

Three ideas hold this together.

1) NARRATIVE. The five tools are ordered as the JOURNEY they were used in —
   research, code, branding, decks, video — because the promise is "from zero to
   marketing" and a stranger can only follow that if the slides walk it in order.
   This deliberately gives up the earlier twist (the quiet research tool was
   secretly first); it is openly first now. Comprehension beat the twist, because
   a twist nobody follows is not a twist.

2) STRUCTURE (Pubity-adapted). A full-bleed visual on top, a solid bar below
   carrying heavy type set edge to edge, the channel badge on the seam, a SWIPE
   cue in the corner. Type is never "placed at a size": every line is FITTED to
   the column width and to the height it is allowed, which is what makes text
   look like it fills the frame instead of floating in it.

3) CONTINUITY. The eight slides are crops of ONE 8640x1350 survey sheet.
   Contours and the ORANGE route are plotted in global coordinates and drawn with
   an x-offset per slide, so the route crosses every seam unbroken — Contour
   Kinetics' central gesture, the bleed-across-the-seam retention technique, and
   a re-enactment of the product's own loop, in one device.

No hyphens or dashes anywhere in the copy, by instruction.

Run: PYTHONUTF8=1 python docs/marketing/carousel/build_carousel.py
"""
import os, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from bidi.algorithm import get_display
import svgpath
import sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '.claude', 'skills', 'social-carousel', 'scripts'))
from layout_guard import Guard, text_box, LayoutError
GUARD = None

OUT = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(OUT, "assets")
REPO = os.path.abspath(os.path.join(OUT, "..", "..", ".."))
SS = 2
W, H = 1080 * SS, 1350 * SS
N = 8
GW = W * N
PAD = 52 * SS
BAR_H = int(H * 0.335)
CLOSE_BAR_H = int(H * 0.165)        # the final slide's bar is half height, so the
                                    # slogan above it can be the largest thing there

BONE      = (245, 238, 225)
INK       = (26, 24, 20)
SOFT      = (78, 71, 60)
ORANGE    = (214, 78, 24)
ORANGE_LT = (255, 128, 60)
GREEN     = (74, 92, 74)
CYAN      = (56, 182, 218)

TOOLKIT = "C:/Users/savir/.claude/toolkits/video-editing/fonts/"
def rubik(size, weight="Black"):
    f = ImageFont.truetype(TOOLKIT + "Rubik.ttf", int(size)); f.set_variation_by_name(weight); return f
def heebo(size, weight="Bold"):
    f = ImageFont.truetype(TOOLKIT + "Heebo.ttf", int(size)); f.set_variation_by_name(weight); return f
def mono(size, bold=True):
    return ImageFont.truetype("C:/Windows/Fonts/consola%s.ttf" % ("b" if bold else ""), int(size))

def He(s):
    return get_display(s, base_dir="R")

_probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
def gh(f, s="אבגהלקךAy0"):
    b = f.getbbox(s); return b[3] - b[1]

def fit_block(lines, target_w, max_h, maker=rubik, weight="Black", lead=0.12):
    """One size for a block, constrained by BOTH width and height. Width-only
    fitting overflowed the caption bar: two full-width lines of a heavy face are
    taller than the bar, and nothing in a width-only fit can know that."""
    lo, hi, best = 16 * SS, 260 * SS, 16 * SS
    while lo <= hi:
        mid = (lo + hi) // 2
        f = maker(mid, weight)
        widest = max(_probe.textlength(He(t), font=f) for t in lines)
        if widest <= target_w and len(lines) * gh(f) * (1 + lead) <= max_h:
            best = mid; lo = mid + 1
        else:
            hi = mid - 1
    return maker(best, weight)

def draw_block(d, lines, y, target_w, max_h, fill, maker=rubik, weight="Black", lead=0.12):
    """Centred. Right-aligned Hebrew left every short line hugging one edge with a
    dead margin opposite it."""
    f = fit_block(lines, target_w, max_h, maker, weight, lead)
    step = gh(f) * (1 + lead)
    for t in lines:
        disp = He(t)
        xy = ((W - _probe.textlength(disp, font=f)) / 2, y)
        d.text(xy, disp, font=f, fill=fill)
        if GUARD: GUARD.add("text", text_box(d, xy, disp, f))
        y += step
    return y

def draw_glyph_centred(d, cx, cy, text, font, fill):
    """Centre a glyph on a point using its OWN ink bounds.

    Positioning by `textlength` and a hand-tuned fraction of the line height is a
    guess: it ignores side bearings and the gap between the glyph's ink and its
    em box, which is why the question marks sat low and slightly off axis inside
    their circles. getbbox reports where the ink actually lands."""
    x0, y0, x1, y1 = font.getbbox(text)
    d.text((cx - (x0 + x1) / 2, cy - (y0 + y1) / 2), text, font=font, fill=fill)

def teaser(d, text, colour=ORANGE_LT):
    """The line that points at the next slide. Deliberately blunt: a label plus one
    surprising fact. Earlier versions were riddles set small in a corner, and a
    riddle nobody reads is not an open loop, it is noise."""
    f = heebo(36 * SS, "Bold")
    t = He(text)
    xy = ((W - _probe.textlength(t, font=f)) / 2, H - PAD - gh(f) - 4 * SS)
    d.text(xy, t, font=f, fill=colour)
    if GUARD: GUARD.add("teaser", text_box(d, xy, t, f))

TEASER_H = gh(heebo(36 * SS, "Bold")) + 30 * SS

# ---------------------------------------------------------------- global sheet
def contour_family(cx, cy, n, step, seed, squash=0.9, max_r=None):
    rng = np.random.default_rng(int(seed * 1000))
    ph = rng.uniform(0, 2 * math.pi, 6)
    th = np.linspace(0, 2 * math.pi, 620)
    out = []
    for i in range(1, n):
        r = i * step * (0.55 + 0.45 * abs(math.sin(i * 0.17 + seed)))
        if max_r and r > max_r:
            break
        rad = r * (1 + 0.075 * np.sin(3 * th + ph[0]) + 0.045 * np.sin(5 * th + ph[1])
                     + 0.028 * np.sin(2 * th + ph[2]))
        out.append((list(zip((cx + rad * np.cos(th)).tolist(),
                             (cy + rad * np.sin(th) * squash).tolist())), i))
    return out

TOP_H = H - BAR_H
FIELD = []
for cx, cy, n, st, sd, mr in [
        (0.40, 1.05, 58, 42, 3.1, 0.78), (2.10, 0.02, 46, 46, 5.7, 0.66),
        (3.70, 1.04, 44, 48, 1.9, 0.60), (5.30, 0.04, 42, 44, 6.4, 0.62),
        (7.40, 0.32, 40, 27, 8.3, 0.52)]:
    FIELD += contour_family(int(W * cx), int(TOP_H * cy), n, st * SS, sd, 0.91,
                            max_r=int(H * mr))

def route_y(xg):
    """A LOW, gently rising line. The steep climb it replaced put the route through
    the tool name on slides 6 and 7, caught by the layout guard, not by eye."""
    t = xg / GW
    wob = (TOP_H * 0.011) * math.sin(t * 15.0) + (TOP_H * 0.006) * math.sin(t * 34.0 + 1.2)
    return TOP_H * 0.955 - (TOP_H * 0.025) * t + wob

ROUTE = [(x, route_y(x)) for x in range(0, GW, 6 * SS)]
STATION_IDX = [2, 3, 4, 5, 6]                       # slides carrying a tool
STATION_X = [int(W * (i + 0.5)) for i in STATION_IDX]

def dashed(d, pts, dx, fill, width, dash=22 * SS, gap=15 * SS):
    acc, on = 0.0, True
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        dist = math.hypot(x1 - x0, y1 - y0)
        if dist == 0:
            continue
        rem, pos = dist, 0.0
        while rem > 0:
            step = min((dash if on else gap) - acc, rem)
            a, b = pos / dist, (pos + step) / dist
            if on:
                p0 = (x0 + (x1 - x0) * a + dx, y0 + (y1 - y0) * a)
                p1 = (x0 + (x1 - x0) * b + dx, y0 + (y1 - y0) * b)
                if not (max(p0[0], p1[0]) < -40 or min(p0[0], p1[0]) > W + 40):
                    d.line([p0, p1], fill=fill, width=width)
            acc += step; pos += step; rem -= step
            if acc >= (dash if on else gap) - 1e-3:
                on = not on; acc = 0.0

# ---------------------------------------------------------------- product marks
# Official marks. The two added later are not single-path icons: Gamma wraps its
# glyph in a gradient disc (path 0 is skipped or it renders as a filled circle),
# and Luma is six translucent facets, flattened here to a solid silhouette so all
# five marks read as one family.
MARKS = {
    "perplexity":   dict(file="perplexity.svg"),
    "claude":       dict(file="claude.svg"),
    "googlegemini": dict(file="googlegemini.svg"),
    "gamma":        dict(file="gamma.svg", multi=True, skip=(0,)),
    "luma":         dict(file="luma.svg", multi=True, alpha_scale=1.6),
}
_LOGO_CACHE = {}
def logo(name, size, colour):
    key = (name, int(size), colour)
    if key not in _LOGO_CACHE:
        spec = MARKS[name]
        svg = open(os.path.join(ASSETS, spec["file"]), encoding="utf-8").read()
        if spec.get("multi"):
            im = svgpath.render_multi(svg, int(size), colour, skip=spec.get("skip", ()),
                                      alpha_scale=spec.get("alpha_scale", 1.0))
        else:
            im = svgpath.render(svg, int(size), colour, pad=0.0)
        _LOGO_CACHE[key] = im
    return _LOGO_CACHE[key]

def compass(d, cx, cy, r, ink, accent=ORANGE):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(*ink, 255), width=max(3, int(r * 0.13)))
    d.arc([cx - r, cy - r, cx + r, cy + r], -68, 22, fill=(*CYAN, 255), width=max(3, int(r * 0.17)))
    a = math.radians(-42)
    px, py = -math.sin(a) * r * 0.21, math.cos(a) * r * 0.21
    d.polygon([(cx + r * 0.80 * math.cos(a), cy + r * 0.80 * math.sin(a)), (cx + px, cy + py),
               (cx - r * 0.66 * math.cos(a), cy - r * 0.66 * math.sin(a)), (cx - px, cy - py)],
              fill=accent)
    d.ellipse([cx - r * 0.14, cy - r * 0.14, cx + r * 0.14, cy + r * 0.14], fill=ink)

# ---------------------------------------------------------------- slide shell
ORDER = ["perplexity", "claude", "googlegemini", "gamma", "luma"]

def grid_height(r, rows=2, label=20, pad=34 * SS):
    row_h = 2 * r + label * SS + 16 * SS
    return rows * row_h + (14 * SS if rows > 1 else 0)

def badge_grid(d, img, y_top, r, revealed, dark=False, gap=None, label=20, rows=2, bg=None):
    """Five badges laid out 3 over 2, centred.

    A single row of five forces each badge small enough to stop registering; two
    rows let them be roughly twice the diameter in the same column width, and the
    3+2 shape reads as a set rather than a queue. Unrevealed stations stay a
    question mark so the reader can SEE how much is still unknown."""
    dim = (150, 140, 124) if dark else SOFT
    gap = gap if gap is not None else 30 * SS
    lf = mono(int(label * SS))
    row_h = 2 * r + label * SS + 16 * SS
    layout = ((0, 3), (1, 2)) if rows > 1 else ((0, 5),)
    for row, count in layout:
        cy = y_top + r + row * (row_h + 14 * SS)
        step = 2 * r + gap
        x0 = W // 2 - (count - 1) * step / 2
        for j in range(count):
            k = row * 3 + j
            cx = x0 + j * step
            live = k < revealed
            # unrevealed badges are filled with the page colour, not left hollow:
            # the ORANGE route runs behind this band and was showing straight
            # through the question marks
            d.ellipse([cx - r, cy - r, cx + r, cy + r],
                      fill=(ORANGE if live else (bg or (INK if dark else BONE))),
                      outline=(ORANGE if live else (*dim, 200)), width=max(4, int(r * 0.075)))
            if live:
                s = int(r * 1.10)
                lg = logo(ORDER[k], s, BONE)
                img.paste(lg.convert("RGB"), (int(cx - s / 2), int(cy - s / 2)), lg)
            else:
                draw_glyph_centred(d, cx, cy, "?", rubik(r * 1.30, "Black"),
                                   (*(dim if dark else INK), 235))
            lab = "0%d" % (k + 1)
            d.text((cx - _probe.textlength(lab, font=lf) / 2, cy + r + 12 * SS), lab,
                   font=lf, fill=(*(ORANGE if live else dim), 230))
            if GUARD: GUARD.add("badge", (cx - r, cy - r, cx + r, cy + r + 12 * SS + label * SS + 6 * SS))
    return y_top + 2 * row_h + 14 * SS

def new_slide(idx, dark=False, bar_col=None, bar_h=None, route=True):
    global GUARD
    GUARD = Guard(W, H)
    # the route is ALLOWED to pass behind filled badges and under the seam badge;
    # everything else it touches is a real collision
    GUARD.allow("route", "badge"); GUARD.allow("route", "station_dot")
    GUARD.allow("badge", "station_dot"); GUARD.allow("route", "seam_badge")
    GUARD.allow("station_dot", "seam_badge")   # the badge is opaque and drawn last
    bar_h = bar_h or BAR_H
    top_bg = INK if dark else BONE
    img = Image.new("RGB", (W, H), top_bg)
    dx = -idx * W

    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer, "RGBA")
    base = BONE if dark else INK
    for pts, i in FIELD:
        xs = [p[0] + dx for p in pts]
        if max(xs) < -60 or min(xs) > W + 60:
            continue
        major = (i % 5 == 0)
        a = (44 if major else 26) if not dark else (38 if major else 21)
        col = (*GREEN, a) if (i % 7 == 0) else (*base, a)
        ld.line([(p[0] + dx, p[1]) for p in pts], fill=col,
                width=(3 * SS if major else 2 * SS), joint="curve")
    img = Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")
    d = ImageDraw.Draw(img, "RGBA")

    # The route runs slides 1 to 7 and stops. On the closing slide it is switched
    # off rather than routed around: the alternative was a photo tall enough to
    # cover it, which shrank the slogan that slide exists to deliver. The journey
    # ending at its destination is also the honest reading.
    if route:
        dashed(d, ROUTE, dx, (*ORANGE, 255), 5 * SS)
        chunk = W // 8
        for c in range(8):
            ys = [route_y(x) for x in range(idx * W + c * chunk, idx * W + (c + 1) * chunk, 8 * SS)]
            GUARD.add("route", (c * chunk, min(ys) - 3 * SS, (c + 1) * chunk, max(ys) + 3 * SS))
        for si, sx in enumerate(STATION_X):
            x = sx + dx
            if -70 < x < W + 70:
                sy = route_y(sx)
                reached = idx >= STATION_IDX[si]
                r = 12 * SS
                d.ellipse([x - r, sy - r, x + r, sy + r],
                          fill=(ORANGE if reached else top_bg),
                          outline=(ORANGE if reached else (*SOFT, 170)), width=3 * SS)
                GUARD.add("station_dot", (x - r, sy - r, x + r, sy + r))

    bar_top = H - bar_h
    d.rectangle([0, bar_top, W, H], fill=(bar_col or (INK if not dark else (12, 11, 9))))
    return img, d, bar_top

def swipe_badge(d, dark=False):
    bw, bh = 152 * SS, 46 * SS
    x, y = W - PAD - bw, PAD - 6 * SS
    d.rounded_rectangle([x, y, x + bw, y + bh], radius=bh // 2, fill=(*ORANGE, 255))
    if GUARD: GUARD.add("corner_badge", (x, y, x + bw, y + bh))
    f = mono(19 * SS)
    d.text((x + 26 * SS, y + (bh - gh(f)) / 2 - 2 * SS), "SWIPE", font=f, fill=BONE)
    ax, ay = x + bw - 34 * SS, y + bh / 2
    d.line([(ax - 11 * SS, ay), (ax + 5 * SS, ay)], fill=BONE, width=3 * SS)
    d.polygon([(ax + 12 * SS, ay), (ax + 2 * SS, ay - 8 * SS), (ax + 2 * SS, ay + 8 * SS)], fill=BONE)

def follow_badge(d):
    """The corner badge's last meaning.

    Slides 1 to 7 carry a SWIPE badge in this exact slot; on the closing slide
    there is nothing left to swipe to, so the same shape in the same place says
    עקבו instead. The reader has decoded that badge seven times by now, so the
    call to action costs no explanation and no vertical space."""
    f = heebo(27 * SS, "Bold")
    t = He("עקבו")
    tw = _probe.textlength(t, font=f)
    bh = 52 * SS
    bw = tw + 96 * SS
    x, y = W - PAD - bw, PAD - 9 * SS
    d.rounded_rectangle([x, y, x + bw, y + bh], radius=bh // 2, fill=ORANGE)
    if GUARD: GUARD.add("corner_badge", (x, y, x + bw, y + bh))
    d.text((x + 30 * SS, y + (bh - gh(f)) / 2 - 2 * SS), t, font=f, fill=BONE)
    cx, cy, r = x + bw - 33 * SS, y + bh / 2, 15 * SS
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=BONE, width=3 * SS)
    d.line([(cx - r * 0.50, cy), (cx + r * 0.50, cy)], fill=BONE, width=3 * SS)
    d.line([(cx, cy - r * 0.50), (cx, cy + r * 0.50)], fill=BONE, width=3 * SS)

def seam_mark(d, bar_top, fill=None):
    """The channel badge, straddling the seam. Solid rather than an outlined mark:
    a thin compass at 30px read as a watermark, which is the opposite of what a
    channel mark is for."""
    fill = fill or ORANGE
    f = rubik(31 * SS, "Black")
    tw = _probe.textlength("RushPoint", font=f)
    r = 40 * SS
    pw = tw + r * 2 + 62 * SS
    x0 = W // 2 - pw / 2
    d.rounded_rectangle([x0, bar_top - r, x0 + pw, bar_top + r], radius=r, fill=fill)
    if GUARD: GUARD.add("seam_badge", (x0, bar_top - r, x0 + pw, bar_top + r))
    compass(d, x0 + r + 6 * SS, bar_top, r * 0.62, BONE, BONE)
    d.text((x0 + r * 2 + 22 * SS, bar_top - gh(f) * 0.72), "RushPoint", font=f, fill=BONE)

def corner_stamp(d, idx, dark=False):
    f = mono(17 * SS)
    d.text((PAD + 2 * SS, PAD + 4 * SS), "FIELD LOG · %d/%d" % (idx + 1, N),
           font=f, fill=(*(SOFT if not dark else (150, 140, 124)), 215))

def save(img, name):
    n = GUARD.check(slide=name) if GUARD else 0
    img.resize((W // SS, H // SS), Image.LANCZOS).save(os.path.join(OUT, name), quality=96)
    print("wrote %-12s (%d boxes, no collisions)" % (name, n))

def fit_crop(path, tw, th, ybias=0.5):
    im = Image.open(path).convert("RGB")
    s = max(tw / im.width, th / im.height)
    im = im.resize((max(tw, int(im.width * s + .5)), max(th, int(im.height * s + .5))), Image.LANCZOS)
    x = (im.width - tw) // 2; y = int((im.height - th) * ybias)
    return im.crop((x, y, x + tw, y + th))

COL = W - 2 * PAD

# =====================================================================
def slide1():
    img, d, bar = new_slide(0)
    corner_stamp(d, 0)
    swipe_badge(d)
    draw_block(d, ["אין לי שותף.", "אין לי משקיע.", "ואין לי תואר."],
               PAD + 104 * SS, COL, bar - (PAD + 150 * SS), INK, lead=0.16)
    seam_mark(d, bar)
    draw_block(d, ["5 כלים שעזרו לי ויעזרו לכם", "לבנות כל דבר מאפס."],
               bar + 62 * SS, COL, BAR_H - 62 * SS - TEASER_H - 30 * SS, BONE)
    teaser(d, "בלי ניסיון. בלי תקציב.")
    save(img, "slide-1.png")

def slide2():
    """Answers the question the whole carousel used to leave open: what IS this
    app. A stranger cannot care which tools built something they cannot picture,
    so the product description gets the loudest slot on the slide."""
    img, d, bar = new_slide(1)
    corner_stamp(d, 1)
    swipe_badge(d)

    # The product description takes the top zone in full-size ink type, and the
    # five unknowns sit directly above the bar. The first arrangement floated the
    # marks in the middle with dead space above AND below them.
    # clearance below the grid is set by the seam badge, which straddles the bar
    # and was sitting on top of the 04/05 labels
    R = 84 * SS
    grid_top = bar - 96 * SS - grid_height(R, rows=2, label=20)

    draw_block(d, ["בניתי אפליקציה שהופכת", "כל שכונה למשחק מירוץ."],
               PAD + 88 * SS, COL, grid_top - (PAD + 128 * SS), INK, lead=0.14)
    badge_grid(d, img, grid_top, R, revealed=0, gap=34 * SS)

    seam_mark(d, bar)
    draw_block(d, ["ואלה 5 הכלים", "שבנו אותה."],
               bar + 62 * SS, COL, BAR_H - 62 * SS - TEASER_H - 30 * SS, BONE)
    teaser(d, "נתחיל מהראשון.")
    save(img, "slide-2.png")

def station_slide(idx, key, name, lead, punch, foot, dark=False):
    img, d, bar = new_slide(idx, dark)
    corner_stamp(d, idx, dark)
    swipe_badge(d, dark)
    ink = BONE if dark else INK
    dim = (160, 150, 134) if dark else SOFT
    num = STATION_IDX.index(idx) + 1

    # Mark and name both scaled up hard: at 100px the logo was a detail on a
    # mostly empty field. The name is FITTED to a fixed column so all five read at
    # the same optical weight however many letters they have.
    #
    # The five badges stay on ONE row here, unlike slide 2's 3+2 block. They are
    # doing a different job: there they are the subject (five unknowns, shown
    # large), here they are a progress rail. Two rows of them plus a 350px mark
    # does not fit the top zone, and when it was tried the rail landed on top of
    # the tool's own name.
    L = 350 * SS
    lg = logo(key, L, ORANGE if not dark else ORANGE_LT)
    img.paste(lg.convert("RGB"), (W // 2 - L // 2, PAD + 56 * SS), lg)
    d = ImageDraw.Draw(img, "RGBA")

    y = PAD + 56 * SS + L + 20 * SS
    nf = fit_block([name], int(COL * 0.76), 150 * SS)
    nxy = (W // 2 - _probe.textlength(name, font=nf) / 2, y)
    d.text(nxy, name, font=nf, fill=ink)
    if GUARD:
        GUARD.add("logo", (W // 2 - L // 2, PAD + 56 * SS, W // 2 + L // 2, PAD + 56 * SS + L))
        GUARD.add("tool_name", text_box(d, nxy, name, nf))
    y += gh(nf) + 22 * SS
    sf = mono(22 * SS)
    st = "STATION 0%d" % num
    d.text((W // 2 - _probe.textlength(st, font=sf) / 2, y), st, font=sf, fill=(*dim, 235))

    R = 48 * SS
    badge_grid(d, img, bar - 86 * SS - grid_height(R, rows=1, label=17), R,
               revealed=num, dark=dark, label=17, rows=1, gap=26 * SS)
    seam_mark(d, bar)

    yy = bar + 50 * SS
    # capped per line so the supporting sentence can never outgrow the payoff
    yy = draw_block(d, lead, yy, COL, len(lead) * 54 * SS, (*BONE, 235),
                    maker=heebo, weight="SemiBold", lead=0.18)
    yy += 20 * SS
    draw_block(d, punch, yy, COL, H - PAD - TEASER_H - 14 * SS - yy, BONE)
    teaser(d, foot)
    return img

def slide3():
    save(station_slide(
        2, "perplexity", "Perplexity",
        ["מנוע מחקר. שואלים אותו שאלה", "ומקבלים תשובה אמיתית עם מקורות."],
        ["ממנו התחיל", "כל הפרויקט."],
        "הבא: כתב את כל הקוד."), "slide-3.png")

def slide4():
    save(station_slide(
        3, "claude", "Claude",
        ["כותב קוד. כל האפליקציה נבנתה איתו.", "וגם מסדיר לי היעדרויות וקובע לי את הלוז."],
        ["אשכרה בנה", "לי אפליקציה."],
        "הבא: לא כותב שורת קוד."), "slide-4.png")

def slide5():
    save(station_slide(
        4, "googlegemini", "Gemini",
        ["מייצר תמונות ומיתוג.", "הלוגו, האייקונים והבאנרים של RushPoint."],
        ["כולם ממנו."],
        "הבא: הפך הכל למצגת."), "slide-5.png")

def slide6():
    save(station_slide(
        5, "gamma", "Gamma",
        ["בונה מצגת שלמה מטקסט אחד שכותבים לו."],
        ["מצגת בדקה,", "לא ביום."],
        "שמור את זה. הבא הופך הכל לסרטון."), "slide-6.png")

def slide7():
    save(station_slide(
        6, "luma", "Luma AI",
        ["מייצר סרטונים מטקסט או מתמונה אחת."],
        ["הסרטונים", "שאתם רואים."],
        "נשאר דבר אחד.", dark=True), "slide-7.png")

def you_are_here(d, y, dark=False):
    """The map convention, used as the follow argument.

    The route has climbed for seven slides; here it reaches a marker reading
    "you are here" and then carries on off the frame, dashed and fading, with no
    destination drawn. Everyone reads that instantly and without explanation, it
    is the brand's own language (Contour Kinetics: the lines "run off as though
    the land continues"), and it turns "the journey is still going and you are
    joining now" from a claim into something visible.

    It replaced a strip of locked station badges promising more posts. That was
    built on the wrong motive: people do not follow this account to collect
    another tips post, they follow to watch whether the thing works.
    """
    ink = BONE if dark else INK
    x_mark = int(W * 0.40)

    # solid behind the marker, dashes ahead of it that both lengthen and fade,
    # so the line reads as running out of map rather than simply stopping
    d.line([(0, y), (x_mark, y)], fill=(*ORANGE, 255), width=6 * SS)
    x = x_mark + 34 * SS
    seg = 30 * SS
    while x < W:
        t = (x - x_mark) / (W - x_mark)
        a = max(0, int(255 * (1 - t) ** 0.85))
        d.line([(x, y), (min(x + seg, W), y)], fill=(*ORANGE, a), width=6 * SS)
        x += seg + 20 * SS + t * 46 * SS
        seg = max(10 * SS, seg - 3 * SS)

    r = 24 * SS
    d.ellipse([x_mark - r - 13 * SS, y - r - 13 * SS, x_mark + r + 13 * SS, y + r + 13 * SS],
              outline=(*ORANGE, 120), width=3 * SS)
    d.ellipse([x_mark - r, y - r, x_mark + r, y + r], fill=ORANGE)

    # label sits BELOW the marker: beside it, it collided with the dashes it is
    # meant to be pointing along
    f = heebo(31 * SS, "Bold")
    t = He("אתם כאן")
    d.text((x_mark - _probe.textlength(t, font=f) / 2, y + r + 20 * SS), t, font=f, fill=ink)

def slide8(setup, payoff, name="slide-8.png", kicker=None):
    """The close. The bar is half height on purpose: the slogan has to be the
    largest thing on the slide, and it cannot be while a full caption bar takes a
    third of the page."""
    img, d, bar = new_slide(7, bar_col=ORANGE, bar_h=CLOSE_BAR_H, route=False)
    corner_stamp(d, 7)
    follow_badge(d)
    top_h = H - CLOSE_BAR_H

    PH = 330 * SS
    HERE_H = 166 * SS
    room = (top_h - PH - HERE_H) - (PAD + 86 * SS) - 26 * SS
    y = draw_block(d, setup, PAD + 86 * SS, COL, room * 0.38, INK)
    y += 18 * SS
    end = (top_h - PH - HERE_H) - y - 20 * SS
    if kicker:
        end -= 72 * SS
    y = draw_block(d, payoff, y, COL, end, ORANGE)
    if kicker:
        kf = heebo(32 * SS, "SemiBold")
        t = He(kicker)
        d.text(((W - _probe.textlength(t, font=kf)) / 2, y + 20 * SS), t,
               font=kf, fill=(*SOFT, 255))

    you_are_here(d, top_h - PH - HERE_H // 2)

    photo = fit_crop(os.path.join(REPO, "docs/marketing/poster/src_2.jpg"), W, PH, ybias=0.55)
    img.paste(photo, (0, bar - PH))
    d = ImageDraw.Draw(img, "RGBA")
    seam_mark(d, bar, fill=INK)
    draw_block(d, ["המשחק יוצא החוצה"], bar + 76 * SS, int(COL * 0.86),
               CLOSE_BAR_H - 100 * SS, BONE)
    save(img, name)

# The close works on PARTICIPATION, not spectatorship. "Come, let's turn it into
# a brand" opens the control route to psychological ownership, the strongest of
# the three, and it is an invitation rather than a prediction.
#
# Phrasing note: the founder's draft was "תעזרו לי להפוך אותה למותג" (help me
# turn it into a brand). "בואו נהפוך" replaces it because asking for help reads
# as a plea in the one line that has to carry the most weight, while the plural
# "let us" puts the reader inside the project instead of outside rescuing it.
# The outcome still has to stay open — a settled ending is not a story anyone
# needs to follow — so the kicker keeps the question live, and puts it on the
# person ("a teenager's app") rather than on the product.
CLOSE = dict(setup=["אפליקציה אחת. אפשרויות אינסופיות."],
             payoff=["בואו נהפוך", "אותה למותג."],
             kicker="תעקבו ותראו לאן אפליקציה של נער אחד יכולה להגיע.")

def contact_sheet():
    ims = [Image.open(os.path.join(OUT, "slide-%d.png" % i)) for i in range(1, N + 1)]
    w, h = ims[0].size
    s = Image.new("RGB", (w * N, h), (255, 255, 255))
    for i, im in enumerate(ims):
        s.paste(im, (i * w, 0))
    s.resize((w * N // 5, h // 5), Image.LANCZOS).save(os.path.join(OUT, "_contact-sheet.png"))
    print("wrote _contact-sheet.png")

if __name__ == "__main__":
    slide1(); slide2(); slide3(); slide4(); slide5(); slide6(); slide7()
    slide8(**CLOSE)
    contact_sheet()
    print("done — %d slides at %dx%d" % (N, W // SS, H // SS))
