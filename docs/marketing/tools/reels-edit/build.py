# -*- coding: utf-8 -*-
"""Assemble one reel from its folder.

    python build.py reel2-stairs                 # default opening, preview quality
    python build.py reel2-stairs --opening B     # one opening variant
    python build.py reel3-ai --final             # master quality (crf from config)

Reads <work>/<reel>/timeline.json and renders <work>/<reel>/build/<reel>_<opening>.mp4.

Pipeline (each step is frame exact, see video-editing-setup.md gotchas #4–#8):
  1. every shot → its own normalised segment (1080x1920, 30fps CFR, exact frame count,
     audio trimmed to the same length). A missing clip becomes a coloured placeholder
     that names the shot, the file it expects and its length, so the PACE is visible
     before any footage exists.
  2. segments concatenated (stream copy).
  3. one final pass: graphics overlays (fed full length from t=0 and switched with
     enable=, never shifted with setpts — gotcha #8), word by word captions burned
     LAST, SFX + voice mixed in. No music, by rule.
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from lib import graphics  # noqa: E402
from lib.captions import build_ass, dash_problems  # noqa: E402
from lib.common import (CFG, FONTS_DIR, FPS, H, W, apply_opening, ffmpeg_bin, fr,  # noqa: E402
                        has_audio, load_timeline, reel_dir, run, secs, validate_shots)

PLACEHOLDER_COLORS = ["0xFF5722", "0x06B6D4", "0x10B981", "0xFFB300", "0x8B5CF6", "0x334155"]
FF = ffmpeg_bin()


def effect_filter(effect: str, frames: int) -> str:
    n = max(frames - 1, 1)
    if effect == "punch_in":
        return (f"zoompan=z='1+0.08*on/{n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
                f":d=1:s={W}x{H}:fps={FPS}")
    if effect == "slow_push":
        return (f"zoompan=z='1+0.035*on/{n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
                f":d=1:s={W}x{H}:fps={FPS}")
    if effect == "shake":
        return f"crop={W - 48}:{H - 84}:x='24+16*sin(n*1.7)':y='42+20*cos(n*2.3)',scale={W}:{H}"
    if effect == "flash_in":
        return "fade=t=in:st=0:d=0.18:color=white"
    return "null"


def blur_chain(boxes: list[dict]) -> str:
    """Hide strangers' faces, plates, names. Box times are relative to the shot."""
    out = []
    for i, b in enumerate(boxes):
        x, y, w, h = int(b["x"]), int(b["y"]), int(b["w"]), int(b["h"])
        s, e = float(b.get("start", 0)), float(b.get("end", 999))
        out.append(f"split[bm{i}][bs{i}];[bs{i}]crop={w}:{h}:{x}:{y},boxblur=28:3[bb{i}];"
                   f"[bm{i}][bb{i}]overlay={x}:{y}:enable='between(t,{s},{e})'")
    return ",".join(out) if out else "null"


def render_segment(i: int, shot: dict, rdir: Path, bdir: Path, clip_gain: float, crf: int) -> Path:
    frames = fr(shot["end"]) - fr(shot["start"])
    dur = secs(frames)
    seg = bdir / f"seg_{i:02d}.mp4"
    norm = f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1"
    tail = (f"{effect_filter(shot.get('effect', 'none'), frames)},{blur_chain(shot.get('blur', []))},"
            f"tpad=stop_mode=clone:stop_duration={dur + 1:.3f},format=yuv420p")
    enc = ["-c:v", "libx264", "-preset", "medium", "-crf", str(crf), "-pix_fmt", "yuv420p",
           "-r", str(FPS), "-fps_mode", "cfr", "-frames:v", str(frames),
           "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart"]
    silence = ["-f", "lavfi", "-t", f"{dur:.4f}", "-i", "anullsrc=r=48000:cl=stereo"]

    clip = rdir / shot["clip"] if shot.get("clip") else None
    graphic = Path(shot["graphic"]) if shot.get("graphic") else None
    if graphic and not graphic.is_absolute():
        graphic = rdir / graphic

    if clip and clip.exists():
        start_in = shot.get("in", 0)
        start_in = float(start_in) if isinstance(start_in, (int, float)) else 0.0
        speed = float(shot.get("speed", 1.0))
        vf = f"[0:v]setpts=(PTS-STARTPTS)/{speed},fps={FPS},{norm},{tail}[v]"
        if has_audio(clip) and clip_gain > 0:
            tempo = f"atempo={speed}," if abs(speed - 1) > 1e-3 and 0.5 <= speed <= 2 else ""
            af = (f"[0:a]asetpts=PTS-STARTPTS,{tempo}volume={clip_gain},aresample=48000,"
                  f"apad,atrim=0:{dur:.4f}[a]")
            cmd = [FF, "-y", "-v", "error", "-ss", f"{start_in:.3f}", "-i", clip,
                   "-filter_complex", f"{vf};{af}", "-map", "[v]", "-map", "[a]", *enc, seg]
        else:
            cmd = [FF, "-y", "-v", "error", "-ss", f"{start_in:.3f}", "-i", clip, *silence,
                   "-filter_complex", vf, "-map", "[v]", "-map", "1:a", *enc, seg]
    elif graphic and graphic.exists():
        vf = f"[0:v]fps={FPS},{norm},{tail}[v]"
        cmd = [FF, "-y", "-v", "error", "-loop", "1", "-framerate", str(FPS), "-t", f"{dur + 1:.3f}",
               "-i", graphic, *silence, "-filter_complex", vf, "-map", "[v]", "-map", "1:a", *enc, seg]
    else:
        want = shot.get("clip") or shot.get("graphic") or "?"
        txt = bdir / f"ph_{i:02d}.txt"
        txt.write_text(f"{shot['id']}\n{Path(str(want)).name}\n{dur:.2f}s  {shot.get('effect', 'none')}",
                       encoding="utf-8")
        color = PLACEHOLDER_COLORS[i % len(PLACEHOLDER_COLORS)]
        vf = (f"[0:v]drawtext=fontfile=fonts/JetBrainsMono-700.ttf:textfile={txt.name}:fontcolor=white:"
              f"fontsize=74:line_spacing=26:x=(w-text_w)/2:y=1130:box=1:boxcolor=0x1C1917@0.55:"
              f"boxborderw=30,drawbox=x=0:y=0:w=iw:h=200:color=black@0.25:t=fill,"
              f"drawbox=x=0:y=ih-250:w=iw:h=250:color=black@0.25:t=fill,{tail}[v]")
        cmd = [FF, "-y", "-v", "error", "-f", "lavfi", "-i", f"color=c={color}:s={W}x{H}:r={FPS}:d={dur + 1:.3f}",
               *silence, "-filter_complex", vf, "-map", "[v]", "-map", "1:a", *enc, seg]
    run(cmd, cwd=bdir)
    return seg


def build(reel: str, opening: str | None, final: bool, quiet: bool = False) -> Path:
    rdir = reel_dir(reel)
    for d in ("clips", "voice", "proofs", "graphics", "build", "sfx"):
        (rdir / d).mkdir(parents=True, exist_ok=True)
    bdir = rdir / "build"
    if not (bdir / "fonts").exists():
        shutil.copytree(FONTS_DIR, bdir / "fonts")

    tl = apply_opening(load_timeline(reel), opening)
    errs = validate_shots(tl)
    if errs:
        raise SystemExit("timeline shots do not tile:\n  " + "\n  ".join(errs))
    bad = dash_problems(tl.get("captions", []))
    if bad:
        raise SystemExit("captions contain a dash (Ahiya's rule: none, maqaf included):\n  " + "\n  ".join(bad))
    tl = graphics.expand(tl, rdir)
    op = tl.get("opening", "A")
    crf = CFG["video"]["crf_master"] if final else 26
    total_frames = fr(tl["shots"][-1]["end"])
    total = secs(total_frames)

    clip_gain = float(tl.get("keep_clip_audio", 0.0))
    segs, missing = [], []
    for i, s in enumerate(tl["shots"]):
        src = s.get("clip") or s.get("graphic")
        if src and not (rdir / src).exists() and not Path(str(src)).exists():
            missing.append(f"{s['id']}: {src}")
        segs.append(render_segment(i, s, rdir, bdir, clip_gain, crf))
        if not quiet:
            print(f"  seg {i:02d} {s['id']:<12} {s['start']:>6}–{s['end']:<6}", flush=True)

    lst = bdir / "concat.txt"
    lst.write_text("".join(f"file '{p.name}'\n" for p in segs), encoding="utf-8")
    base = bdir / "base.mp4"
    run([FF, "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", lst.name, "-c", "copy", base.name], cwd=bdir)

    build_ass(tl.get("captions", []), bdir / "subs.ass")

    inputs = ["-i", base.name]
    fc, v, k = [], "[0:v]", 1
    for j, o in enumerate(tl.get("overlays", [])):
        png = Path(o["png"])
        png = png if png.is_absolute() else rdir / png
        if not png.exists():
            print(f"  ! overlay missing: {png}")
            continue
        s, e = float(o["start"]), float(o["end"])
        # ONE decoded frame, held by eof_action=repeat and switched by enable=. A looped
        # full length PNG input (the obvious way) decodes a 1080x1920 PNG every frame for
        # every overlay: measured 2m30 of a 3m15 build on reel 2. Still never shifted with
        # setpts (gotcha #8), so no deadlock. The cost: no alpha fade in, so overlays cut
        # in on the frame, which on a landing or a cut is the beat anyway.
        inputs += ["-i", str(png)]
        fc.append(f"[{k}:v]format=rgba[o{j}]")
        fc.append(f"{v}[o{j}]overlay=0:0:enable='between(t,{s:.3f},{e - 1e-3:.3f})':eof_action=repeat[v{j}]")
        v, k = f"[v{j}]", k + 1
    fc.append(f"{v}ass=subs.ass:fontsdir=fonts,format=yuv420p[vout]")

    amix = ["[0:a]anull[a0]"]
    labels, voice_or_clip = ["[a0]"], clip_gain > 0
    for x in tl.get("sfx", []):
        f = rdir / x["file"]
        if not f.exists():
            missing.append(f"sfx {x['file']}")
            continue
        ms = int(round(float(x["at"]) * 1000))
        inputs += ["-i", str(f)]
        amix.append(f"[{k}:a]aresample=48000,aformat=channel_layouts=stereo,adelay={ms}:all=1,"
                    f"volume={float(x.get('gain', 0))}dB[s{k}]")
        labels.append(f"[s{k}]")
        k += 1
    vo = tl.get("voice") or {}
    if vo.get("file") and (rdir / vo["file"]).exists():
        ms = int(round(float(vo.get("at", 0)) * 1000))
        inputs += ["-i", str(rdir / vo["file"])]
        amix.append(f"[{k}:a]aresample=48000,aformat=channel_layouts=stereo,adelay={ms}:all=1,"
                    f"volume={float(vo.get('gain', 0))}dB[vo]")
        labels.append("[vo]")
        voice_or_clip, k = True, k + 1
    elif vo.get("file"):
        missing.append(f"voice {vo['file']}")
    level = (f"loudnorm=I={CFG['video']['audio_lufs']}:TP={CFG['video']['audio_tp']}:LRA=11"
             if voice_or_clip else "alimiter=limit=0.89")
    amix.append(f"{''.join(labels)}amix=inputs={len(labels)}:normalize=0:duration=first,{level},"
                f"aresample=48000,atrim=0:{total:.4f}[aout]")

    out = bdir / f"{reel}_{op}.mp4"
    run([FF, "-y", "-v", "error", *inputs, "-filter_complex", ";".join(fc + amix),
         "-map", "[vout]", "-map", "[aout]", "-c:v", "libx264", "-preset", "medium", "-crf", str(crf),
         "-profile:v", "high", "-level", "4.1", "-pix_fmt", "yuv420p", "-r", str(FPS), "-fps_mode", "cfr",
         "-frames:v", str(total_frames), "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
         "-movflags", "+faststart", out.name], cwd=bdir)

    (bdir / f"{reel}_{op}.missing.txt").write_text("\n".join(missing) + "\n", encoding="utf-8")
    if not quiet:
        print(f"✔ {out}  ({total:.2f}s, {len(tl['shots'])} shots, {len(tl.get('overlays', []))} overlays)")
        if missing:
            print(f"  placeholders/missing ({len(missing)}): see {out.stem}.missing.txt")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("reel")
    ap.add_argument("--opening", default=None, help="A / B / C (default: timeline default_opening)")
    ap.add_argument("--final", action="store_true", help="master quality")
    a = ap.parse_args()
    build(a.reel, a.opening, a.final)


if __name__ == "__main__":
    main()
