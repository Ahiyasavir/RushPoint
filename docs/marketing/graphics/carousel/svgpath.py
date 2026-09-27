# -*- coding: utf-8 -*-
"""Minimal SVG <path> rasteriser: flattens one path's `d` to polygons and fills
them with PIL, honouring the even-odd rule so counters (holes) stay open.

Written because this machine has no cairo DLL, so every off-the-shelf route
(cairosvg, reportlab's renderPM via rlPyCairo) fails at import. The product logos
are single-path monochrome icons, which is a small enough subset to do exactly:
M/L/H/V/C/S/Q/T/A/Z, absolute and relative.
"""
import math, re

_TOK = re.compile(r"[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:[eE][-+]?\d+)?")

def _arc(p0, rx, ry, phi, large, sweep, p1, out, steps=64):
    """Endpoint → centre parameterisation (SVG spec F.6.5), then sample."""
    x0, y0 = p0; x1, y1 = p1
    if rx == 0 or ry == 0:
        out.append(p1); return
    phi = math.radians(phi)
    cs, sn = math.cos(phi), math.sin(phi)
    dx2, dy2 = (x0 - x1) / 2.0, (y0 - y1) / 2.0
    x1p, y1p = cs * dx2 + sn * dy2, -sn * dx2 + cs * dy2
    rx, ry = abs(rx), abs(ry)
    lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
    if lam > 1:
        s = math.sqrt(lam); rx *= s; ry *= s
    num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
    den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
    co = math.sqrt(max(0.0, num / den)) if den else 0.0
    if large == sweep:
        co = -co
    cxp, cyp = co * rx * y1p / ry, -co * ry * x1p / rx
    cx = cs * cxp - sn * cyp + (x0 + x1) / 2.0
    cy = sn * cxp + cs * cyp + (y0 + y1) / 2.0

    def ang(ux, uy, vx, vy):
        d = math.hypot(ux, uy) * math.hypot(vx, vy)
        if d == 0:
            return 0.0
        c = max(-1.0, min(1.0, (ux * vx + uy * vy) / d))
        a = math.acos(c)
        return -a if (ux * vy - uy * vx) < 0 else a

    th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
    dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
    if not sweep and dth > 0:
        dth -= 2 * math.pi
    elif sweep and dth < 0:
        dth += 2 * math.pi
    for i in range(1, steps + 1):
        t = th1 + dth * i / steps
        ex, ey = rx * math.cos(t), ry * math.sin(t)
        out.append((cs * ex - sn * ey + cx, sn * ex + cs * ey + cy))

def _cubic(p0, p1, p2, p3, out, steps=24):
    for i in range(1, steps + 1):
        t = i / steps; u = 1 - t
        out.append((u*u*u*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t*t*t*p3[0],
                    u*u*u*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t*t*t*p3[1]))

def _quad(p0, p1, p2, out, steps=20):
    for i in range(1, steps + 1):
        t = i / steps; u = 1 - t
        out.append((u*u*p0[0] + 2*u*t*p1[0] + t*t*p2[0],
                    u*u*p0[1] + 2*u*t*p1[1] + t*t*p2[1]))

def flatten(d):
    """`d` attribute → list of closed subpaths, each a list of (x, y)."""
    toks = _TOK.findall(d)
    i = 0
    subs, cur = [], []
    cx = cy = sx = sy = 0.0
    prev_c = prev_q = None
    cmd = None
    def num():
        nonlocal i
        v = float(toks[i]); i += 1
        return v
    while i < len(toks):
        if re.match(r"[A-Za-z]", toks[i]):
            cmd = toks[i]; i += 1
        c = cmd
        rel = c.islower()
        C = c.upper()
        if C == "M":
            x, y = num(), num()
            if rel: x += cx; y += cy
            if cur: subs.append(cur)
            cur = [(x, y)]; cx, cy = x, y; sx, sy = x, y
            cmd = "l" if rel else "L"
            prev_c = prev_q = None
        elif C == "L":
            x, y = num(), num()
            if rel: x += cx; y += cy
            cur.append((x, y)); cx, cy = x, y; prev_c = prev_q = None
        elif C == "H":
            x = num()
            if rel: x += cx
            cur.append((x, cy)); cx = x; prev_c = prev_q = None
        elif C == "V":
            y = num()
            if rel: y += cy
            cur.append((cx, y)); cy = y; prev_c = prev_q = None
        elif C in ("C", "S"):
            if C == "C":
                x1, y1 = num(), num()
                if rel: x1 += cx; y1 += cy
            else:
                x1, y1 = (2*cx - prev_c[0], 2*cy - prev_c[1]) if prev_c else (cx, cy)
            x2, y2 = num(), num()
            if rel: x2 += cx; y2 += cy
            x, y = num(), num()
            if rel: x += cx; y += cy
            _cubic((cx, cy), (x1, y1), (x2, y2), (x, y), cur)
            prev_c = (x2, y2); prev_q = None; cx, cy = x, y
        elif C in ("Q", "T"):
            if C == "Q":
                x1, y1 = num(), num()
                if rel: x1 += cx; y1 += cy
            else:
                x1, y1 = (2*cx - prev_q[0], 2*cy - prev_q[1]) if prev_q else (cx, cy)
            x, y = num(), num()
            if rel: x += cx; y += cy
            _quad((cx, cy), (x1, y1), (x, y), cur)
            prev_q = (x1, y1); prev_c = None; cx, cy = x, y
        elif C == "A":
            rx, ry, rot = num(), num(), num()
            laf, sf = int(num()), int(num())
            x, y = num(), num()
            if rel: x += cx; y += cy
            _arc((cx, cy), rx, ry, rot, laf, sf, (x, y), cur)
            cx, cy = x, y; prev_c = prev_q = None
        elif C == "Z":
            if cur:
                cur.append((sx, sy)); subs.append(cur); cur = []
            cx, cy = sx, sy; prev_c = prev_q = None
        else:
            i += 1
    if cur:
        subs.append(cur)
    return [s for s in subs if len(s) >= 3]

def render_multi(svg_text, size, colour, pad=0.0, ss=4, skip=(), alpha_scale=1.0):
    """Rasterise a MULTI-path SVG into one monochrome mark.

    Needed because the official Gamma and Luma marks are not single-path icons
    like simple-icons': Gamma wraps its glyph in a gradient-filled disc (skip it,
    or the mark renders as a solid circle) and Luma is six translucent facets
    whose overlaps ARE the logo's character, so they are accumulated rather than
    unioned — flattening them to a silhouette would produce a plain diamond.
    """
    from PIL import Image
    import numpy as np
    paths = re.findall(r'<path\b[^>]*>', svg_text)
    vb = re.search(r'viewBox="([^"]+)"', svg_text)
    subs_all, alphas = [], []
    for i, tag in enumerate(paths):
        if i in skip:
            continue
        dm = re.search(r'\sd="([^"]+)"', tag)
        if not dm:
            continue
        op = re.search(r'fill-opacity="([\d.]+)"', tag)
        subs_all.append(flatten(dm.group(1)))
        alphas.append(float(op.group(1)) if op else 1.0)
    if not subs_all:
        raise ValueError("no usable <path> in svg")

    allpts = [p for subs in subs_all for s in subs for p in s]
    if vb:
        vx, vy, vw, vh = [float(v) for v in vb.group(1).replace(",", " ").split()]
    else:
        xs = [p[0] for p in allpts]; ys = [p[1] for p in allpts]
        vx, vy, vw, vh = min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)

    S = size * ss
    inner = S * (1 - 2 * pad)
    k = inner / max(vw, vh)
    ox = (S - vw * k) / 2 - vx * k
    oy = (S - vh * k) / 2 - vy * k

    acc = np.zeros((S, S), dtype="float32")
    for subs, a in zip(subs_all, alphas):
        layer = _eo_mask(subs, S, k, ox, oy)
        acc = np.maximum(acc, layer * (a * alpha_scale)) if a >= 1.0 else acc + layer * (a * alpha_scale)
    acc = np.clip(acc, 0, 1)
    m = Image.fromarray((acc * 255).astype("uint8")).resize((size, size), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (*colour, 0))
    out.putalpha(m)
    return out

def _eo_mask(subs, S, k, ox, oy):
    """Even-odd filled mask for one path's subpaths, as a float array in [0,1]."""
    from PIL import Image, ImageDraw
    import numpy as np
    acc = np.zeros((S, S), dtype=bool)
    for sp in subs:
        one = Image.new("1", (S, S), 0)
        ImageDraw.Draw(one).polygon([(p[0] * k + ox, p[1] * k + oy) for p in sp], fill=1)
        acc ^= (np.array(one) > 0)
    return acc.astype("float32")

def render(svg_text, size, colour, pad=0.06, ss=4):
    """Rasterise a single-path SVG to an RGBA PIL image of `size`x`size`."""
    from PIL import Image, ImageDraw
    d = re.search(r'\sd="([^"]+)"', svg_text).group(1)
    vb = re.search(r'viewBox="([^"]+)"', svg_text)
    subs = flatten(d)
    if vb:
        vx, vy, vw, vh = [float(v) for v in vb.group(1).replace(",", " ").split()]
    else:
        xs = [p[0] for s in subs for p in s]; ys = [p[1] for s in subs for p in s]
        vx, vy, vw, vh = min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)

    S = size * ss
    inner = S * (1 - 2 * pad)
    k = inner / max(vw, vh)
    ox = (S - vw * k) / 2 - vx * k
    oy = (S - vh * k) / 2 - vy * k

    # even-odd: XOR each subpath into the mask so holes punch through
    mask = Image.new("1", (S, S), 0)
    for sp in subs:
        one = Image.new("1", (S, S), 0)
        ImageDraw.Draw(one).polygon([(p[0] * k + ox, p[1] * k + oy) for p in sp], fill=1)
        mask = Image.eval(Image.merge("L", (mask.convert("L"),)), lambda v: v)  # noop keeps type
        mask = Image.fromarray((_xor(mask, one)))
    a = mask.convert("L").resize((size, size), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (*colour, 0))
    out.putalpha(a)
    return out

def _xor(a, b):
    import numpy as np
    return ((np.array(a.convert("L")) > 127) ^ (np.array(b.convert("L")) > 127)).astype("uint8") * 255
