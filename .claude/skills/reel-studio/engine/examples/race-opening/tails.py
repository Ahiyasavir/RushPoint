# -*- coding: utf-8 -*-
"""Where does each talking clip stop being usable? He looks to the laptop or freezes right after
(sometimes during) the last word (his note, 2026-10-13: "the end of every clip is cut too late").
Per clip: head yaw/pitch + iris offset at 30 fps; baseline = the median while he speaks; 'leave' =
the first frame near the end where he has turned away and stays away. Writes tails.json:
{lid: {dur, vend (last vowel ends, clip time), leave (None = he holds the lens to the end)}}."""
import json, os, subprocess, sys
from pathlib import Path
import numpy as np
RD = Path(__file__).resolve().parent
sys.path.insert(0, str(RD))
import assemble as A
import mediapipe as mp
from mediapipe.tasks.python import vision, BaseOptions
MODEL = Path.home() / ".claude-account2/toolkits/video-editing/face_landmarker.task"
Wd, Ht = 540, 960
plan = A.plan()
out = {}
for lid, spans in plan.items():
    clip = RD / "clips" / f"{lid}.mp4"
    if not clip.exists() or lid in ("s06", "s09", "s10", "s12", "s15", "s18", "s19", "s22", "s26"):
        continue
    take, a, b = spans[-1]
    t1 = A.CUTS[lid][-1][2]
    vend = (A.end_of(take, t1) - a) / A.TEMPO
    lm = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_buffer=MODEL.read_bytes()), running_mode=vision.RunningMode.VIDEO,
        output_facial_transformation_matrixes=True, num_faces=1))
    p = subprocess.Popen(["ffmpeg", "-nostdin", "-v", "error", "-i", str(clip), "-vf", f"scale={Wd}:{Ht}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
    rows = []; i = 0
    while True:
        buf = p.stdout.read(Wd * Ht * 3)
        if len(buf) < Wd * Ht * 3: break
        r = lm.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.frombuffer(buf, np.uint8).reshape(Ht, Wd, 3)), int(i * 1000 / 30))
        if r.facial_transformation_matrixes:
            M = np.array(r.facial_transformation_matrixes[0])[:3, :3]
            yaw = np.degrees(np.arctan2(-M[2, 0], np.hypot(M[2, 1], M[2, 2])))
            pitch = np.degrees(np.arctan2(M[2, 1], M[2, 2]))
            L = r.face_landmarks[0]
            g = lambda ic, x, y: (L[ic].x - L[x].x) / (L[y].x - L[x].x + 1e-9)
            gz = (g(468, 33, 133) + g(473, 362, 263)) / 2
            gy = ((L[468].y - (L[159].y + L[145].y) / 2) / (abs(L[145].y - L[159].y) + 1e-9) + (L[473].y - (L[386].y + L[374].y) / 2) / (abs(L[374].y - L[386].y) + 1e-9)) / 2
            op = (abs(L[145].y - L[159].y) / (abs(L[133].x - L[33].x) + 1e-9) + abs(L[374].y - L[386].y) / (abs(L[263].x - L[362].x) + 1e-9)) / 2
            rows.append([i / 30, yaw, pitch, gz, op])
        else:
            rows.append([i / 30, np.nan, np.nan, np.nan, np.nan])
        i += 1
    R = np.array(rows); dur = i / 30
    body = R[(R[:, 0] > 0.15) & (R[:, 0] < max(vend - 0.4, 0.5))]
    base = np.nanmedian(body[:, 1:], axis=0); sd = np.nanstd(body[:, 1:], axis=0) + 1e-6
    dev = np.abs(R[:, 1:4] - base[:3])
    # second pass, 2026-10-13: the first thresholds (7 deg, 0.09) let side glances and blinks through.
    # 'off' = head or eyes off the lens, or the eyes closing; 'leave' = where the FINAL off run begins.
    off = (dev[:, 0] > max(5, 2.2 * sd[0])) | (dev[:, 1] > max(6, 2.5 * sd[1])) | (dev[:, 2] > max(0.05, 2.2 * sd[2])) | (R[:, 4] < 0.62 * base[3]) | np.isnan(R[:, 1])
    k0 = int(max(vend - 0.6, 0) * 30)
    leave = None
    k = len(R) - 1
    if off[k] or off[k - 1]:
        while k > k0 and (off[k] or off[k - 1]):
            k -= 1
        leave = (k + 1) / 30
    else:                                   # a blink or glance around the last word, then back: stop before it
        for q in range(max(int((vend - 0.15) * 30), k0), len(R)):
            if off[q] and off[min(q + 1, len(R) - 1)]:
                leave = q / 30; break
    out[lid] = {"dur": round(dur, 3), "vend": round(vend, 3), "leave": None if leave is None else round(leave, 3)}
    print(f"{lid:5} dur {dur:5.2f} vend {vend:5.2f} leave {leave}  off from vend-0.6: {''.join('x' if o else '.' for o in off[k0:])}", flush=True)
(RD / "tails.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
