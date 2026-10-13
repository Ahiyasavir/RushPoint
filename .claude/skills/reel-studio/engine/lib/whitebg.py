# -*- coding: utf-8 -*-
"""Pure white background behind Ahiya (he asked for it on the race opening video, 2026-10-13).

    python whitebg.py <in.mp4> <out.mp4> [--mode auto|seg|key] [--proof out.jpg]

Two mattes, combined when both exist:
  seg  a person segmentation model (mediapipe ImageSegmenter, models/selfie_segmenter.tflite in the
       toolkit). Knows what a person is, so a white shirt on a light wall survives.
  key  no model: the plain wall is fitted as a smooth colour surface from the frame borders, and a
       pixel's distance from that surface is its opacity. Exact on a plain wall, blind to clothes
       in the wall's colour.
The matte is smoothed in time (no flicker), refined on the picture's own edges (guided filter, so
hair follows the hair) and the semi transparent band is flat fielded, which removes the grey
fringe a wall leaves around a cut out. Audio is copied untouched, frame count is preserved.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

MODEL = Path.home() / ".claude-account2" / "toolkits" / "video-editing" / "models" / "selfie_segmenter.tflite"


def probe(p):
    j = json.loads(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                                   "stream=width,height,r_frame_rate:stream_side_data=rotation:stream_tags=rotate",
                                   "-of", "json", str(p)], capture_output=True, text=True).stdout)["streams"][0]
    w, h = j["width"], j["height"]
    rot = 0
    for sd in j.get("side_data_list", []):
        rot = int(sd.get("rotation", 0))
    if abs(rot) in (90, 270):
        w, h = h, w                      # ffmpeg autorotates on decode
    n, d = j["r_frame_rate"].split("/")
    return w, h, float(n) / float(d)


def wall_model(frame_lab, margin=0.06):
    """Second order colour surface of the wall, fitted on the top band and the two side columns
    above the shoulders (where a centred half body shot shows only wall). Robust: two passes,
    the second without the 25% worst pixels (a shelf corner, a shadow)."""
    h, w = frame_lab.shape[:2]
    s = 8
    small = frame_lab[::s, ::s].astype(np.float32)
    hh, ww = small.shape[:2]
    yy, xx = np.mgrid[0:hh, 0:ww].astype(np.float32)
    yy, xx = yy / hh - 0.5, xx / ww - 0.5
    m = np.zeros((hh, ww), bool)
    m[: max(int(hh * margin), 2)] = True
    m[: int(hh * 0.45), : max(int(ww * 0.07), 2)] = True
    m[: int(hh * 0.45), -max(int(ww * 0.07), 2):] = True
    A = np.stack([np.ones_like(xx), xx, yy, xx * yy, xx * xx, yy * yy], -1)
    X, Y = A[m], small[m]
    coef = np.linalg.lstsq(X, Y, rcond=None)[0]
    err = np.linalg.norm(X @ coef - Y, axis=1)
    keep = err <= np.percentile(err, 75)
    coef = np.linalg.lstsq(X[keep], Y[keep], rcond=None)[0]
    surf = (A.reshape(-1, 6) @ coef).reshape(hh, ww, 3)
    return cv2.resize(surf, (w, h), interpolation=cv2.INTER_CUBIC), float(np.percentile(err[keep], 95))


def key_alpha(lab, surf, noise):
    d = lab.astype(np.float32) - surf
    d[..., 0] *= 0.55                                  # a shadow on the wall is mostly lightness
    dist = np.linalg.norm(d, axis=2)
    lo, hi = max(noise * 1.6, 5.0), max(noise * 1.6, 5.0) + 14.0
    a = np.clip((dist - lo) / (hi - lo), 0, 1)
    # keep the big connected body, fill what it encloses (a shirt in the wall's colour)
    hard = (a > 0.5).astype(np.uint8)
    hard = cv2.morphologyEx(hard, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
    n, lbl, stats, _ = cv2.connectedComponentsWithStats(hard, 8)
    if n > 1:
        big = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        body = (lbl == big).astype(np.uint8)
        ff = body.copy()
        ff[-1, :] = 1                                   # the body leaves through the bottom edge
        inv = 1 - ff
        n2, l2, st2, _ = cv2.connectedComponentsWithStats(inv, 4)
        holes = np.zeros_like(body)
        for i in range(1, n2):
            x, y, ww, hh = st2[i, :4]
            if x > 0 and y > 0 and x + ww < body.shape[1] and y + hh < body.shape[0]:
                holes[l2 == i] = 1
        solid = cv2.dilate(body | holes, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
        a = np.maximum(a * solid, holes.astype(np.float32))
    return a


RVM = MODEL.parent / "rvm_resnet50_fp32.onnx"
RVM_FAST = MODEL.parent / "rvm_mobilenetv3_fp32.onnx"


def whiten_rvm(src, dst, proof=None, crf=14, fast=False, ratio=0.3, shadow=True, a=None, b=None):
    """Robust Video Matting (recurrent, so the matte is stable in time). The model also predicts
    the true foreground colour, used in the soft band so no wall or sky colour fringes the hair.
    a, b: cut this span (seconds) while matting. shadow: a faint soft grey halo behind him, so a
    white shirt still has an outline on a white background."""
    import onnxruntime as ort
    src, dst = Path(src), Path(dst)
    w, h, fps = probe(src)
    so = ort.SessionOptions()
    so.intra_op_num_threads = 3
    sess = ort.InferenceSession(str(RVM_FAST if fast else RVM), so, providers=["CPUExecutionProvider"])
    rec = [np.zeros([1, 1, 1, 1], np.float32)] * 4
    dr = np.array([ratio], np.float32)
    cut = (["-ss", f"{a:.3f}"] if a is not None else []) + (["-t", f"{b - (a or 0):.3f}"] if b is not None else [])
    rd = subprocess.Popen(["ffmpeg", "-v", "error", *cut, "-i", str(src), "-vf", "fps=30", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                          stdout=subprocess.PIPE)
    wr = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}",
                           "-r", "30", "-i", "-", "-c:v", "libx264", "-crf", str(crf), "-preset", "fast",
                           "-pix_fmt", "yuv420p", str(dst)], stdin=subprocess.PIPE)
    n = w * h * 3
    i = 0
    proofs, worst = [], 255.0
    while True:
        buf = rd.stdout.read(n)
        if len(buf) < n:
            break
        f = np.frombuffer(buf, np.uint8).reshape(h, w, 3)
        x = (f.astype(np.float32) / 255).transpose(2, 0, 1)[None]
        fgr, pha, *rec = sess.run(None, {"src": x, "r1i": rec[0], "r2i": rec[1], "r3i": rec[2], "r4i": rec[3], "downsample_ratio": dr})
        al = pha[0, 0]
        al = np.clip((al - 0.04) / 0.92, 0, 1)
        fg = fgr[0].transpose(1, 2, 0) * 255
        ff = f.astype(np.float32)
        solid = (al > 0.97)[..., None]
        col = np.where(solid, ff, fg)
        bgc = np.full((h, w), 255.0, np.float32)
        if shadow:
            # tight: 60 px from the body the background is exactly 255 again ("לבן לגמרי"); the first
            # version (sigma 9, 26 levels) left the corners of a cropped shot at 233
            sm = cv2.GaussianBlur(cv2.resize(al, (w // 8, h // 8)), (0, 0), 3.5)
            bgc = 255.0 - 22.0 * np.clip((cv2.resize(sm, (w, h)) - 0.12) / 0.88, 0, 1)
        out = col * al[..., None] + bgc[..., None] * (1 - al[..., None])
        out = np.clip(out, 0, 255).astype(np.uint8)
        wr.stdin.write(out.tobytes())
        if i % 15 == 0:
            far = cv2.dilate((al > 0.02).astype(np.uint8), np.ones((161, 161), np.uint8)) == 0
            if far.any():
                worst = min(worst, float(out[far].min()))
        if proof and i % 30 == 15 and len(proofs) < 4:
            proofs.append(cv2.cvtColor(np.hstack([cv2.resize(f, (w // 3, h // 3)), cv2.resize(out, (w // 3, h // 3))]), cv2.COLOR_RGB2BGR))
        i += 1
    wr.stdin.close()
    wr.wait()
    rd.wait()
    if proof and proofs:
        cv2.imwrite(str(proof), np.hstack(proofs))
    rep = {"frames": i, "mode": "rvm", "far_background_min_value": worst}
    print(json.dumps(rep))
    return rep


class Seg:
    def __init__(self, w, h):
        import mediapipe as mp
        from mediapipe.tasks import python as mpp
        from mediapipe.tasks.python import vision
        self.mp = mp
        opt = vision.ImageSegmenterOptions(base_options=mpp.BaseOptions(model_asset_buffer=MODEL.read_bytes()),
                                           running_mode=vision.RunningMode.VIDEO, output_confidence_masks=True)
        self.seg = vision.ImageSegmenter.create_from_options(opt)
        self.t = 0

    def __call__(self, bgr):
        img = self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
        self.t += 33
        r = self.seg.segment_for_video(img, self.t)
        m = r.confidence_masks[-1].numpy_view().astype(np.float32)
        return m.reshape(bgr.shape[:2])


def whiten(src, dst, mode="auto", proof=None, crf=14):
    src, dst = Path(src), Path(dst)
    w, h, fps = probe(src)
    if mode == "auto":
        mode = "both" if MODEL.exists() else "key"
    if mode in ("seg", "both") and not MODEL.exists():
        sys.exit(f"no model at {MODEL}")
    seg = Seg(w, h) if mode in ("seg", "both") else None
    rd = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(src), "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
                          stdout=subprocess.PIPE)
    wr = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}",
                           "-r", f"{fps:.6f}", "-i", "-", "-i", str(src), "-map", "0:v", "-map", "1:a?",
                           "-c:v", "libx264", "-crf", str(crf), "-preset", "fast", "-pix_fmt", "yuv420p",
                           "-c:a", "copy", str(dst)], stdin=subprocess.PIPE)
    n = w * h * 3
    surf = noise = None
    prev = None
    i = 0
    stats = []
    proofs = []
    while True:
        buf = rd.stdout.read(n)
        if len(buf) < n:
            break
        f = np.frombuffer(buf, np.uint8).reshape(h, w, 3)
        a = None
        if mode in ("key", "both"):
            lab = cv2.cvtColor(f, cv2.COLOR_BGR2LAB)
            if surf is None or i % 15 == 0:            # the light drifts (auto exposure, a cloud)
                s2, n2 = wall_model(lab)
                surf = s2 if surf is None else 0.7 * surf + 0.3 * s2
                noise = n2 if noise is None else 0.7 * noise + 0.3 * n2
            a = key_alpha(lab, surf, noise)
        if seg is not None:
            s = seg(f)
            s = np.clip((s - 0.25) / 0.5, 0, 1)
            # the model decides WHO, the key decides the exact edge
            a = s if a is None else np.clip(np.maximum(a * cv2.dilate(s, np.ones((25, 25), np.uint8)), s * (s > 0.9)), 0, 1)
        g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
        a = cv2.ximgproc.guidedFilter(g, a.astype(np.float32), 6, 1e-4)
        a = np.clip((a - 0.08) / 0.84, 0, 1)
        if prev is not None:                            # temporal smoothing only where the picture is still
            still = (cv2.absdiff(g, prev[1]) < 0.03).astype(np.float32)
            a = a * (1 - 0.5 * still) + prev[0] * 0.5 * still
        prev = (a, g)
        ff = f.astype(np.float32)
        if surf is not None:                            # flat field: wall colour → white in the soft band
            wall = cv2.cvtColor(np.clip(surf, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR).astype(np.float32) + 1
            flat = np.clip(ff * (255.0 / wall), 0, 255)
            edge = np.clip(1 - a, 0, 1)[..., None]
            ff = ff * (1 - edge) + flat * edge
        out = ff * a[..., None] + 255.0 * (1 - a[..., None])
        out = np.clip(out, 0, 255).astype(np.uint8)
        wr.stdin.write(out.tobytes())
        if i % 10 == 0:
            bgm = a < 0.02
            stats.append((float(bgm.mean()), float(out[bgm].min()) if bgm.any() else 255.0))
        if proof and i % max(int(fps * 1.5), 1) == 0 and len(proofs) < 8:
            proofs.append(np.hstack([cv2.resize(f, (w // 4, h // 4)), cv2.resize(out, (w // 4, h // 4))]))
        i += 1
    wr.stdin.close()
    wr.wait()
    rd.wait()
    if proof and proofs:
        cv2.imwrite(str(proof), np.hstack(proofs[:4]) if len(proofs) <= 4 else np.vstack([np.hstack(proofs[:4]), np.hstack((proofs[4:8] + proofs[:4])[:4])]))
    bg = float(np.mean([s[0] for s in stats])) if stats else 0
    mn = min(s[1] for s in stats) if stats else 0
    rep = {"frames": i, "mode": mode, "background_share": round(bg, 3), "background_min_value": mn}
    print(json.dumps(rep))
    return rep


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--mode", default="auto")
    ap.add_argument("--proof")
    a = ap.parse_args()
    if a.mode in ("rvm", "rvm-fast", "auto") and RVM.exists():
        whiten_rvm(a.src, a.dst, a.proof, fast=a.mode == "rvm-fast")
    else:
        whiten(a.src, a.dst, a.mode, a.proof)
