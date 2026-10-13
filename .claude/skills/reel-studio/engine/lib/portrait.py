# -*- coding: utf-8 -*-
"""9:16 project helpers (born in reel14-phone, reel15-bet, race-opening, 2026-10-05). `from lib import portrait as P`.

Everything a timeline needs BEFORE his takes exist:
  - png()            HTML -> transparent/solid PNG at 1080x1920 (the engine's own renderer)
  - placeholder()    a grey take stand-in (shot number, frame, the line) so the edit renders now
  - silent_wav()     a silent voice stand-in for voice-over lines
  - phone_shot()     a real app recording (412x838 CSS px) inside a phone, on a warm ground
  - est()            seconds for a Hebrew line at his pace (1.12x), until the take is measured
When a take arrives it is cut to clips/<id>.mp4 (+ voice/<id>.wav) and the placeholder is gone:
make_timeline.py always prefers a real file over its placeholder.
"""
from __future__ import annotations

import subprocess
import wave
from pathlib import Path
import sys

ENGINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE))
from lib.html_render import page, render  # noqa: E402

W, H, FPS = 1080, 1920, 30
FIRE, AMBER, DARK, BONE = "#FF5722", "#FFB300", "#1C1917", "#F5EFE6"
BASE_CSS = "body{font-family:'Rubik';color:#F5EFE6;} .he{direction:rtl;}"
# a gentle grade for phone footage that looks flat: a little contrast and colour, warm, light sharpening
GRADE = "eq=contrast=1.08:saturation=1.25:gamma=0.97:brightness=0.01,colorbalance=rs=0.025:gs=0.0:bs=-0.03,unsharp=5:5:0.55:3:3:0.0"
FONT = str(ENGINE / "fonts" / "Rubik-700.ttf").replace("\\", "/").replace(":", "\\:")


def est(line: str) -> float:
    """His measured pace in the classroom takes: ~2.9 words/s after 1.12x, plus air."""
    return round(len(line.split()) / 2.9 + 0.45, 2)


def png(G: Path, name: str, body: str, css: str, bg: str = "transparent") -> str:
    G.mkdir(exist_ok=True)
    out = G / f"{name}.png"
    html = page(body, BASE_CSS + css, W, H, bg)
    import hashlib
    key = G / f"{name}.key"
    h = hashlib.sha1(html.encode("utf-8")).hexdigest()
    # every PNG goes through headless Edge (~1 s each); 60 timer digits made every rebuild slow.
    # Re-render only when the HTML actually changed.
    if not (out.exists() and key.exists() and key.read_text() == h):
        render(html, out, W, H)
        key.write_text(h)
    return f"graphics/{out.name}"


def silent_wav(path: Path, secs: float):
    path.parent.mkdir(exist_ok=True)
    n = int(secs * 48000)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(48000)
        w.writeframes(b"\x00\x00" * n)


def placeholder(RD: Path, lid: str, secs: float, label: str, frame: str, line: str):
    """A grey card standing in for a take: what to film, in the frame he will film it."""
    out = RD / "clips" / f"{lid}.mp4"
    marker = RD / "clips" / f"{lid}.placeholder"
    if out.exists() and not marker.exists():
        return  # a real take is here
    G = RD / "graphics"
    col = {"A": "#2563EB", "B": "#16A34A", "C": "#9333EA", "D": "#EA580C"}.get(frame, "#57534E")
    css = f"""body{{background:#2b2622;}}
      .c{{position:absolute;left:0;right:0;top:300px;height:700px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:30px;padding:0 90px;}}
      .k{{font:800 56px 'Rubik';color:#a8a29e;}}
      .f{{font:900 120px 'Rubik';color:#fff;background:{col};border-radius:28px;padding:6px 44px;}}
      .l{{font:700 50px/1.35 'Rubik';color:#d6d3d1;text-align:center;}}"""
    body = f'<div class="c he"><div class="k">{label}</div><div class="f">{frame}</div><div class="l">{line}</div></div>'
    p = png(G, f"ph_{lid}", body, css, "#2b2622")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-loop", "1", "-i", str(RD / p), "-f", "lavfi", "-i",
                    "anullsrc=r=48000:cl=stereo", "-t", f"{secs:.3f}", "-r", str(FPS), "-c:v", "libx264",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(out)], check=True)
    marker.write_text("placeholder; replaced when the take arrives", encoding="utf-8")


# ── a real recording inside a phone, 9:16 ─────────────────────────────────────
PH_H = 1240                    # phone screen height; centred and big (Ahiya: 'too high', then 'still too small')
PH_W = round(412 * PH_H / 838 / 2) * 2
PH_TOP = 300                   # 300..1540; captions ride on a dark plate over its lower part
BEZ = 18
R = 54


def _ground(WORK: Path) -> Path:
    from PIL import Image, ImageDraw, ImageFilter
    p = WORK / "ground_v.png"
    if p.exists():
        return p
    im = Image.new("RGB", (W, H), "#1C1917")
    d = ImageDraw.Draw(im)
    for r in range(1100, 0, -8):
        a = int(40 * (1 - r / 1100))
        d.ellipse([540 - r, 700 - r, 540 + r, 700 + r], fill=(28 + a, 25 + a // 2, 23 + a // 4))
    im.filter(ImageFilter.GaussianBlur(40)).save(p)
    return p


def _bezel(WORK: Path) -> tuple[Path, Path]:
    from PIL import Image, ImageDraw, ImageFilter
    x = (W - PH_W) // 2
    bp, mp = WORK / "bezel_v.png", WORK / "mask_v.png"
    if not bp.exists() or Image.open(mp).size != (PH_W, PH_H) if mp.exists() else True:
        im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(sh).rounded_rectangle([x - BEZ + 12, PH_TOP - BEZ + 30, x + PH_W + BEZ + 12, PH_TOP + PH_H + BEZ + 30],
                                             R + BEZ, fill=(0, 0, 0, 160))
        im.alpha_composite(sh.filter(ImageFilter.GaussianBlur(30)))
        ImageDraw.Draw(im).rounded_rectangle([x - BEZ, PH_TOP - BEZ, x + PH_W + BEZ, PH_TOP + PH_H + BEZ], R + BEZ,
                                             fill=(12, 11, 10, 255), outline=(70, 64, 60, 255), width=3)
        im.save(bp)
        m = Image.new("L", (PH_W, PH_H), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, PH_W - 1, PH_H - 1], R, fill=255)
        m.save(mp)
    return bp, mp


def phone_shot(RD: Path, name: str, src: Path, t_in: float, secs: float, speed: float = 1.0,
               blur: list[tuple[int, int, int, int]] | None = None, png_src: Path | None = None) -> str:
    """src: a raw_*.mp4 at 412x838 (or png_src, a still screenshot of any size).
    blur: CSS px boxes to blur (mission text). Returns clips/<name>.mp4."""
    WORK = RD / "screens" / "_comp"
    WORK.mkdir(parents=True, exist_ok=True)
    g = _ground(WORK)
    bp, mp = _bezel(WORK)
    x = (W - PH_W) // 2
    dur = secs + 0.6
    inputs = ["-loop", "1", "-t", f"{dur:.3f}", "-i", str(g), "-loop", "1", "-t", f"{dur:.3f}", "-i", str(bp),
              "-loop", "1", "-t", f"{dur:.3f}", "-i", str(mp)]
    if png_src is not None:
        inputs += ["-loop", "1", "-t", f"{dur:.3f}", "-i", str(png_src)]
        chain = f"[3:v]fps={FPS},scale=412:838"
    else:
        inputs += ["-ss", f"{t_in:.3f}", "-t", f"{dur * speed + 0.5:.3f}", "-i", str(src)]
        chain = f"[3:v]setpts=(PTS-STARTPTS)/{speed},fps={FPS}"
    for i, (bx, by, bw, bh) in enumerate(blur or []):
        chain += f",split[r{i}][s{i}];[s{i}]crop={bw}:{bh}:{bx}:{by},boxblur=10:2[b{i}];[r{i}][b{i}]overlay={bx}:{by}"
    chain += f",scale={PH_W}:{PH_H}:flags=lanczos,format=yuva420p[p]"
    fc = [f"[0:v]fps={FPS}[g0]", "[g0][1:v]overlay=0:0[g1]", chain, "[2:v]format=gray[m]", "[p][m]alphamerge[pm]",
          f"[g1][pm]overlay={x}:{PH_TOP},format=yuv420p[v]"]
    out = RD / "clips" / f"{name}.mp4"
    subprocess.run(["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", ";".join(fc), "-map", "[v]",
                    "-t", f"{dur:.3f}", "-r", str(FPS), "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", str(out)],
                   check=True)
    return f"clips/{name}.mp4"


# ── shared graphics ───────────────────────────────────────────────────────────
def logo(G: Path) -> str:
    svg = Path(r"C:\Users\savir\Projects\Rushpoint\apps\play-web\public\icon.svg")
    css = ".lg{position:absolute;right:48px;top:250px;width:84px;height:84px;opacity:.92;}"
    return png(G, "logo", f'<img class="lg" src="{svg.as_uri()}">', css)


def chapter_tag(G: Path, n: int, title: str) -> str:
    css = f""".tag{{position:absolute;left:48px;top:256px;display:flex;align-items:center;gap:16px;
      background:rgba(28,25,23,.8);border-radius:999px;padding:10px 28px 10px 12px;direction:ltr;}}
      .n{{width:58px;height:58px;border-radius:50%;background:{FIRE};color:#fff;font:800 34px 'Rubik';
      display:flex;align-items:center;justify-content:center;}}
      .t{{font:700 38px 'Rubik';direction:rtl;}}"""
    return png(G, f"tag_{n}", f'<div class="tag"><div class="n">{n}</div><div class="t">{title}</div></div>', css)


def title_mid(G: Path, name: str, text: str, y: int = 560, size: int = 104) -> str:
    """A big statement in the upper middle (inside y 250..850, clear of the right column)."""
    lines = "".join(f'<div class="r">{l}</div>' for l in text.split("|"))
    css = f""".b{{position:absolute;left:70px;right:70px;top:{y}px;display:flex;flex-direction:column;align-items:center;gap:10px;}}
      .r{{font:900 {size}px/1.08 'Rubik';direction:rtl;text-align:center;color:#fff;
      text-shadow:0 6px 34px rgba(0,0,0,.6);}}"""
    return png(G, name, f'<div class="b">{lines}</div>', css)
