# -*- coding: utf-8 -*-
"""Backgrounds behind him: a brand colour with faint topographic contour lines (the Contour Kinetics
look), one per line of the script so every line change is a visible change. graphics/bg_<name>.png"""
from pathlib import Path
import cv2
import numpy as np

RD = Path(__file__).resolve().parent
W, H = 1080, 1920
PAL = {   # name: (base RGB, line RGB)
    "fire": ((255, 87, 34), (255, 122, 77)),
    "dark": ((28, 25, 23), (62, 54, 48)),
    "amber": ((255, 179, 0), (255, 203, 82)),
    "plasma": ((6, 182, 212), (72, 208, 230)),
    "bone": ((245, 239, 230), (228, 216, 198)),
}


def field(seed):
    rng = np.random.default_rng(seed)
    f = cv2.resize(rng.random((9, 6)).astype(np.float32), (W, H), interpolation=cv2.INTER_CUBIC)
    f += 0.35 * cv2.resize(rng.random((20, 12)).astype(np.float32), (W, H), interpolation=cv2.INTER_CUBIC)
    return cv2.GaussianBlur(f, (0, 0), 30)


def make(name, seed):
    base, line = PAL[name]
    f = field(seed)
    f = (f - f.min()) / (f.max() - f.min())
    k = f * 11
    d = np.abs(k - np.round(k))                      # distance to the nearest contour level
    grad = np.hypot(*np.gradient(k)) + 1e-6
    a = np.clip(1.6 - d / grad / 1.5, 0, 1)[..., None]   # ~3 px lines whatever the slope
    img = np.array(base, np.float32) * (1 - a) + np.array(line, np.float32) * a
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    vig = 1 - 0.16 * np.clip(np.hypot((xx - W / 2) / (W * 0.75), (yy - H * 0.45) / (H * 0.75)), 0, 1.4) ** 2
    img = np.clip(img * vig[..., None], 0, 255).astype(np.uint8)
    out = RD / "graphics" / f"bg_{name}.png"
    out.parent.mkdir(exist_ok=True)
    cv2.imwrite(str(out), cv2.cvtColor(img, cv2.COLOR_RGB2BGR))
    return out


if __name__ == "__main__":
    for i, n in enumerate(PAL):
        print(make(n, 17 + i))
