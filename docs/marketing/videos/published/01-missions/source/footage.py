"""Build the real-footage inserts for reel 1.

Full-frame sources are 1080x1920 already (or rotate to it). The two clips that
players filmed during a real game are 480x640, so they go INSIDE the frame on a
blurred bed of themselves: at full bleed the upscale reads as bad quality, in a
frame it reads as what it is, a phone video somebody sent us.
"""
import subprocess, os, json

SRC = "C:/Users/savir/Downloads/Mobile Devices/"
DL = "C:/Users/savir/Downloads/"
FPS = 30
PAD = 6                      # spare frames each end for the dissolves

GRADE = "eq=saturation=1.06:contrast=1.03"

JOBS = [
    # name        source                             start  frames  mode
    ("f_market",  SRC + "20260917_210601_1.mp4",      21.0,  124,  "full"),
    ("f_approach",SRC + "20260917_221757.mp4",        16.8,   68,  "full"),
    ("f_player",  DL + "1a229963-ee9e-4262-90ac-ec1afa926411-1789065039491.mp4",
                                                       0.6,  101,  "inset"),
    ("f_crowd",   SRC + "20260917_212016.mp4",        19.0,   96,  "full"),
]

def build(name, src, start, frames, mode):
    n = frames + 2 * PAD
    if mode == "full":
        vf = (f"scale=1080:1920:force_original_aspect_ratio=increase,"
              f"crop=1080:1920,{GRADE}")
    else:
        vf = ("split=2[bg][fg];"
              "[bg]scale=1080:1920:force_original_aspect_ratio=increase,"
              "crop=1080:1920,gblur=sigma=38,eq=brightness=-0.20:saturation=0.7[b];"
              f"[fg]scale=1000:-2,{GRADE}[f];"
              "[b][f]overlay=(W-w)/2:(H-h)/2")
    out = f"{name}.mp4"
    cmd = ["ffmpeg", "-y", "-loglevel", "error",
           "-ss", f"{max(0.0, start - PAD / FPS):.3f}", "-i", src,
           "-frames:v", str(n), "-vf", vf, "-r", "30", "-fps_mode", "cfr",
           "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "16",
           "-pix_fmt", "yuv420p", out]
    subprocess.run(cmd, check=True)
    got = subprocess.run(["ffprobe", "-v", "error", "-count_frames",
                          "-select_streams", "v:0", "-show_entries",
                          "stream=nb_read_frames,width,height", "-of", "csv=p=0", out],
                         capture_output=True, text=True).stdout.strip()
    print(f"  {out:14s} want {n:3d}f -> {got}")
    return out

for j in JOBS:
    build(*j)
print("footage built")
