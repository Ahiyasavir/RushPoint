# -*- coding: utf-8 -*-
"""Text BEHIND the person: composite overlays only where he is not.

Reel 2 v7 writes each expense on the step he lands on. A plain overlay draws that text
over his shirt when he comes down close to the camera, which reads as a sticker, not as
writing on the stairs. The camera is locked off and the take ends on the empty stairs,
so the empty frame is a clean background plate: a frame minus the plate (exposure
matched on a strip of rock wall nobody walks through), plus his blue clothes, cleaned up
and kept as the single largest blob, is his silhouette. Overlays are then blended with
alpha * (1 - silhouette), frame by frame, in numpy.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

from .common import FPS, H, W, ffmpeg_bin


def _mask(f_half: np.ndarray, bg: np.ndarray, top: int) -> np.ndarray:
    """His silhouette at half resolution, 0..1.

    His own SHADOW on the steps is the trap: it differs from the plate in brightness only,
    so an absolute difference marks it as 'him' and the text beside his feet vanished.
    A shadow keeps the surface's colour, so the test is on CHROMA (colour with the
    brightness divided out), plus a clear brightening, plus his blue clothes."""
    ref = (slice(300, 700), slice(0, 60))
    g = (bg[ref].mean(axis=(0, 1)) + 1) / (f_half[ref].mean(axis=(0, 1)) + 1)
    fc = np.clip(f_half * g, 0, 255)
    sf = fc.sum(2, keepdims=True) + 1
    sb = bg.sum(2, keepdims=True) + 1
    cd = np.abs(fc / sf - bg / sb).sum(2)
    ratio = sf[..., 0] / sb[..., 0]
    r, gc, b = fc[..., 0], fc[..., 1], fc[..., 2]
    blue = (b > r + 18) & (b > gc + 5) & (np.abs(fc - bg).sum(2) > 30)
    m = (cd > 0.07) | (ratio > 1.3) | blue
    m[:top] = False
    m = ndimage.binary_opening(m, iterations=2)
    m = ndimage.binary_closing(m, iterations=3)
    lab, n = ndimage.label(m)
    if n:
        sizes = ndimage.sum(m, lab, range(1, n + 1))
        m = lab == (int(np.argmax(sizes)) + 1)
    m = ndimage.binary_fill_holes(m)
    soft = ndimage.gaussian_filter(m.astype(np.float32), 1.2)
    return np.clip(soft * 1.4, 0, 1)


def occlude(base_in: Path, base_out: Path, overlays: list, plate: Path, frames: int, crf: int,
            mask_top: int = 190) -> Path:
    """overlays = [(png_path, start_s, end_s)] composited behind the person."""
    bg = np.asarray(Image.open(plate).convert("RGB").resize((W // 2, H // 2)), dtype=np.float32)
    cache: dict[str, np.ndarray] = {}

    def rgba(p: str) -> np.ndarray:
        if p not in cache:
            cache[p] = np.asarray(Image.open(p).convert("RGBA"), dtype=np.float32)
        return cache[p]

    ff = ffmpeg_bin()
    rd = subprocess.Popen([ff, "-v", "error", "-i", str(base_in), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                          stdout=subprocess.PIPE)
    wr = subprocess.Popen([ff, "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                           "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", str(crf),
                           "-pix_fmt", "yuv420p", str(base_out)], stdin=subprocess.PIPE)
    n = W * H * 3
    for i in range(frames):
        buf = rd.stdout.read(n)
        if len(buf) < n:
            break
        f = np.frombuffer(buf, np.uint8).reshape(H, W, 3).astype(np.float32)
        t = i / FPS
        act = [p for p, a, b in overlays if a - 1e-6 <= t < b]
        if act:
            m = _mask(f[::2, ::2], bg, mask_top // 2)
            keep = 1.0 - np.repeat(np.repeat(m, 2, 0), 2, 1)[..., None]
            for p in act:
                o = rgba(p)
                a = o[..., 3:4] / 255.0 * keep
                f = f * (1 - a) + o[..., :3] * a
        wr.stdin.write(f.clip(0, 255).astype(np.uint8).tobytes())
    rd.kill()          # it may still hold a trailing frame; we have what we need
    rd.wait()
    wr.stdin.close()
    wr.wait()
    return base_out
