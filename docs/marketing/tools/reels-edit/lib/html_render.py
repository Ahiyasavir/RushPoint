# -*- coding: utf-8 -*-
"""HTML → PNG through a headless Chromium (Edge on Windows).

Called from Python with an argument LIST, never through a shell, so the Windows path
with spaces and parentheses needs no quoting (the brief notes the Bash route fails
silently on exactly those paths).

Fonts are embedded with @font-face pointing at the static TTFs in fonts/, so the page
renders identically whether or not the fonts are installed on the machine. Pages are
transparent unless they paint their own background.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

from .common import CFG, FONTS_DIR

_BROWSER = None


def browser() -> str:
    global _BROWSER
    if _BROWSER:
        return _BROWSER
    cands = [os.environ.get("RP_BROWSER", "")]
    if os.name == "nt":
        cands += [CFG["paths"]["browser_windows"],
                  r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"]
    cands += CFG["paths"]["browser_fallbacks"]
    for c in cands:
        if c and Path(c).exists():
            _BROWSER = c
            return c
    for name in ("msedge", "chromium", "chromium-browser", "google-chrome", "chrome"):
        if shutil.which(name):
            _BROWSER = shutil.which(name)
            return _BROWSER
    raise SystemExit("No Chromium/Edge found. Set RP_BROWSER to its executable.")


def font_faces() -> str:
    """One @font-face per static instance. Family 'Rubik' weight 800 → Rubik-800.ttf."""
    css = []
    for f in sorted(FONTS_DIR.glob("*.ttf")):
        stem, weight = f.stem.rsplit("-", 1)
        family = {"JetBrainsMono": "JetBrains Mono", "SpaceGrotesk": "Space Grotesk"}.get(stem, stem)
        css.append(f"@font-face{{font-family:'{family}';font-weight:{weight};"
                   f"src:url('{f.resolve().as_uri()}') format('truetype');}}")
    return "\n".join(css)


def page(body: str, css: str, w: int, h: int, bg: str = "transparent") -> str:
    return f"""<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8">
<style>{font_faces()}
html,body{{margin:0;padding:0;width:{w}px;height:{h}px;overflow:hidden;background:{bg};}}
*{{box-sizing:border-box;}}
{css}</style></head><body>{body}</body></html>"""


def render(html: str, out: Path, w: int, h: int) -> Path:
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        src = Path(td) / "page.html"
        src.write_text(html, encoding="utf-8")
        shot = Path(td) / "shot.png"
        cmd = [browser(), "--headless", "--disable-gpu", "--hide-scrollbars",
               "--force-device-scale-factor=1", f"--window-size={w},{h}",
               "--default-background-color=00000000", "--allow-file-access-from-files",
               "--virtual-time-budget=1500", f"--screenshot={shot}", src.resolve().as_uri()]
        if os.name != "nt":
            cmd.insert(1, "--no-sandbox")
        subprocess.run(cmd, capture_output=True, timeout=90)
        if not shot.exists():
            raise RuntimeError(f"browser produced no screenshot for {out.name}")
        im = Image.open(shot).convert("RGBA")
        if im.size != (w, h):           # some Chromium builds include window chrome height
            im = im.crop((0, 0, w, h)) if im.width >= w and im.height >= h else im.resize((w, h))
        im.save(out)
    return out
