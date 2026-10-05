# -*- coding: utf-8 -*-
"""Shared plumbing: config, workspace paths, ffmpeg/ffprobe calls, timeline loading.

Every script imports from here so a path, a colour or a frame rate is decided once.
Runs on Windows (Ahiya's machine) and Linux (cloud sessions) unchanged.
"""
from __future__ import annotations

import copy
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # .claude/skills/reel-studio/engine
FONTS_DIR = ROOT / "fonts"
TEMPLATES_DIR = ROOT / "examples"
HTML_DIR = ROOT / "html"


def _discover_reels() -> list[str]:
    """Every folder of the work root that holds a timeline.json (no hardcoded list)."""
    try:
        return sorted(p.parent.name for p in WORK_ROOT.glob("*/timeline.json"))
    except Exception:
        return []
SUBDIRS = ["clips", "voice", "proofs", "graphics", "build", "sfx"]

os.environ.setdefault("PYTHONUTF8", "1")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def load_config() -> dict:
    return json.loads((ROOT / "config.json").read_text(encoding="utf-8"))


CFG = load_config()
# LANDSCAPE (16:9) mode, first used for the classroom video of המירוץ לציון (2026-10-04).
# Everything in the engine reads W/H/CFG at import, so the format is chosen ONCE, before
# any module loads, by RP_FORMAT=landscape. Each block in config "landscape" replaces
# the matching block (video, captions, safe_zone) wholesale.
FORMAT = os.environ.get("RP_FORMAT", "portrait").strip().lower()
if FORMAT == "landscape":
    for _k, _v in CFG.get("landscape", {}).items():
        if not _k.startswith("_"):
            CFG[_k] = {**CFG.get(_k, {}), **_v}
FPS = CFG["video"]["fps"]
W, H = CFG["video"]["width"], CFG["video"]["height"]


def _pick_root(env: str, win_key: str, fallback_key: str) -> Path:
    if os.environ.get(env):
        return Path(os.environ[env])
    if os.name == "nt":
        return Path(os.path.expandvars(CFG["paths"][win_key]))   # %USERPROFILE% → C:\Users\<you>
    return ROOT / CFG["paths"][fallback_key]


WORK_ROOT = _pick_root("RP_REELS_WORK", "work_root_windows", "work_root_fallback")
OUT_ROOT = _pick_root("RP_REELS_OUT", "out_root_windows", "out_root_fallback")
REELS = _discover_reels()


def reel_dir(reel: str) -> Path:
    return WORK_ROOT / reel


def is_todo(v) -> bool:
    return v is None or (isinstance(v, str) and v.strip().upper().startswith("TODO"))


# ── frames ───────────────────────────────────────────────────────────────────
# Gotcha #5 of video-editing-setup.md: never sum independently rounded durations.
# Every time is converted to an integer frame ONCE, and lengths are differences.
def fr(t: float) -> int:
    return int(round(float(t) * FPS))


def secs(frames: int) -> float:
    return frames / FPS


# ── processes ────────────────────────────────────────────────────────────────
def ffmpeg_bin(name: str = "ffmpeg") -> str:
    found = shutil.which(name)
    if not found:
        sys.exit(f"{name} not found on PATH. Windows: winget install Gyan.FFmpeg")
    return found


def run(cmd: list, cwd: Path | None = None, quiet: bool = True) -> subprocess.CompletedProcess:
    p = subprocess.run([str(c) for c in cmd], cwd=cwd, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if p.returncode != 0:
        tail = "\n".join(p.stderr.strip().splitlines()[-25:])
        raise RuntimeError(f"command failed ({p.returncode}): {' '.join(map(str, cmd[:6]))} …\n{tail}")
    if not quiet:
        print(p.stdout)
    return p


def ffprobe(path: Path) -> dict:
    p = run([ffmpeg_bin("ffprobe"), "-v", "error", "-print_format", "json",
             "-show_streams", "-show_format", str(path)])
    return json.loads(p.stdout)


def has_audio(path: Path) -> bool:
    return any(s.get("codec_type") == "audio" for s in ffprobe(path).get("streams", []))


# ── timeline ─────────────────────────────────────────────────────────────────
def load_timeline(reel: str) -> dict:
    p = reel_dir(reel) / "timeline.json"
    if not p.exists():
        p = TEMPLATES_DIR / reel / "timeline.json"
    return json.loads(p.read_text(encoding="utf-8"))


def apply_opening(tl: dict, variant: str | None) -> dict:
    """Swap the first `cut` seconds for an opening variant.

    A variant carries its own shots/captions/overlays/sfx for [0, cut). Base items that
    START before `cut` are dropped; the variant's items take their place. Shots must
    tile [0, cut) exactly, which validate_shots() checks afterwards.
    """
    tl = copy.deepcopy(tl)
    if not variant:
        variant = tl.get("default_opening", "A")
    op = tl.get("openings", {}).get(variant)
    if not op:
        return tl
    cut = float(op["cut"])
    for key in ("shots", "captions", "overlays", "sfx"):
        base = [x for x in tl.get(key, []) if float(x.get("start", x.get("at", 0))) >= cut - 1e-6]
        tl[key] = sorted(op.get(key, []) + base, key=lambda x: float(x.get("start", x.get("at", 0))))
    tl["opening"] = variant
    return tl


def validate_shots(tl: dict) -> list[str]:
    errs, t = [], 0
    for s in tl["shots"]:
        a, b = fr(s["start"]), fr(s["end"])
        if a != t:
            errs.append(f"shot {s['id']}: starts at frame {a}, expected {t} (gap or overlap)")
        if b <= a:
            errs.append(f"shot {s['id']}: empty")
        t = b
    return errs


def hex_to_ass(hex_color: str, alpha: int = 0) -> str:
    """#RRGGBB → &HAABBGGRR (ASS is BGR with inverted alpha)."""
    h = hex_color.lstrip("#")
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H{alpha:02X}{b}{g}{r}".upper()


def font_file(family: str, weight: int) -> Path:
    p = FONTS_DIR / f"{family.replace(' ', '')}-{weight}.ttf"
    if not p.exists():
        avail = sorted(f.stem for f in FONTS_DIR.glob("*.ttf"))
        raise FileNotFoundError(f"no font {p.name}; have {avail}")
    return p


def font_name(family: str, weight: int) -> str:
    """The family name the static instance was saved under (see fonts/README)."""
    return f"{family} {weight}"
