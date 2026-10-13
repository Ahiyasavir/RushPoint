# -*- coding: utf-8 -*-
"""Automatic quality check of a rendered reel.

    python qa.py reel2-stairs                 # checks build/reel2-stairs_<default>.mp4
    python qa.py reel2-stairs --opening B
    python qa.py reel2-stairs --final         # also FAILS on any TODO or placeholder left

Checks, each printed with its denominator so "nothing found" is never "nothing looked at":
  format     1080x1920, 30fps CFR, H.264 + AAC, yuv420p
  length     between min and max seconds (config.json)
  pace       no shot longer than max_shot_seconds (picture changes every 2–3 s)
  static     no shot flagged "static": true (rule: no seated / static shots)
  safe zone  no caption line and no text/logo overlay pixel in the top 200 / bottom 250 px
  dashes     no hyphen, dash or maqaf in any caption
  loop       last frame vs first frame difference (and the last + first caption lines,
             printed together so a human reads them as one sentence)
  todo       every TODO still in the timeline/config, and every placeholder shot
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from lib import graphics  # noqa: E402
from lib.captions import caption_boxes, dash_problems  # noqa: E402
from lib.common import (CFG, H, W, apply_opening, ffmpeg_bin, ffprobe, is_todo,  # noqa: E402
                        load_timeline, reel_dir, run)

V = CFG["video"]
TOP, BOT = CFG["safe_zone"]["top"], H - CFG["safe_zone"]["bottom"]


def todos(obj, path="") -> list[str]:
    out = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k.startswith("_") or k in ("todo", "rules", "why", "note", "source", "blur_note"):
                continue
            out += todos(v, f"{path}.{k}" if path else k)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            out += todos(v, f"{path}[{i}]")
    elif isinstance(obj, str) and "TODO" in obj:
        out.append(f"{path} = {obj!r}")
    return out


def frame(video: Path, at: str, tmp: Path, name: str) -> np.ndarray:
    p = tmp / f"{name}.png"
    args = [ffmpeg_bin(), "-v", "error", "-y"]
    args += ["-sseof", "-0.05"] if at == "last" else ["-ss", "0"]
    run(args + ["-i", str(video), "-frames:v", "1", "-vf", "scale=108:192", str(p)])
    return np.asarray(Image.open(p).convert("L")).astype(float)


def check(reel: str, opening: str | None, final: bool) -> int:
    rdir = reel_dir(reel)
    tl = apply_opening(load_timeline(reel), opening)
    op = tl.get("opening", "A")
    video = rdir / "build" / f"{reel}_{op}.mp4"
    fails, warns, ok = [], [], []

    if not video.exists():
        print(f"FAIL no render at {video}; run build.py first")
        return 1

    # format + length
    info = ffprobe(video)
    vs = next(s for s in info["streams"] if s["codec_type"] == "video")
    aus = [s for s in info["streams"] if s["codec_type"] == "audio"]
    dur = float(info["format"]["duration"])
    num, den = map(int, vs["r_frame_rate"].split("/"))
    fmt = [(vs["width"], vs["height"]) == (W, H), num / den == V["fps"], vs["codec_name"] == "h264",
           vs.get("pix_fmt") == "yuv420p", bool(aus) and aus[0]["codec_name"] == "aac"]
    (ok if all(fmt) else fails).append(
        f"format {vs['width']}x{vs['height']} {num / den:g}fps {vs['codec_name']}/{vs.get('pix_fmt')} "
        f"audio {aus[0]['codec_name'] if aus else 'NONE'}")
    # a reel may widen the window on Ahiya's call (reel 1: answers shown, longer riddles)
    lo, hi = tl.get("min_seconds", V["min_seconds"]), tl.get("max_seconds", V["max_seconds"])
    (ok if lo <= dur <= hi else fails).append(f"length {dur:.2f}s (allowed {lo}–{hi})")

    # pace + static
    long_ = [f"{s['id']} {s['end'] - s['start']:.2f}s" for s in tl["shots"]
             if s["end"] - s["start"] > V["max_shot_seconds"] + 1e-6]
    (warns if long_ else ok).append(f"pace: {len(long_)} of {len(tl['shots'])} shots longer than "
                                    f"{V['max_shot_seconds']}s {long_ if long_ else ''}")
    static = [s["id"] for s in tl["shots"] if s.get("static")]
    (fails if static else ok).append(f"static: {len(static)} of {len(tl['shots'])} shots flagged static {static or ''}")

    # safe zone: captions (geometry) + text/logo overlays (actual alpha pixels)
    caps = tl.get("captions", [])
    cbad = [b for b in caption_boxes(caps) if b[1] < TOP or b[2] > BOT]
    (fails if cbad else ok).append(f"safe zone captions: {len(cbad)} of {len(caps)} outside {TOP}..{BOT}px {cbad or ''}")
    rtl = graphics.expand(tl, rdir)
    seen, obad = set(), []
    for o in rtl.get("overlays", []):
        if o.get("kind", "text") not in ("text", "logo") or o["png"] in seen:
            continue
        seen.add(o["png"])
        ovp = Path(o["png"])
        a = np.asarray(Image.open(ovp if ovp.is_absolute() else rdir / ovp).convert("RGBA"))[:, :, 3]
        rows = np.where(a.max(axis=1) > 16)[0]
        if len(rows) and (rows[0] < TOP or rows[-1] > BOT):
            obad.append(f"{Path(o['png']).name} y {rows[0]}..{rows[-1]}")
    (fails if obad else ok).append(f"safe zone overlays: {len(obad)} of {len(seen)} intrude {obad or ''}")

    # dashes
    d = dash_problems(caps)
    (fails if d else ok).append(f"dashes: {len(d)} of {len(caps)} captions {d or ''}")

    # loop
    with tempfile.TemporaryDirectory() as td:
        a, b = frame(video, "first", Path(td), "a"), frame(video, "last", Path(td), "b")
    diff = float(np.abs(a - b).mean())
    msg = f"loop: first↔last frame mean difference {diff:.1f}/255 (≤ 12 reads as one continuous shot)"
    (ok if diff <= 12 else warns).append(msg)
    if caps:
        first = min(caps, key=lambda c: c["start"])
        last = max(caps, key=lambda c: c["end"])
        txt = lambda c: c.get("text") or " ".join(w for w, *_ in c["words"])  # noqa: E731
        ok.append(f"loop text, read as one sentence: «{txt(last)}» → «{txt(first)}»")

    # ── checks for the bugs that reached the founder in the 2026-10-01/02 session ──
    # music: every reel has a bed, and no two reels in the work folder share a style
    # (he caught "no music" and then "the same music in all three", both twice)
    from lib.common import WORK_ROOT
    mu = tl.get("music")
    if not mu:
        (fails if final else warns).append("music: none. The founder wants music in every reel (lib/music.py)")
    else:
        same = []
        for other in sorted(WORK_ROOT.glob("*/timeline.json")):
            if other.parent.name == reel:
                continue
            try:
                ot = json.loads(other.read_text(encoding="utf-8"))
            except Exception:
                continue
            if ot.get("shelved"):
                continue
            if (ot.get("music") or {}).get("style") == mu.get("style"):
                same.append(other.parent.name)
        (fails if same else ok).append(f"music: style '{mu.get('style')}'" +
                                      (f" ALSO used by {same}: each reel needs its own" if same else ", unique in the work folder"))

    # platform UI: Instagram's description + name sit under y 1420, its buttons right of x 960
    ui = int(CFG["safe_zone"].get("platform_ui_bottom", 1420))
    low = [f"{n} bottom {b}" for n, a, b in caption_boxes(caps) if b > ui]
    (fails if (final and low and CFG["safe_zone"].get("platform_ui_strict")) else (warns if low else ok)).append(
        f"platform UI zone: {len(low)} of {len(caps)} captions reach below y {ui} (IG description / name) {low[:4]}")

    # voice continuity: wherever a voice file speaks, the final mix must not be silent
    # (an amix bug once turned a recorded line into digital silence 3 s in)
    def env_db(path, start=0.0, dur=None, hop=0.1):
        cmd = [ffmpeg_bin(), "-v", "error", "-ss", f"{start:.3f}", "-i", str(path)]
        if dur:
            cmd += ["-t", f"{dur:.3f}"]
        cmd += ["-vn", "-ac", "1", "-ar", "8000", "-f", "f32le", "-"]
        import subprocess
        x = np.frombuffer(subprocess.run(cmd, capture_output=True).stdout, np.float32)
        n = int(8000 * hop)
        return np.array([20 * np.log10(np.sqrt(np.mean(x[i:i + n] ** 2)) + 1e-9) for i in range(0, len(x) - n, n)])
    voices = [(rdir / x["file"], float(x["at"])) for x in tl.get("sfx", []) if str(x["file"]).startswith("voice/")]
    if (tl.get("voice") or {}).get("file"):
        voices.append((rdir / tl["voice"]["file"], float(tl["voice"].get("at", 0))))
    checked = covered = 0
    final_env = env_db(video) if voices else None
    for vf, at in voices:
        if not vf.exists():
            continue
        ve = env_db(vf)
        for i, d in enumerate(ve):
            if d > -32:
                j = int(round(at / 0.1)) + i
                if 0 <= j < len(final_env):
                    checked += 1
                    covered += final_env[j] > -42
    if checked:
        frac = covered / checked
        (ok if frac >= 0.95 else fails).append(
            f"voice continuity: {covered} of {checked} spoken 100 ms windows are audible in the mix ({frac:.0%})")

    # lip sync: a shot that keeps its own sound must line up with its source
    worst = None
    for sh in tl["shots"]:
        if float(sh.get("audio_gain", 0)) <= 0 or not sh.get("clip"):
            continue
        sp = float(sh.get("speed", 1.0))
        dur = float(sh["end"]) - float(sh["start"])
        a = env_db(video, float(sh["start"]), dur, 0.01)
        b = env_db(rdir / sh["clip"], float(sh.get("in", 0)), dur * sp, 0.01 * sp)
        n = min(len(a), len(b))
        if n < 50:
            continue
        a, b = a[:n] - a[:n].mean(), b[:n] - b[:n].mean()
        lags = range(-25, 26)
        best = max(lags, key=lambda L: float(np.dot(a[max(0, L):n + min(0, L)], b[max(0, -L):n - max(0, L)])))
        worst = best if worst is None or abs(best) > abs(worst) else worst
    if worst is not None:
        (ok if abs(worst) * 10 <= 60 else fails).append(f"lip sync: worst talking shot offset {worst * 10} ms (limit 60)")

    # ── checks for what reached the founder on 2026-10-05 (reels 14, 15) ──
    # captions too small ("הכתוביות קטנות מידי"): 84 by default, never under 78
    small = [c.get("text", "")[:20] for c in caps if int(c.get("size") or CFG["captions"]["sub_size"]) < 78]
    (fails if small else ok).append(f"caption size: {len(small)} of {len(caps)} under 78px {small[:3] if small else ''}")
    # no logo any more (founder rule 43)
    logos = sorted({Path(o["png"]).name for o in tl.get("overlays", []) if "logo" in Path(str(o["png"])).name.lower()})
    (fails if logos else ok).append(f"logo: {len(logos)} logo overlays (rule 43: none) {logos or ''}")
    # no dates in a reel (rule 36); a captive video (classroom, in app) may set allow_dates
    date_re = re.compile(r"\d{1,2}\s*ב?(ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)|\d{1,2}[./]\d{1,2}")
    txt_ = lambda c: c.get("text") or " ".join(w for w, *_ in c.get("words", []))  # noqa: E731
    dated = [txt_(c)[:30] for c in caps if date_re.search(txt_(c))]
    if not tl.get("allow_dates"):
        (fails if dated else ok).append(f"dates: {len(dated)} captions carry a date {dated[:3] if dated else ''}")
    # music loud enough ("תחזק קצת את המוזיקה", twice): -11 is his level
    if mu and float(mu.get("gain", -13)) < -12.5:
        warns.append(f"music gain {mu.get('gain')} dB: he asked for louder twice, use about -11")
    # audio/video drift: every source that brings its own sound, and the render itself, must
    # end its audio and its picture together (acrossfade joins once ate 0.7 s over 12 cuts)
    def stream_durs(path):
        inf = ffprobe(path)
        v_ = next((float(s_.get("duration", 0)) for s_ in inf["streams"] if s_["codec_type"] == "video"), 0)
        a_ = next((float(s_.get("duration", 0)) for s_ in inf["streams"] if s_["codec_type"] == "audio"), None)
        return v_, a_
    drift = []
    for src in sorted({sh["clip"] for sh in tl["shots"] if sh.get("clip") and float(sh.get("audio_gain", 0)) > 0}):
        v_, a_ = stream_durs(rdir / src)
        if a_ is not None and abs(v_ - a_) > 0.1:
            drift.append(f"{src} video {v_:.2f}s audio {a_:.2f}s")
    (fails if drift else ok).append(f"a/v drift: {len(drift)} talking sources whose sound and picture differ in length {drift or ''}")
    # a jump cut left showing: two consecutive shots of the SAME clip, same framing, not continuous
    jumps = []
    for p_, n_ in zip(tl["shots"], tl["shots"][1:]):
        if p_.get("clip") and p_.get("clip") == n_.get("clip") and p_.get("crop") == n_.get("crop"):
            exp = float(p_.get("in", 0)) + (float(p_["end"]) - float(p_["start"])) * float(p_.get("speed", 1))
            if abs(float(n_.get("in", 0)) - exp) > 0.08:
                jumps.append(f"{p_['id']}→{n_['id']}")
    (fails if jumps else ok).append(f"visible jump cuts: {len(jumps)} (cover each with a framing change AT the join, an insert or a card) {jumps or ''}")
    # flat colour ("נראה מאוד עמום ולא איכותי"): low mean saturation means grade it (portrait.GRADE)
    try:
        import subprocess as _sp
        raw = _sp.run([ffmpeg_bin(), "-v", "error", "-i", str(video), "-vf", "fps=0.5,scale=96:170,format=rgb24",
                       "-f", "rawvideo", "-"], capture_output=True).stdout
        px = np.frombuffer(raw, np.uint8).reshape(-1, 3).astype(np.float32) / 255
        if tl.get("white_background"):          # a white ground is not "flat": judge the person, not the paper
            px = px[px.min(1) < 0.9]
        mx, mn = px.max(1), px.min(1)
        sat = float(np.mean((mx - mn) / (mx + 1e-6)))
        (ok if sat >= 0.20 else warns).append(f"colour: mean saturation {sat:.2f} (under 0.20 reads flat: apply lib/portrait.GRADE)")
    except Exception as e:  # noqa: BLE001
        warns.append(f"colour: not measured ({e})")

    # ── 2026-10-13: three things that reached him or nearly did (lessons-2026-10-13.md) ──────────
    import subprocess as _sp2

    def grab(at, size="108:192", fmt="gray"):
        raw = _sp2.run([ffmpeg_bin(), "-v", "error", "-ss", f"{max(at, 0):.3f}", "-i", str(video), "-frames:v", "1",
                        "-vf", f"scale={size},format={fmt}", "-f", "rawvideo", "-"], capture_output=True).stdout
        return np.frombuffer(raw, np.uint8).astype(np.float32)

    talk = [s_ for s_ in tl["shots"] if s_.get("clip") and "audio_gain" in s_]
    # (a) a frozen last frame: the clip ran out before the shot did and the engine cloned its final
    #     frame ("רואים אותי מפסיק לזוז"). The last frame must differ from the one 3 frames before it.
    frozen = []
    for s_ in talk:
        f1, f0 = grab(s_["end"] - 0.035), grab(s_["end"] - 0.135)
        if len(f1) and len(f1) == len(f0) and float(np.abs(f1 - f0).mean()) < 0.12:
            frozen.append(s_["id"])
    (fails if frozen else ok).append(f"frozen tails: {len(frozen)} of {len(talk)} talking shots end on a held frame {frozen or ''}")
    # (b) the picture of a talking shot outlives his eyes: tails.json (the work folder's tails.py:
    #     head pose, iris, blink) says where the last vowel ends and where he looks away.
    tails_p = rdir / "tails.json"
    if tails_p.exists() and talk:
        tails = json.loads(tails_p.read_text(encoding="utf-8"))
        vstart = {Path(x["file"]).stem: x["at"] for x in tl.get("sfx", []) if str(x.get("file", "")).startswith("voice/")}
        late = []
        for s_ in talk:
            tinfo = tails.get(s_["id"])
            if not tinfo:
                continue
            pic = s_["end"] - vstart.get(s_["id"], s_["start"])
            lim = tinfo["vend"] + 0.06
            if tinfo.get("leave") and tinfo["leave"] > 0.3:
                lim = min(lim, tinfo["leave"] - 0.10)
            if pic > max(lim, tinfo["vend"] - 0.45) + 0.04:
                late.append(f"{s_['id']} +{pic - lim:.2f}s")
        (fails if late else ok).append(f"eyes at the cut: {len(late)} of {len(talk)} talking shots stay after he looks away or stops {late or ''}")
    elif talk and tl.get("white_background"):
        warns.append("eyes at the cut: no tails.json. Run tails.py: he looks to the laptop on the last word of every take")
    # (c) "white" means measured white in the FINAL file, per shot (mixed colour range tags once
    #     turned it 235 grey from one shot on, while every clip measured 255 on its own).
    if tl.get("white_background"):
        grey = []
        for s_ in talk:
            # rgb24, not gray: ffmpeg's gray conversion of a limited range file reads white as 241
            f = grab((s_["start"] + s_["end"]) / 2, "108:192", "rgb24").reshape(192, 108, 3)
            # rows 18..23 = y 180..230: above the safe zone, so no chapter tag or title can sit there
            corner = float(min(f[18:23, 1:6].mean(), f[18:23, -6:-1].mean()))
            if corner < 247:
                grey.append(f"{s_['id']} {corner:.0f}")
        (fails if grey else ok).append(f"white background: {len(grey)} of {len(talk)} talking shots under 247 at the top corners (y 180..230) {grey or ''}")

    # todo + placeholders
    t = todos(tl)
    if is_todo(CFG["money"]["usd_ils_rate"]) and "receipt" in tl:
        t.append("config.json money.usd_ils_rate = 'TODO'")
    miss_f = rdir / "build" / f"{reel}_{op}.missing.txt"
    miss = [m for m in miss_f.read_text(encoding="utf-8").splitlines() if m.strip()] if miss_f.exists() else []
    (fails if (final and (t or miss)) else (warns if (t or miss) else ok)).append(
        f"todo: {len(t)} TODO values, {len(miss)} missing files/placeholders")

    print(f"── QA {reel} opening {op} · {video.name}")
    for m in ok:
        print("  ✔ " + m)
    for m in warns:
        print("  ⚠ " + m)
    for m in fails:
        print("  ✖ " + m)
    if t and (final or len(t) <= 40):
        print("  TODO list:\n    " + "\n    ".join(t))
    if miss:
        print("  missing:\n    " + "\n    ".join(miss))
    report = rdir / "build" / f"{reel}_{op}.qa.json"
    report.write_text(json.dumps({"ok": ok, "warn": warns, "fail": fails, "todo": t, "missing": miss},
                                 ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  → {'FAIL' if fails else 'PASS'} ({len(ok)} ok, {len(warns)} warn, {len(fails)} fail)")
    return 1 if fails else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("reel")
    ap.add_argument("--opening")
    ap.add_argument("--final", action="store_true")
    a = ap.parse_args()
    raise SystemExit(check(a.reel, a.opening, a.final))


if __name__ == "__main__":
    main()
