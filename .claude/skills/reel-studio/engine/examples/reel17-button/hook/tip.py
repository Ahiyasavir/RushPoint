# -*- coding: utf-8 -*-
"""Where is the fingertip, in screen coordinates (u,v in 0..1), frame by frame?"""
import json, subprocess, sys
import numpy as np, cv2
T = json.load(open("trackA.json"))
Q = np.array(T["quads"])
src = "../src/20261013_205807.mp4"
p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", src, "-vf", "trim=0:7.6,setpts=PTS-STARTPTS,fps=30", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE)
INS = (0.075, 0.045, 0.075, 0.05)   # left, top, right, bottom inset of the screen inside the body
def screen(q):
    tl, tr, br, bl = q
    l, t, r, b = INS
    def P(u, v): return tl + (tr - tl) * u + (bl - tl) * v
    return np.array([P(l, t), P(1 - r, t), P(1 - r, 1 - b), P(l, 1 - b)], np.float32)
i = 0
while True:
    b = p.stdout.read(1080 * 1920 * 3)
    if len(b) < 1080 * 1920 * 3: break
    f = np.frombuffer(b, np.uint8).reshape(1920, 1080, 3)
    sq = screen(Q[i])
    H = cv2.getPerspectiveTransform(sq, np.array([[0, 0], [100, 0], [100, 217], [0, 217]], np.float32))
    w = cv2.warpPerspective(f, H, (100, 217))
    B, G, R = [w[..., k].astype(int) for k in range(3)]
    skin = (R > 110) & (R - B > 28)
    ys, xs = np.nonzero(skin)
    if i % 3 == 0 or 165 <= i <= 185:
        if len(xs):
            k = np.argmax(xs)          # the finger enters from the left: its tip is the rightmost skin pixel on the left blob
            # only the blob touching the left edge
            n, lab = cv2.connectedComponents(skin.astype(np.uint8))
            left = set(lab[:, 0][lab[:, 0] > 0])
            m = np.isin(lab, list(left))
            ys2, xs2 = np.nonzero(m)
            if len(xs2):
                k = np.argmax(xs2)
                print(f"{i:3d} t={i/30:5.2f} tip u={xs2[k]/100:.2f} v={ys2[k]/217:.2f} cover={m.mean():.2f}")
    if i in (30, 150, 176, 180):
        cv2.imwrite(f"rect_{i}.png", cv2.resize(w, (300, 651), interpolation=cv2.INTER_CUBIC))
    i += 1
