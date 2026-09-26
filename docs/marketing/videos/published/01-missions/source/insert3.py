"""Assemble reel 1 v2: real footage where there used to be mission cards.

Cards kept: the prize (a number nobody can film) and the 107 list (data).
Cards dropped: the two mission cards -- a player doing the thing beats a card
describing it. The board stays; it was the founder's own idea.
"""
import subprocess, cv2, json

K = 6            # dissolve length
H = K // 2

# A clip whose name does not start with f_ is a full screen GRAPHIC. An emphasis
# card drawn on top of one is text on text: the graphic already IS the emphasis.
WIN = [
    (104, 228, "f_market.mp4"),     # "a race we are producing in Jerusalem"
    (270, 362, "cP.mp4"),           # prize, THE one number card
    (400, 468, "f_approach.mp4"),   # petition -> people leaning over our board
    (500, 601, "f_player.mp4"),     # street musician -> a real player singing
    (601, 678, "cM.mp4"),           # the 107 mission names
    (716, 812, "f_wide.mp4"),       # "ten teams, one evening, all of Jerusalem"
    (812, 890, "board_ins.mp4"),    # ten slots, two taken
]


def load(p):
    c = cv2.VideoCapture(p)
    f = []
    while True:
        ok, x = c.read()
        if not ok:
            break
        f.append(x)
    c.release()
    return f


base = load("retouched.mp4")
print(f"base {len(base)} frames")
out = list(base)
prev_end = 0
for a, b, p in WIN:
    assert a >= prev_end, f"{p} overlaps the previous insert"
    prev_end = b
    ins = load(p)
    need = b - a
    assert len(ins) >= need + H, f"{p}: {len(ins)} < {need + H}"
    for j in range(need):
        out[a + j] = ins[j]
    for k in range(K):                                  # dissolve in
        t = a - H + k
        if 0 <= t < len(out):
            w = (k + 1) / (K + 1)
            out[t] = cv2.addWeighted(base[t], 1 - w, ins[max(0, k - H)], w, 0)
    for k in range(K):                                  # dissolve out
        t = b - H + k
        if 0 <= t < len(out):
            w = (k + 1) / (K + 1)
            out[t] = cv2.addWeighted(ins[min(len(ins) - 1, need - H + k)],
                                     1 - w, base[t], w, 0)
    print(f"  {p:16s} {a:4d}-{b:4d}  {need:3d}f  "
          f"{a/30:5.2f}-{b/30:5.2f}s")

face = []
cur = 0
for a, b, _ in WIN:
    if a > cur:
        face.append((cur, a))
    cur = b
if cur < len(out):
    face.append((cur, len(out)))
print("  face windows: " + "  ".join(f"{a/30:.2f}-{b/30:.2f}s({(b-a)/30:.2f})"
                                     for a, b in face))

h, wd = out[0].shape[:2]
pr = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo",
                       "-pix_fmt", "bgr24", "-s", f"{wd}x{h}", "-r", "30", "-i", "-",
                       "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "16",
                       "-pix_fmt", "yuv420p", "assembled.mp4"], stdin=subprocess.PIPE)
for f in out:
    pr.stdin.write(f.tobytes())
pr.stdin.close()
pr.wait()
json.dump([[a, b] for a, b, _ in WIN], open("suppress.json", "w"))
json.dump([[a / 30, b / 30] for a, b, p in WIN if not p.startswith("f_")],
          open("gfx.json", "w"))
print(f"assembled.mp4: {len(out)} frames, {len(WIN)} inserts "
      f"({sum(1 for _,_,p in WIN if p.startswith('f_'))} real footage)")
