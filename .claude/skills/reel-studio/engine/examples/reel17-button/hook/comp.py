# -*- coding: utf-8 -*-
"""The hook shot: his black phone gets a live screen, he hesitates, presses, and the camera
falls INTO the screen. Writes clips/hook.mp4 (1080x1920, 30 fps, silent) + hook_meta.json.

    python comp.py [--still N]      (--still writes proof frames only)

Method (from the screen insert literature): track the device by its edges (track.py), corner
pin the artwork, keep the REAL fingers in front with a matte from the footage itself, lay the
footage's own reflections back over the artwork (screen blend), match softness and add a contact
shadow. The hesitation is a time remap of his own approach (forward, back, forward).
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
try:
    sys.path.insert(0, "C:/Users/savir/Projects/Rushpoint/.claude/skills/reel-studio/engine")
    from lib.whitebg import retouch_skin as RETOUCH
except Exception:
    RETOUCH = None
RD = HERE.parent
sys.path.insert(0, str(HERE))
SRC = RD / "src" / "20261013_205807.mp4"
W, H, FPS = 1080, 1920, 30
UW, UH = 1080, 2340
BX, BY, BR = 594, 1450, 340
INS = (0.075, 0.045, 0.10, 0.05)     # screen inside the tracked body: left, top, right, bottom
PRESS = 176                          # source frame where the finger lands
# the hesitation, as source frame numbers: approach, pull back, a breath, commit
SEQ = (list(range(132, 151, 2)) + list(range(150, 137, -2)) + [138, 139, 139, 138]
       + list(range(138, 168, 2)) + list(range(168, PRESS + 1)))
HOLD = 4                             # frames held on the press before the dive
DIVE = 11                            # frames of the fall into the screen
S_0, S_END = 1.35, 1.90              # the push: face and phone at the start, the finger and the button at the press
# the phone must stay clear of the platform UI (right column below y 850, everything below y 1420)
F0, G0, G1 = np.array([880.0, 1290.0]), np.array([690.0, 1130.0]), np.array([585.0, 940.0])


def ease(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


WHITE = HERE / "hookA_white.mp4"       # the same take matted onto white (lib/whitebg), starting at source frame 120
WHITE_AT = 120


def load(first, last):
    src, off = (WHITE, WHITE_AT) if WHITE.exists() else (SRC, 0)
    cmd = ["ffmpeg", "-v", "error", "-i", str(src), "-vf",
           f"fps={FPS},trim=start_frame={first - off}:end_frame={last + 1 - off},setpts=PTS-STARTPTS",
           "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
    raw = subprocess.run(cmd, capture_output=True).stdout
    n = len(raw) // (W * H * 3)
    return np.frombuffer(raw, np.uint8)[: n * W * H * 3].reshape(n, H, W, 3)


def screen_quad(q):
    tl, tr, br, bl = [np.array(p, np.float64) for p in q]
    l, t, r, b = INS
    P = lambda u, v: tl + (tr - tl) * u + (bl - tl) * v
    return np.array([P(l, t), P(1 - r, t), P(1 - r, 1 - b), P(l, 1 - b)], np.float32)


def ui_frame(base, pressed_img, phase, pressed_k):
    """phase 0..1 = the breathing ring; pressed_k 0..1 = time since the press (ripple)."""
    if pressed_k is None:
        im = base.copy()
        r = int(BR + 46 + 70 * phase)
        ov = im.copy()
        cv2.circle(ov, (BX, BY), r, (34, 87, 255), 14, cv2.LINE_AA)
        a = 0.55 * (1 - phase)
        return cv2.addWeighted(ov, a, im, 1 - a, 0)
    im = pressed_img.copy()
    ov = im.copy()
    r = int(BR * (0.5 + 2.6 * pressed_k))
    cv2.circle(ov, (BX, BY), r, (255, 255, 255), int(60 * (1 - pressed_k)) + 6, cv2.LINE_AA)
    a = 0.75 * (1 - pressed_k)
    return cv2.addWeighted(ov, a, im, 1 - a, 0)


UI_MASK = None


def ui_mask():
    global UI_MASK
    if UI_MASK is None:
        m = np.zeros((UH, UW), np.uint8)
        cv2.rectangle(m, (0, 90), (UW, UH - 90), 255, -1)
        cv2.rectangle(m, (90, 0), (UW - 90, UH), 255, -1)
        for cx, cy in ((90, 90), (UW - 90, 90), (90, UH - 90), (UW - 90, UH - 90)):
            cv2.circle(m, (cx, cy), 90, 255, -1, cv2.LINE_AA)
        UI_MASK = m
    return UI_MASK


def composite(frame, sq, M, ui, soften=0.8, lit=0.93):
    """frame: source BGR. sq: screen quad in source px. M: 3x3 source -> output."""
    out = cv2.warpPerspective(frame, M, (W, H), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REPLICATE)
    B, G, R = [frame[..., k].astype(np.float32) for k in range(3)]
    skin = np.clip((R - B - 16) / 20, 0, 1) * np.clip((R - 80) / 40, 0, 1)
    skin = cv2.dilate(skin, np.ones((3, 3), np.uint8))
    skin = cv2.GaussianBlur(skin, (0, 0), 1.4)
    skin_o = cv2.warpPerspective(skin, M, (W, H), flags=cv2.INTER_LINEAR)
    Hui = cv2.getPerspectiveTransform(np.array([[0, 0], [UW, 0], [UW, UH], [0, UH]], np.float32), sq)
    MU = M @ Hui
    uiw = cv2.warpPerspective(ui, MU, (W, H), flags=cv2.INTER_AREA if soften > 0.3 else cv2.INTER_LINEAR)
    mk = cv2.warpPerspective(ui_mask(), MU, (W, H), flags=cv2.INTER_LINEAR).astype(np.float32) / 255
    if soften > 0.05:
        uiw = cv2.GaussianBlur(uiw, (0, 0), soften)
        mk = cv2.GaussianBlur(mk, (0, 0), max(0.8, soften))
    uif = uiw.astype(np.float32) * lit
    # the glass keeps its own reflections: screen blend the (black) footage over the artwork
    o = out.astype(np.float32)
    refl = np.clip(o - 18, 0, 255) * 0.9
    lit_img = 255 - (255 - uif) * (255 - refl) / 255
    # contact shadow: the finger darkens the glass just beside it
    sh = cv2.GaussianBlur(skin_o, (0, 0), 7 * (M[0, 0] ** 0.5))
    sh = np.roll(np.roll(sh, int(5 * M[0, 0]), axis=1), int(7 * M[0, 0]), axis=0)
    lit_img *= (1 - 0.30 * np.clip(sh - skin_o, 0, 1))[..., None]
    a = (mk * (1 - skin_o))[..., None]
    res = o * (1 - a) + lit_img * a
    # a faint glow of the screen onto the fingers that hang over it
    glow = cv2.GaussianBlur(uif * mk[..., None], (0, 0), 26 * M[0, 0])
    res += glow * (skin_o * cv2.GaussianBlur(mk, (0, 0), 30 * M[0, 0]))[..., None] * 0.10
    return np.clip(res, 0, 255).astype(np.uint8)


def push(k):
    s = S_0 + (S_END - S_0) * k
    g = G0 + (G1 - G0) * k
    return np.array([[s, 0, g[0] - s * F0[0]], [0, s, g[1] - s * F0[1]], [0, 0, 1]], np.float64)


def main():
    still = "--still" in sys.argv
    T = json.loads((HERE / "trackA.json").read_text())
    Q = np.array(T["quads"])
    base = cv2.imread(str(HERE / "ui_idle.png"))
    pressed = cv2.imread(str(HERE / "ui_pressed.png"))
    lo, hi = min(SEQ), max(SEQ)
    fr = load(lo, hi)
    n_pre = len(SEQ)
    total = n_pre + HOLD + DIVE
    frames_out = []
    target = np.array([[0, -210], [W, -210], [W, H + 210], [0, H + 210]], np.float32)
    for i in range(total):
        if still and i not in (0, 12, n_pre - 2, n_pre + 2, n_pre + HOLD + 3, n_pre + HOLD + 7, total - 1):
            continue
        si = SEQ[min(i, n_pre - 1)]
        f = fr[si - lo]
        if RETOUCH is not None:          # the same light skin retouch as the talking takes (BGR in, BGR out)
            f = np.clip(RETOUCH(f[..., ::-1].astype(np.float32)), 0, 255).astype(np.uint8)[..., ::-1].copy()
        sq = screen_quad(Q[si])
        k = ease(min(i, n_pre + HOLD) / (n_pre + HOLD))
        M = push(k)
        if i < n_pre - 1:
            ui = ui_frame(base, pressed, (i % 24) / 24, None)
        else:
            ui = ui_frame(base, pressed, 0, min(1.0, (i - (n_pre - 1)) / 12))
        soften = 0.8
        if i >= n_pre + HOLD:
            d = (i - (n_pre + HOLD) + 1) / DIVE
            d = d * d * (3 - 2 * d) if d < 1 else 1.0
            d = d ** 1.6                                   # slow start, then it rushes
            cur = cv2.perspectiveTransform(sq[None], M)[0]
            dst = (cur + (target - cur) * d).astype(np.float32)
            M = cv2.getPerspectiveTransform(sq, dst).astype(np.float64)
            soften = 0.8 * (1 - d)
        o = composite(f, sq, M, ui, soften)
        if i >= n_pre + HOLD and i < total - 1:          # motion blur on the fall
            kk = int(3 + 10 * (i - n_pre - HOLD) / DIVE)
            o = cv2.addWeighted(o, 0.55, cv2.GaussianBlur(o, (0, 0), kk), 0.45, 0)
        if still:
            cv2.imwrite(str(HERE / f"proof_{i:03d}.jpg"), o, [cv2.IMWRITE_JPEG_QUALITY, 92])
        else:
            frames_out.append(o)
    if still:
        return
    out = RD / "clips" / "hook.mp4"
    p = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(FPS),
                          "-i", "-", "-c:v", "libx264", "-crf", "14", "-preset", "medium", "-pix_fmt", "yuv420p",
                          "-vf", "scale=out_range=tv:out_color_matrix=bt709", "-color_range", "tv", "-colorspace", "bt709", str(out)],
                         stdin=subprocess.PIPE)
    for o in frames_out:
        p.stdin.write(o.tobytes())
    p.stdin.close(); p.wait()
    cv2.imwrite(str(HERE / "hook_last.png"), frames_out[-1])
    meta = {"frames": total, "press_frame": n_pre - 1, "dive_from": n_pre + HOLD, "seconds": total / FPS}
    (RD / "hook_meta.json").write_text(json.dumps(meta), encoding="utf-8")
    print("hook.mp4", meta)


if __name__ == "__main__":
    main()
