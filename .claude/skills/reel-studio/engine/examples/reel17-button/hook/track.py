# -*- coding: utf-8 -*-
"""Track the (black) phone in the hook take: one quad per frame, smoothed.

    python track.py <src.mp4> <t0> <t1> <out.json> [--debug dir]

The phone is the only large dark blob near the hands. Its body quad is the min area
rectangle of that blob's hull (top and right edges are never covered; the hands only
bite into the left and bottom). Quads are ordered tl, tr, br, bl and smoothed in time.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

ROI = (480, 960, 600, 700)   # x, y, w, h in the upright 1080x1920 frame
FPS = 30


def frames(src, t0, t1):
    x, y, w, h = ROI
    cmd = ["ffmpeg", "-v", "error", "-i", src, "-vf",
           f"trim={t0}:{t1},setpts=PTS-STARTPTS,fps={FPS},crop={w}:{h}:{x}:{y}",
           "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    n = w * h * 3
    while True:
        b = p.stdout.read(n)
        if len(b) < n:
            break
        yield np.frombuffer(b, np.uint8).reshape(h, w, 3)


def order(box, prev=None):
    """tl, tr, br, bl with 'top' = the phone's top short edge (upper right in this take)."""
    c = box.mean(0)
    # sort by angle around the centre, then rotate so the first corner is the one closest to prev tl
    ang = np.arctan2(box[:, 1] - c[1], box[:, 0] - c[0])
    b = box[np.argsort(ang)]            # clockwise in image coords
    if prev is None:
        # short edges: pick the short edge whose midpoint is highest (smallest y)
        best, bi = 1e9, 0
        for i in range(4):
            a, d = b[i], b[(i + 1) % 4]
            ln = np.linalg.norm(a - d)
            other = np.linalg.norm(b[(i + 1) % 4] - b[(i + 2) % 4])
            if ln < other and (a[1] + d[1]) / 2 < best:
                best, bi = (a[1] + d[1]) / 2, i
        return np.roll(b, -bi, axis=0)
    best, bi = 1e18, 0
    for i in range(4):
        r = np.roll(b, -i, axis=0)
        d = ((r - prev) ** 2).sum()
        if d < best:
            best, bi = d, i
    return np.roll(b, -bi, axis=0)


def fit_para(hull, box):
    """Parallelogram from the hull: fit the right long edge and the top short edge on the hull
    segments that face those ways; left and bottom are parallels through the extreme points."""
    b = box
    d1 = (b[2] - b[1]); d1 /= np.linalg.norm(d1)          # long axis, top -> bottom
    n1 = np.array([-d1[1], d1[0]])                       # candidate 'right' normal
    c = hull.mean(0)
    if np.dot(b[1] - c, n1) < 0:
        n1 = -n1
    H = hull.astype(np.float64)
    seg_a, seg_b = H, np.roll(H, -1, axis=0)
    mid = (seg_a + seg_b) / 2
    v = seg_b - seg_a
    ln = np.linalg.norm(v, axis=1) + 1e-9
    nrm = np.stack([v[:, 1], -v[:, 0]], 1) / ln[:, None]
    sgn = np.sign(((mid - c) * nrm).sum(1)); nrm *= sgn[:, None]   # outward

    def line(target, tol_deg):
        cs = (nrm * target).sum(1)
        ok = cs > np.cos(np.radians(tol_deg))
        if ok.sum() == 0:
            return None
        P, Wt = [], []
        for a, bb, l in zip(seg_a[ok], seg_b[ok], ln[ok]):
            k = max(2, int(l / 3))
            for t in np.linspace(0, 1, k):
                P.append(a + (bb - a) * t)
        P = np.array(P, np.float32)
        vx, vy, x0, y0 = cv2.fitLine(P, cv2.DIST_HUBER, 0, 0.01, 0.01).ravel()
        return np.array([x0, y0], np.float64), np.array([vx, vy], np.float64)

    R = line(n1, 14)
    T = line(-d1, 38)
    if R is None or T is None:
        return b
    pr, dr = R
    if np.dot(dr, d1) < 0:
        dr = -dr
    pt, dt = T
    nr = np.array([-dr[1], dr[0]])
    if np.dot(nr, n1) < 0:
        nr = -nr
    nt = np.array([-dt[1], dt[0]])
    if np.dot(nt, -d1) < 0:
        nt = -nt                                          # points up (out of the top)
    along = ((H - pt) * dr).sum(1)                        # distance down from the top edge
    L = along.max()
    top_part = H[along < 0.35 * L]
    pl = top_part[np.argmin((top_part * nr).sum(1))]      # leftmost point near the top
    pb = H[np.argmin((H * nt).sum(1))]                    # lowest point

    def X(p, d, q, e):
        A = np.array([d, -e]).T
        t = np.linalg.solve(A, q - p)
        return p + d * t[0]
    tr = X(pr, dr, pt, dt)
    tl = X(pl, dr, pt, dt)
    br = X(pr, dr, pb, dt)
    bl = X(pl, dr, pb, dt)
    return np.array([tl, tr, br, bl])


def smooth(q, win=9):
    k = np.hanning(win + 2)[1:-1]
    k /= k.sum()
    pad = win // 2
    out = np.empty_like(q)
    for i in range(q.shape[1]):
        for j in range(2):
            s = np.pad(q[:, i, j], pad, mode="edge")
            out[:, i, j] = np.convolve(s, k, mode="valid")
    return out


def main():
    src, t0, t1, out = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), sys.argv[4]
    dbg = Path(sys.argv[6]) if len(sys.argv) > 6 and sys.argv[5] == "--debug" else None
    if dbg:
        dbg.mkdir(parents=True, exist_ok=True)
    quads, prev, cen = [], None, None
    keep = []
    for i, f in enumerate(frames(src, t0, t1)):
        g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)
        m = (g < 62).astype(np.uint8)
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((9, 9), np.uint8))
        n, lab, st, ce = cv2.connectedComponentsWithStats(m, 8)
        if n < 2:
            quads.append(quads[-1] if quads else np.zeros((4, 2)))
            continue
        cand = [(st[k, cv2.CC_STAT_AREA], k) for k in range(1, n)]
        if cen is not None:   # stay on the blob we were on
            cand = [(a - 4.0 * np.hypot(*(ce[k] - cen)) ** 2 / 50.0, k) for a, k in cand]
        k = max(cand)[1]
        cen = ce[k]
        pts = cv2.findNonZero((lab == k).astype(np.uint8))
        hull = cv2.convexHull(pts)
        box = cv2.boxPoints(cv2.minAreaRect(hull)).astype(np.float64)
        q = order(box, prev)
        prev = q
        quads.append(fit_para(hull.reshape(-1, 2), q))
        if dbg and i % 10 == 0:
            keep.append((i, f.copy()))
    q = smooth(np.array(quads))
    x, y, _, _ = ROI
    full = q + np.array([x, y])
    Path(out).write_text(json.dumps({"fps": FPS, "t0": t0, "roi": ROI, "quads": full.round(2).tolist()}), encoding="utf-8")
    if dbg:
        for i, f in keep:
            cv2.polylines(f, [q[i].astype(np.int32)], True, (0, 255, 0), 2)
            for j, c in enumerate(q[i]):
                cv2.putText(f, "tl tr br bl".split()[j], tuple(c.astype(int)), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
            cv2.imwrite(str(dbg / f"q_{i:04d}.jpg"), f)
    d = np.abs(np.diff(q, axis=0)).max()
    print(f"{len(quads)} frames, max corner step {d:.2f}px, long edge {np.linalg.norm(q[:,1]-q[:,2],axis=1).mean():.1f}px, short {np.linalg.norm(q[:,0]-q[:,1],axis=1).mean():.1f}px")


if __name__ == "__main__":
    main()
