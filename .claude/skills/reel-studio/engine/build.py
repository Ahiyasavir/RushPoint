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
import os as _os
# Previews encode "veryfast" (about 3x faster, same picture at preview crf); --final uses medium.
PRESET = _os.environ.get("RP_PRESET", "veryfast")
WORKERS = int(_os.environ.get("RP_WORKERS", max(2, (_os.cpu_count() or 4) // 2)))


def effect_filter(effect: str, frames: int, at: float = 0.0) -> str:
    n = max(frames - 1, 1)
    a = int(round(at * FPS))
    if effect == "punch_in":
        return (f"zoompan=z='1+0.08*on/{n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
                f":d=1:s={W}x{H}:fps={FPS}")
    if effect == "slow_push":
        return (f"zoompan=z='1+0.035*on/{n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
                f":d=1:s={W}x{H}:fps={FPS}")
    if effect == "zoom_in":
        # a living still: a real push in (Ahiya wanted the violin to feel alive)
        return (f"zoompan=z='1+0.20*on/{n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
                f":d=1:s={W}x{H}:fps={FPS}")
    if effect == "push_up":
        # slow zoom that drifts toward the TOP of the frame (looking up the stairs)
        return (f"zoompan=z='1+0.07*on/{n}':x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*0.12'"
                f":d=1:s={W}x{H}:fps={FPS}")
    if effect == "shake":
        return f"crop={W - 48}:{H - 84}:x='24+16*sin(n*1.7)':y='42+20*cos(n*2.3)',scale={W}:{H}"
    if effect == "punch_land":
        # EDIT-SPEC reel 2: 100% → 104% punch ON the landing frame, then ease back
        # 'at' = seconds into the shot where the feet touch down (shot "punch_at")
        return (f"zoompan=z='1+0.04*if(lt(on,{a}),0,if(lt(on,{a}+3),(on-{a})/3,max(0,1-(on-{a}-3)/14)))'"
                f":x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s={W}x{H}:fps={FPS}")
    if effect == "flash_in":
        return "fade=t=in:st=0:d=0.18:color=white"
    return "null"


def blur_chain(boxes: list[dict]) -> str:
    """Hide strangers' faces, plates, names. Box times are relative to the shot."""
    out = []
    for i, b in enumerate(boxes):
        if b.get("shape") == "circle":
            # a face, blurred in a CIRCLE that can travel from (x, y) to (x1, y1) over t1 s
            # (Ahiya: blur the faces, not squares over the people)
            r = int(b.get("r", 38)); d = 2 * r
            x0, y0 = float(b["x"]), float(b["y"])
            x1, y1 = float(b.get("x1", x0)), float(b.get("y1", y0))
            t1 = max(float(b.get("t1", 1.0)), 0.01)
            px = f"max(0,min(iw-{d},{x0 - r}+({x1 - x0})*min(t/{t1},1)))"
            py = f"max(0,min(ih-{d},{y0 - r}+({y1 - y0})*min(t/{t1},1)))"
            out.append(f"split[cm{i}][cs{i}];[cs{i}]crop={d}:{d}:x='{px}':y='{py}',boxblur=18:3,format=rgba,"
                       f"geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*lte(hypot(X-{r},Y-{r}),{r})'[cb{i}];"
                       f"[cm{i}][cb{i}]overlay=x='{px.replace('iw', 'W')}':y='{py.replace('ih', 'H')}'")
            continue
        x, y, w, h = int(b["x"]), int(b["y"]), int(b["w"]), int(b["h"])
        s, e = float(b.get("start", 0)), float(b.get("end", 999))
        out.append(f"split[bm{i}][bs{i}];[bs{i}]crop={w}:{h}:{x}:{y},boxblur=28:3[bb{i}];"
                   f"[bm{i}][bb{i}]overlay={x}:{y}:enable='between(t,{s},{e})'")
    return ",".join(out) if out else "null"


def render_segment(i: int, shot: dict, rdir: Path, bdir: Path, clip_gain: float, crf: int,
                   ovs: list | None = None) -> Path:
    frames = fr(shot["end"]) - fr(shot["start"])
    dur = secs(frames)
    seg = bdir / f"seg_{i:02d}.mp4"
    norm = f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1"
    # "crop": [x, y, w, h] in the normalised 1080x1920 frame → a punch in on the subject
    # (reel 3: he is small in the 3G walk). Blur boxes are in the CROPPED frame.
    crop = shot.get("crop")
    if crop:   # never let ffmpeg clamp silently: a crop outside the frame is a timeline bug
        x, y, w, h = map(int, crop)
        if x < 0 or y < 0 or x + w > W or y + h > H:
            raise SystemExit(f"shot {shot['id']}: crop {crop} leaves the {W}x{H} frame")
    pre = f"crop={int(crop[2])}:{int(crop[3])}:{int(crop[0])}:{int(crop[1])},scale={W}:{H}," if crop else ""
    tail = (f"{pre}{effect_filter(shot.get('effect', 'none'), frames, float(shot.get('punch_at', 0)))},{blur_chain(shot.get('blur', []))},"
            f"@@OV@@tpad=stop_mode=clone:stop_duration={dur + 1:.3f},format=yuv420p")
    enc = ["-c:v", "libx264", "-preset", PRESET, "-crf", str(crf), "-pix_fmt", "yuv420p",
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
        if shot.get("reverse"):
            # REWIND: play src [in, in_end] backwards, squeezed into the shot. fps BEFORE
            # reverse keeps the buffered frames to dur*30 (reverse holds them all in memory)
            in_end = float(shot["in_end"])
            sp = max((in_end - start_in) / dur, 0.01)
            vf = (f"[0:v]trim=start={start_in:.4f}:end={in_end:.4f},setpts=(PTS-STARTPTS)/{sp:.4f},"
                  f"fps={FPS},reverse,{norm},{tail}[v]")
            cmd = [FF, "-y", "-v", "error", "-i", clip, *silence,
                   "-filter_complex", vf, "-map", "[v]", "-map", "1:a", *enc, seg]
            cmd = composite_overlays(cmd, ovs or [], dur)
            run(cmd, cwd=bdir)
            return seg
        if shot.get("freeze"):
            # hold the frame at 'in' (reel 2: the frozen landing on jump 5)
            vf = (f"[0:v]trim=end_frame=1,loop=loop={frames + 40}:size=1:start=0,"
                  f"setpts=N/{FPS}/TB,{norm},{tail}[v]")
        else:
            vf = f"[0:v]setpts=(PTS-STARTPTS)/{speed},fps={FPS},{norm},{tail}[v]"
        clip_gain = float(shot.get("audio_gain", clip_gain))   # per shot: only the talking shot keeps its sound
        if has_audio(clip) and clip_gain > 0:
            tempo = f"atempo={speed}," if abs(speed - 1) > 1e-3 and 0.5 <= speed <= 2 else ""
            # A shot that KEEPS its sound is cut inside the graph (trim/atrim), not by an
            # input seek: -ss before -i landed the audio ~0.3 s late against the picture on
            # the 3I take, which pushed 'כתב' past the reel's last frame (Ahiya heard it cut).
            vf_t = vf.replace("[0:v]", f"[0:v]trim=start={start_in:.4f},", 1)
            af = (f"[0:a]atrim=start={start_in:.4f},asetpts=PTS-STARTPTS,{tempo}volume={clip_gain},"
                  f"aresample=48000,apad,atrim=0:{dur:.4f}[a]")
            cmd = [FF, "-y", "-v", "error", "-i", clip,
                   "-filter_complex", f"{vf_t};{af}", "-map", "[v]", "-map", "[a]", *enc, seg]
        else:
            cmd = [FF, "-y", "-v", "error", "-ss", f"{start_in:.3f}", "-i", clip, *silence,
                   "-filter_complex", vf, "-map", "[v]", "-map", "1:a", *enc, seg]
    elif graphic and graphic.exists():
        timer = shot.get("timer")
        if timer:
            # a draining bar, slid per frame through a track (drawbox evaluates w only once).
            # The red bar leaves the track to the right, so the time left drains RTL.
            tw, th = int(timer["w"]), int(timer["h"])
            tdur = float(timer.get("dur", dur))
            # live seconds left, drawn per frame beside the bar (retention: the eye locks on it)
            count = ""
            if timer.get("count"):
                cx, cy = int(timer.get("count_x", timer["x"])), int(timer.get("count_y", int(timer["y"]) - 92))
                count = (f",drawtext=fontfile=fonts/JetBrainsMono-800.ttf:text='%{{eif\\:ceil({tdur}-t)\\:d}}':"
                         f"fontcolor={timer.get('count_color', '0xEF4444')}:fontsize=76:x={cx}:y={cy}:"
                         f"enable='lt(t,{tdur})'")
            count = count + ","
            rnd = (f"geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':"
                   f"a='255*lt(hypot(max(0,abs(X-{tw}/2)-({tw}/2-{th}/2)),Y-{th}/2),{th}/2)'")
            vf = (f"[0:v]fps={FPS},{norm}[g];"
                  f"[3:v][2:v]overlay=x='{tw}*min(t/{tdur},1)':y=0:eval=frame,format=rgba,{rnd}[bar];"
                  f"[g][bar]overlay=x={int(timer['x'])}:y={int(timer['y'])}{count}{tail}[v]")
            barsrc = ["-f", "lavfi", "-i", f"color=c={timer.get('color', '0xEF4444')}:s={tw}x{th}:r={FPS}:d={dur + 1:.3f}",
                      "-f", "lavfi", "-i", f"color=c={timer.get('track', '0xE7E5E4')}:s={tw}x{th}:r={FPS}:d={dur + 1:.3f}"]
        else:
            vf = f"[0:v]fps={FPS},{norm},{tail}[v]"
            barsrc = []
        cmd = [FF, "-y", "-v", "error", "-loop", "1", "-framerate", str(FPS), "-t", f"{dur + 1:.3f}",
               "-i", graphic, *silence, *barsrc, "-filter_complex", vf, "-map", "[v]", "-map", "1:a", *enc, seg]
    else:
        want = shot.get("clip") or shot.get("graphic") or "?"
        txt = bdir / f"ph_{i:02d}.txt"
        txt.write_text(f"{shot['id']}\n{Path(str(want)).name}\n{dur:.2f}s  {shot.get('effect', 'none')}",
                       encoding="utf-8")
        color = PLACEHOLDER_COLORS[i % len(PLACEHOLDER_COLORS)]
        vf = (f"[0:v]drawtext=fontfile=fonts/JetBrainsMono-700.ttf:textfile={txt.name}:fontcolor=white:"
              f"fontsize=74:line_spacing=26:x=(w-text_w)/2:y=h*0.59:box=1:boxcolor=0x1C1917@0.55:"
              f"boxborderw=30,drawbox=x=0:y=0:w=iw:h=ih*0.1:color=black@0.25:t=fill,"
              f"drawbox=x=0:y=ih-ih*0.13:w=iw:h=ih*0.13:color=black@0.25:t=fill,{tail}[v]")
        cmd = [FF, "-y", "-v", "error", "-f", "lavfi", "-i", f"color=c={color}:s={W}x{H}:r={FPS}:d={dur + 1:.3f}",
               *silence, "-filter_complex", vf, "-map", "[v]", "-map", "1:a", *enc, seg]
    cmd = composite_overlays(cmd, ovs or [], dur)
    run(cmd, cwd=bdir)
    return seg


def composite_overlays(cmd: list, ovs: list, dur: float) -> list:
    """Graphics are laid INTO each shot, not over the whole reel in the final pass.

    Measured on this pipeline: a single PNG frame held with eof_action=repeat did not
    reliably stay on screen (reel 3's proof cards never appeared), and long range
    overlays (looped full length, or shifted with -itsoffset) either decode a PNG per
    frame for the whole reel or deadlock the graph. Inside one shot every looped PNG is
    as long as the shot, so there is nothing to sync and the cost is only its window.
    ovs = [(png, start_in_shot, end_in_shot)].
    """
    i = cmd.index("-filter_complex")
    fc = cmd[i + 1]
    if not ovs:
        cmd[i + 1] = fc.replace("@@OV@@", "")
        return cmd
    n_in = cmd[:i].count("-i")
    extra, chain = [], "null[pp0];"
    for j, item in enumerate(ovs):
        png, a, b = item[0], item[1], item[2]
        extra += ["-loop", "1", "-framerate", str(FPS), "-t", f"{dur + 1:.3f}", "-i", str(png)]
        if len(item) > 3 and item[3] == "dissolve":
            # the previous shot's last frame, fading out over the new shot (a soft cut)
            chain += (f"[{n_in + j}:v]format=rgba,fade=t=out:st=0:d={b:.3f}:alpha=1[q{j}];"
                      f"[pp{j}][q{j}]overlay=0:0[pp{j + 1}];")
            continue
        chain += (f"[{n_in + j}:v]format=rgba[q{j}];[pp{j}][q{j}]overlay=0:0:"
                  f"enable='between(t,{a:.4f},{b:.4f})'[pp{j + 1}];")
    chain += f"[pp{len(ovs)}]"
    cmd[i + 1] = fc.replace("@@OV@@", chain)
    return cmd[:i] + extra + cmd[i:]


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
    global PRESET
    if final and "RP_PRESET" not in _os.environ:
        PRESET = "medium"
    total_frames = fr(tl["shots"][-1]["end"])
    total = secs(total_frames)

    clip_gain = float(tl.get("keep_clip_audio", 0.0))
    shot_audio = any(float(s.get("audio_gain", 0)) > 0 for s in tl["shots"])
    segs, missing, jobs = [], [], []
    for i, s in enumerate(tl["shots"]):
        src = s.get("clip") or s.get("graphic")
        if src and not (rdir / src).exists() and not Path(str(src)).exists():
            missing.append(f"{s['id']}: {src}")
        a0, a1 = secs(fr(s["start"])), secs(fr(s["end"]))
        mine = []
        for o in tl.get("overlays", []):
            if o.get("occlude"):
                continue            # composited behind the person after the concat (lib/occlude.py)
            png = Path(o["png"])
            png = png if png.is_absolute() else rdir / png
            os_, oe = float(o["start"]), float(o["end"])
            if oe <= a0 + 1e-6 or os_ >= a1 - 1e-6:
                continue
            if not png.exists():
                missing.append(f"overlay {png.name}")
                continue
            mine.append((png, max(os_, a0) - a0, min(oe, a1) - a0 - 1e-3))
        jobs.append((i, s, mine))
    # PARALLEL: every segment is independent once the dissolve is taken out of it. Measured
    # on reel 12 (30 shots, 2 min, 8 cores): sequential medium ~7 min.
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(WORKERS) as ex:
        segs = list(ex.map(lambda j: render_segment(j[0], j[1], rdir, bdir, clip_gain, crf, j[2]), jobs))
    if not quiet:
        print(f"  {len(segs)} segments rendered on {WORKERS} workers", flush=True)
    # DISSOLVE as a second, cheap pass: the previous segment's last frame fades out over the
    # first dz seconds of this one (same look as before, but no longer a serial dependency)
    dz = float(tl.get("dissolve", 0) or 0)
    if dz:
        def last_png(i):
            p = bdir / f"last_{i:02d}.png"
            run([FF, "-y", "-v", "error", "-sseof", "-0.07", "-i", segs[i].name, "-frames:v", "1", "-update", "1", p.name], cwd=bdir)
            return p
        need = [i for i, s in enumerate(tl["shots"]) if i > 0 and not s.get("cut")]
        with ThreadPoolExecutor(WORKERS) as ex:
            lasts = dict(zip(need, ex.map(lambda i: last_png(i - 1), need)))

        def blend(i):
            out = bdir / f"seg_{i:02d}_d.mp4"
            run([FF, "-y", "-v", "error", "-i", segs[i].name, "-loop", "1", "-t", f"{dz:.3f}", "-i", lasts[i].name,
                 "-filter_complex", f"[1:v]format=rgba,fade=t=out:st=0:d={dz:.3f}:alpha=1[q];[0:v][q]overlay=0:0:eof_action=pass,format=yuv420p[v]",
                 "-map", "[v]", "-map", "0:a", "-c:v", "libx264", "-preset", PRESET, "-crf", str(crf), "-pix_fmt", "yuv420p",
                 "-r", str(FPS), "-fps_mode", "cfr", "-c:a", "copy", out.name], cwd=bdir)
            return i, out
        with ThreadPoolExecutor(WORKERS) as ex:
            for i, out in ex.map(blend, need):
                segs[i] = out

    # SAMPLE EXACT audio bed. Each segment's AAC carries its own encoder priming, and the
    # mix pass reads samples, not timestamps: over 17 segments the talking clip arrived
    # ~0.5 s late against its lips (measured on reel 3's 3I). So every segment's sound is
    # re-cut to exactly its frame count in PCM and those are joined instead.
    wavs = []
    for i, (sg, s) in enumerate(zip(segs, tl["shots"])):
        n = fr(s["end"]) - fr(s["start"])
        wv = bdir / f"seg_{i:02d}.wav"
        run([FF, "-y", "-v", "error", "-i", sg.name, "-vn", "-af",
             f"aresample=48000:async=1:first_pts=0,apad,atrim=end_sample={int(round(secs(n) * 48000))}",
             "-ac", "2", "-c:a", "pcm_s16le", wv.name], cwd=bdir)
        wavs.append(wv)
    alst = bdir / "concat_audio.txt"
    alst.write_text("".join(f"file '{w.name}'\n" for w in wavs), encoding="utf-8")
    base_audio = bdir / "base_audio.wav"
    run([FF, "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", alst.name, "-c", "copy", base_audio.name], cwd=bdir)

    lst = bdir / "concat.txt"
    lst.write_text("".join(f"file '{p.name}'\n" for p in segs), encoding="utf-8")
    base = bdir / "base.mp4"
    run([FF, "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", lst.name, "-c", "copy", base.name], cwd=bdir)
    occ = [(str(Path(o["png"]) if Path(o["png"]).is_absolute() else rdir / o["png"]), float(o["start"]), float(o["end"]))
           for o in tl.get("overlays", []) if o.get("occlude")]
    if occ:
        from lib.occlude import occlude
        plate = rdir / tl.get("occlude_plate", "assets_bg_plate.png")
        base = occlude(base, bdir / "base_occ.mp4", occ, plate, total_frames, crf)

    build_ass(tl.get("captions", []), bdir / "subs.ass")

    inputs = ["-i", base.name]
    fc, v, k = [], "[0:v]", 1
    if tl.get("progress_bar"):
        # retention: a thin bar filling across the top for the whole reel
        pb = tl["progress_bar"] if isinstance(tl["progress_bar"], dict) else {}
        inputs += ["-f", "lavfi", "-i", f"color=c={pb.get('color', '0xFFB300')}:s={W}x{int(pb.get('h', 10))}:r={FPS}:d={total + 1:.3f}"]
        fc.append(f"{v}[{k}:v]overlay=x='-W+W*t/{total:.3f}':y={int(pb.get('y', 196))}:eval=frame[pbv]")
        v, k = "[pbv]", k + 1
    fc.append(f"{v}ass=subs.ass:fontsdir=fonts,format=yuv420p[vout]")
    k_video = k            # the mixed wav will be the next video pass input

    # AUDIO IS MIXED IN ITS OWN PASS. In one command with the video graph (ass + overlays)
    # ffmpeg stopped reading the CTA voice 3 s in and the rest came out as digital silence;
    # the identical audio graph run alone was complete (bisected, reel 1 v3).
    ainputs, k = ["-i", base_audio.name], 1
    # base audio = the talking clips (3I); it feeds the duck key as well as the mix
    amix = ["[0:a]asplit=2[a0][key0]"]
    labels, voice_or_clip = ["[a0]"], clip_gain > 0 or shot_audio
    keys = ["[key0]"]

    def add_input(path: Path, at: float, gain: float, is_voice: bool):
        nonlocal k
        ms = int(round(at * 1000))
        ainputs.extend(["-i", str(path)])
        lab = f"s{k}"
        out = f"[{lab}]" if not is_voice else f"[{lab}];[{lab}]asplit=2[{lab}m][{lab}k]"
        amix.append(f"[{k}:a]aresample=48000,aformat=channel_layouts=stereo,adelay={ms}:all=1,"
                    f"apad=whole_dur={total:.3f},volume={gain}dB{out}")
        labels.append(f"[{lab}m]" if is_voice else f"[{lab}]")
        if is_voice:
            keys.append(f"[{lab}k]")
        k += 1

    for x in tl.get("sfx", []):
        f = rdir / x["file"]
        if not f.exists():
            missing.append(f"sfx {x['file']}")
            continue
        add_input(f, float(x["at"]), float(x.get("gain", 0)), str(x["file"]).startswith("voice/"))
    vo = tl.get("voice") or {}
    if vo.get("file") and (rdir / vo["file"]).exists():
        add_input(rdir / vo["file"], float(vo.get("at", 0)), float(vo.get("gain", 0)), True)
        voice_or_clip = True
    elif vo.get("file"):
        missing.append(f"voice {vo['file']}")

    # MUSIC (Ahiya, 2026-10-01: every reel wants one). Synthesised per reel by
    # lib/music.make_music, cached by its spec, and DUCKED under every voice and every
    # talking clip by a sidechain keyed on exactly those, so no window list can go stale.
    mu = tl.get("music")
    if mu:
        import hashlib
        import json as _json
        from lib.music import make_music
        spec = {kk: mu[kk] for kk in ("style", "bpm", "energy", "accents", "drops", "seed") if kk in mu}
        spec["total"] = round(total, 3)
        tag = hashlib.sha1(_json.dumps(spec, sort_keys=True).encode()).hexdigest()[:10]
        mfile = rdir / "build" / f"music_{tag}.wav"
        if not mfile.exists():
            make_music(mfile, **spec)
        ainputs.extend(["-i", str(mfile)])
        amix.append(f"[{k}:a]aresample=48000,aformat=channel_layouts=stereo,volume={float(mu.get('gain', -14))}dB[mus]")
        if len(keys) > 1:
            amix.append(f"{''.join(keys)}amix=inputs={len(keys)}:normalize=0:duration=first[key]")
        else:
            amix.append("[key0]anull[key]")
        amix.append(f"[mus][key]sidechaincompress=threshold=0.015:ratio=10:attack=15:release=400:makeup=1[musd]")
        labels.append("[musd]")
        k += 1
    else:
        amix.append(f"{''.join(keys)}amix=inputs={len(keys)}:normalize=0[keysink];[keysink]anullsink")
    level = (f"loudnorm=I={CFG['video']['audio_lufs']}:TP={CFG['video']['audio_tp']}:LRA=11"
             if voice_or_clip and tl.get("mix_loudnorm") else "alimiter=limit=0.89")
    # every input is padded to the full length above: amix drops inputs as they END, and
    # with 57 short SFX files that silenced the CTA voice 2.7 s in (measured, reel 1 v2)
    amix.append(f"{''.join(labels)}amix=inputs={len(labels)}:normalize=0:duration=first,{level},"
                f"aresample=48000,atrim=0:{total:.4f}[aout]")

    mixwav = bdir / f"{reel}_{op}_mix.wav"
    run([FF, "-y", "-v", "error", *ainputs, "-filter_complex", ";".join(amix), "-map", "[aout]",
         "-c:a", "pcm_s16le", mixwav.name], cwd=bdir)
    inputs += ["-i", mixwav.name]
    out = bdir / f"{reel}_{op}.mp4"
    run([FF, "-y", "-v", "error", *inputs, "-filter_complex", ";".join(fc),
         "-map", "[vout]", "-map", f"{k_video}:a", "-c:v", "libx264", "-preset", PRESET, "-crf", str(crf),
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
