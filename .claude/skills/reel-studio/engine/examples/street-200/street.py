# -*- coding: utf-8 -*-
"""Shared tools for the street-200 reels (2026-10-16): "200 shekels or a mystery mission".

Footage: Samsung booth takes (portrait 1080x1920, VFR) and WhatsApp copies of iPhone street takes
(portrait 576x1024, heavily compressed). Every reel here is built the reel15 way: an explicit cut
list -> frame exact segments -> ONE continuous voice file (field chain, rule 54) -> clips/take.mp4 +
voice/take.wav -> timeline.json for the engine.

    from street import assemble, faces_center
    assemble(RD, CUTS)      # CUTS = [dict(src, a, b, zoom=1.0, cx=None, cy=None, lines=[(who, text)])]

Joins inside one answer are covered by a framing change AT the join (rule 48): consecutive
segments of the same source alternate between the source framing and a closer one.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
ENGINE = Path(r"C:\Users\savir\Projects\Rushpoint\.claude\skills\reel-studio\engine")
sys.path.insert(0, str(ENGINE))
from lib.portrait import GRADE  # noqa: E402

W, H, FPS = 1080, 1920, 30
TOOLS = Path.home() / ".claude/toolkits/video-editing/tools"
DECLIP = "adeclip=window=55:overlap=75:arorder=8:threshold=10:hsize=1000"   # helped WA0009, neutral on WA0016
# rule 54 (field dialogue): DeepFilterNet capped, then level the quiet words, tame 3.3/6.5 kHz,
# de-ess, a gentle compressor, -19 LUFS. Applied once to the whole joined take.
FIELD_CHAIN = ("highpass=f=80:p=2,acompressor=threshold=-22dB:ratio=1.6:attack=20:release=200:knee=8:makeup=1.5,"
               "highshelf=f=5500:g=-2,deesser=i=0.5:m=0.6:f=0.45,alimiter=limit=0.89:attack=2:release=40:level=disabled,"
               "loudnorm=I=-19:TP=-1.5:LRA=7,aresample=48000")
# audio_bench2.py, 2026-10-16 (DNSMOS + timbre drift on WA0009 and WA0016): declip -> DeepFilterNet 32 ->
# this LIGHT chain won on both street sources (OVRL 2.39 -> 3.10, 2.25 -> 2.77) with the voice band within
# ~1 dB of the raw take. The older field chain (dynaudnorm, EQ cuts at 3.3/6.5 kHz, de-esser) scored the
# same but moved 4..6 kHz by -3.4 dB, i.e. "does not sound like us" (Ahiya asked that we still sound like ourselves).
# v2 (his note on 21: "צורם" in places): + a de-esser, audio_bench3.py: OVRL up (3.11->3.19), 2.5..5 kHz down ~2 dB.


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, **kw)


def probe_wh(src: Path) -> tuple[int, int]:
    """Displayed size (rotation applied)."""
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                        "stream=width,height:stream_side_data=rotation", "-of", "json", str(src)],
                       capture_output=True, text=True)
    s = json.loads(r.stdout)["streams"][0]
    w, h = s["width"], s["height"]
    rot = next((d.get("rotation") for d in s.get("side_data_list", []) if "rotation" in d), 0)
    return (h, w) if rot in (90, -90, 270, -270) else (w, h)


def detect_faces(det, img) -> list:
    """Face centres (0..1) in a BGR frame. The landmark model's detector is short range: a street
    face of 40 px in a 576 px frame is never found whole frame, so the frame is cut into overlapping
    square tiles (a third of the width), each upscaled, and hits are merged."""
    import cv2
    import mediapipe as mp
    h, w = img.shape[:2]
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    found = []
    for frac in (1.0, 0.5, 0.34):
        s = int(w * frac)
        step = max(s // 2, 1)
        for y0 in range(0, max(h - s, 0) + 1, step):
            for x0 in range(0, max(w - s, 0) + 1, step):
                tile = cv2.resize(np.ascontiguousarray(rgb[y0:y0 + s, x0:x0 + s]), (512, 512), interpolation=cv2.INTER_CUBIC)
                res = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=tile))
                for lm in res.face_landmarks:
                    px = np.array([[p.x, p.y] for p in lm]).mean(0)
                    cx, cy = (x0 + px[0] * s) / w, (y0 + px[1] * s) / h
                    if all(abs(cx - a) > 0.05 or abs(cy - b) > 0.03 for a, b in found):
                        found.append((cx, cy))
    return found


def _landmarker():
    from mediapipe.tasks import python as mpt
    from mediapipe.tasks.python import vision
    model = Path.home() / ".claude/toolkits/video-editing/face_landmarker.task"
    cwd = os.getcwd()
    os.chdir(model.parent)   # mediapipe and non ASCII paths
    det = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
        base_options=mpt.BaseOptions(model_asset_path=model.name), num_faces=4, min_face_detection_confidence=0.35))
    os.chdir(cwd)
    return det


def faces_center(src: Path, a: float, b: float, n: int = 6) -> tuple[float, float, float]:
    """Median centre (0..1) of all faces seen in n frames of [a, b], and the face spread width.
    Used to aim a closer framing at the people talking, not at the street."""
    import cv2
    import mediapipe as mp
    from mediapipe.tasks import python as mpt
    from mediapipe.tasks.python import vision
    det = _landmarker()
    xs, ys, spread = [], [], []
    for t in np.linspace(a + 0.1, b - 0.1, n):
        raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", str(src), "-frames:v", "1",
                              "-f", "image2pipe", "-vcodec", "png", "-"], capture_output=True).stdout
        img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            continue
        fx = detect_faces(det, img)
        if fx:
            fx = np.array(fx)
            xs.append(fx[:, 0].mean()); ys.append(fx[:, 1].mean())
            spread.append(fx[:, 0].max() - fx[:, 0].min())
    det.close()
    if not xs:
        return 0.5, 0.35, 0.0
    return float(np.median(xs)), float(np.median(ys)), float(np.median(spread))


def vf_for(src: Path, zoom: float, cx: float | None, cy: float | None) -> str:
    """Scale/crop to 1080x1920. zoom > 1 crops toward (cx, cy) (0..1), clamped inside the frame.
    Low resolution sources get a light denoise before the upscale so compression blocks do not grow."""
    w, h = probe_wh(src)
    cw, ch = w / zoom, h / zoom
    cx = 0.5 if cx is None else cx
    cy = 0.4 if cy is None else cy
    x = min(max(cx * w - cw / 2, 0), w - cw)
    y = min(max(cy * h - ch / 2, 0), h - ch)
    lowres = w < 900
    pre = "hqdn3d=1.5:1.5:4:4," if lowres else ""
    crop = f"crop={int(cw)//2*2}:{int(ch)//2*2}:{int(x)}:{int(y)}," if zoom > 1.001 else ""
    sharpen = ",unsharp=5:5:0.7:3:3:0.0" if lowres else ""
    return f"{pre}{crop}scale={W}:{H}:flags=lanczos,{GRADE}{sharpen},setsar=1,format=yuv420p"


def onset(src: Path, hint: float, look: float = 0.6) -> float:
    """First voice onset at/after hint-0.25 on the 150..1500 Hz envelope (no breath before a line)."""
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(src), "-vn", "-ac", "1", "-ar", "16000",
                          "-af", "highpass=f=150,lowpass=f=1500", "-f", "f32le", "-"], capture_output=True).stdout
    x = np.frombuffer(raw, np.float32)
    hop = 320
    db = 20 * np.log10(np.array([np.sqrt(np.mean(x[i:i + hop] ** 2)) + 1e-9 for i in range(0, len(x) - hop, hop)]))
    floor, peak = np.percentile(db, 10), np.percentile(db, 97)
    thr = max(floor + 16, peak - 28)
    i0 = max(int((hint - 0.25) / 0.02), 0)
    for i in range(i0, min(len(db) - 3, i0 + int(look / 0.02) + 13)):
        if db[i] > thr and db[i + 1] > thr and db[i + 2] > thr:
            return max(i * 0.02 - 0.05, 0)
    return hint


def split_long(cuts: list[dict], max_shot: float) -> list[dict]:
    """Rule 61 (something changes every ~3 s): a cut longer than max_shot is split at caption starts
    into sub cuts. Consecutive sub cuts of one source alternate wide/close in assemble(), so every
    split is a framing change AT a sentence boundary (rule 48), with continuous sound underneath."""
    out = []
    for c in cuts:
        if c.get("hit"):
            out.append(c); continue
        a, b = c["a"], c["b"]
        if b - a <= max_shot:
            out.append(c); continue
        starts = sorted({round(s0, 3) for _, _, s0, _ in c.get("caps") or [] if a + 1.2 < s0 < b - 1.2})
        marks, last = [], a
        for s0 in starts:
            if s0 - last >= 1.6 and (b - s0 >= 1.2):
                if s0 - last >= 2.2 or not marks:
                    marks.append(s0 - 0.04); last = s0
        bounds = [a] + marks + [b]
        for i, (x, y) in enumerate(zip(bounds[:-1], bounds[1:])):
            d = dict(c); d["a"], d["b"] = x, y
            d["caps"] = [cp for cp in c.get("caps") or [] if x - 0.05 <= cp[2] < y - 0.05]
            out.append(d)
    return out


_AIM = {}


def face_aim(src: Path, a: float, b: float) -> tuple[float, float]:
    """Where a closer framing should point: the median of the faces in the span, clamped so the crop
    keeps a little headroom. Cached on disk (face detection is slow)."""
    cache = HERE / "_aim.json"
    if not _AIM and cache.exists():
        _AIM.update(json.loads(cache.read_text(encoding="utf-8")))
    k = f"{src.name}|{a:.2f}|{b:.2f}"
    if k not in _AIM:
        cx, cy, _ = faces_center(src, a, b, n=3)
        _AIM[k] = [round(cx, 3), round(min(max(cy + 0.08, 0.3), 0.6), 3)]   # faces sit in the upper part of the crop
        cache.write_text(json.dumps(_AIM, indent=0), encoding="utf-8")
    return tuple(_AIM[k])


def _audio_piece(seg: Path, k: int, src: Path, a: float, b: float, tempo: float, n: int):
    """The voice of [a, b] in float with 8 dB of headroom (see below), exactly n samples, 12 ms fades."""
    import soundfile as sf
    wav = seg / f"a{k:02d}.wav"
    run(["ffmpeg", "-y", "-v", "error", "-ss", f"{max(a - 2.0, 0):.3f}", "-copyts", "-i", str(src), "-filter_complex",
         f"[0:a]aresample=48000,atrim=start={a:.4f}:end={b:.4f},asetpts=PTS-STARTPTS,volume=-8dB,"
         + (f"atempo={tempo:.4f}," if tempo != 1.0 else "")
         + f"apad,atrim=end_sample={n}[a]", "-map", "[a]", "-ac", "1", "-c:a", "pcm_f32le", str(wav)])
    x, _ = sf.read(str(wav), dtype="float32")
    x = np.pad(x, (0, max(n - len(x), 0)))[:n]
    f = int(0.012 * 48000)
    x[:f] *= np.linspace(0, 1, f); x[-f:] *= np.linspace(1, 0, f)
    return x


def assemble(RD: Path, cuts: list[dict], tempo: float = 1.0, alt_zoom: float = 1.3, denoise_db: float = 32,
             max_shot: float = 3.4):
    """cuts -> RD/clips/take.mp4 (silent picture), RD/voice/take.wav (the whole voice, field chain),
    RD/measured.json (segment starts) and RD/captions.json (lines spread by word count per segment).
    Each cut: src (name in raw/), a, b, optional zoom/cx/cy, optional lines [(who, text)] with who in
    A (Ahiya), K (Akiva), P (the person asked)."""
    seg = RD / "_seg"; seg.mkdir(parents=True, exist_ok=True)
    (RD / "clips").mkdir(exist_ok=True); (RD / "voice").mkdir(exist_ok=True)
    import hashlib
    import soundfile as sf
    for i, c in enumerate(cuts):
        c.setdefault("cut", i)
    cuts = split_long(cuts, max_shot)
    for c in cuts:   # aim every framing at the people, not the street (cached per span)
        if c.get("hit"):
            continue
        if c.get("cx") is None and not c.get("vsrc"):
            va = c.get("va", c["a"])
            c["cx"], c["cy"] = face_aim(RAW / c["src"], va, va + c["b"] - c["a"])
    outs, caps, t, prev_src, alt = [], [], 0.0, None, False
    pieces = []
    for k, c in enumerate(cuts):
        src = RAW / c["src"]
        if c.get("hit"):   # a reaction hit: frozen face, punch in, B&W (hits.py); the voice is silent under it
            import hits as HIT
            voiced = c.get("b") is not None and c.get("a") is not None and c["b"] > c["a"]   # a freeze the voice runs under
            d = round(((c["b"] - c["a"]) / tempo if voiced else c.get("dur", 0.9)) * FPS) / FPS
            face = c.get("face") or HIT.face_at(src, c["t"], c.get("hint_x"))
            c["face"] = face
            key = hashlib.sha1((f"hit|{src.name}|{c['t']}|{d}|{face}|{c.get('zoom', 3.4)}|{c.get('bw', True)}|v2" + (f"|{c.get('shake')}|{c.get('flash')}" if c.get('shake') or c.get('flash') else "")).encode()).hexdigest()[:12]
            out = seg / f"h{k:02d}_{key}.mp4"
            if not out.exists():
                HIT.render_hit(src, c["t"], out, dur=d, face=face, zoom=c.get("zoom", 3.4), bw=c.get("bw", True),
                               shake_px=c.get("shake", 10), flash=c.get("flash", 2))   # shake/flash: a celebrating end hits harder
            n = int(round(d * 48000))
            if voiced:
                pieces.append(_audio_piece(seg, k, src, c["a"], c["b"], tempo, n))
                for who, text, s0, e0 in c.get("caps") or []:
                    caps.append({"start": round(t + max(s0 - c["a"], 0) / tempo, 3), "end": round(t + min(e0 - c["a"], c["b"] - c["a"]) / tempo, 3),
                                 "text": text, "who": who})
            else:
                pieces.append(np.zeros(n, np.float32))
                c["a"] = c["b"] = c["t"]
            outs.append((out, d)); t += d
            prev_src = None
            continue
        a, b = c["a"], c["b"]
        alt = (not alt) if src == prev_src and not c.get("keep_framing") else False
        zoom = c.get("zoom", 1.0) * (alt_zoom if alt else 1.0)
        prev_src = src
        d = round((b - a) / tempo * FPS) / FPS
        n = int(round(d * 48000))
        va = c.get("va", a)   # picture may come from another moment of the same file (a reaction shot)
        vb = va + (b - a)
        vsrc = Path(c["vsrc"]) if c.get("vsrc") else src   # or from another file: an insert (library clip)
        if c.get("vsrc"):
            # an insert plays at the speed that fills the line (never faster than 1.6x), cover cropped to 9:16
            ilen = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(vsrc)],
                                        capture_output=True, text=True).stdout)
            need = d
            sp = min(max((ilen - va) / need, 0.5), 1.6) if ilen - va < need else 1.0
            vb = va + need * sp
            vf = (f"[0:v]fps={FPS},trim=start={va:.4f}:end={vb:.4f},setpts=(PTS-STARTPTS)/{sp:.4f},"
                  f"scale={W}:{H}:force_original_aspect_ratio=increase:flags=lanczos,crop={W}:{H},{GRADE},setsar=1,format=yuv420p,"
                  f"tpad=stop_mode=clone:stop_duration=2[v]")
        else:
            vf = f"[0:v]fps={FPS},trim=start={va:.4f}:end={vb:.4f},setpts=(PTS-STARTPTS)/{tempo},{vf_for(src, zoom, c.get('cx'), c.get('cy'))}[v]"
        if c.get("bw"):   # the sad summary: black and white, a touch of contrast and a vignette
            vf = vf[:-3] + ",hue=s=0,eq=contrast=1.12:brightness=-0.02,vignette=PI/5[v]"
        # picture: cached by everything that decides it, so a sound only change never re-renders video.
        # seek near the cut but keep the source's own timestamps (-copyts): trim cuts on exact source seconds
        key = hashlib.sha1(f"{vsrc}|{va}|{vb}|{tempo}|{vf}".encode()).hexdigest()[:12]
        out = seg / f"v{k:02d}_{key}.mp4"
        if not out.exists():
            run(["ffmpeg", "-y", "-v", "error", "-ss", f"{max(va - 2.0, 0):.3f}", "-copyts", "-i", str(vsrc), "-filter_complex", vf,
                 "-map", "[v]", "-frames:v", str(int(round(d * FPS))), "-c:v", "libx264", "-crf", "13", "-preset", "medium",
                 "-pix_fmt", "yuv420p", "-r", str(FPS), str(out)])
        # sound: FLOAT, with 8 dB of headroom. The street files carry overs up to +6.6 dB as a clean wave
        # (not flat topped); a 16 bit decode clips every one of them, which is most of the "bad mic" sound.
        wav = seg / f"a{k:02d}.wav"
        run(["ffmpeg", "-y", "-v", "error", "-ss", f"{max(a - 2.0, 0):.3f}", "-copyts", "-i", str(src), "-filter_complex",
             f"[0:a]aresample=48000,atrim=start={a:.4f}:end={b:.4f},asetpts=PTS-STARTPTS,volume=-8dB,"
             + (f"atempo={tempo:.4f}," if tempo != 1.0 else "")
             + f"apad,atrim=end_sample={n}[a]", "-map", "[a]", "-ac", "1", "-c:a", "pcm_f32le", str(wav)])
        x, _ = sf.read(str(wav), dtype="float32")
        x = np.pad(x, (0, max(n - len(x), 0)))[:n]
        f = int(0.012 * 48000)
        x[:f] *= np.linspace(0, 1, f); x[-f:] *= np.linspace(1, 0, f)
        pieces.append(x)
        for who, text, s0, e0 in c.get("caps") or []:   # source timed lines -> timeline time
            caps.append({"start": round(t + max(s0 - a, 0) / tempo, 3), "end": round(t + min(e0 - a, b - a) / tempo, 3),
                         "text": text, "who": who})
        outs.append((out, d)); t += d
    lst = seg / "concat.txt"
    lst.write_text("".join(f"file '{p.name}'" + chr(10) for p, _ in outs), encoding="utf-8")
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(RD / "clips" / "take.mp4")])
    raw = seg / "take_raw.wav"
    sf.write(str(raw), np.concatenate(pieces), 48000, subtype="FLOAT")
    total = sum(d for _, d in outs)
    voice_chain(raw, RD / "voice" / "take.wav", total, denoise_db)
    starts, acc = [], 0.0
    for _, d in outs:
        starts.append(round(acc, 3)); acc += d
    m = {"take_end": round(total, 3), "seg_start": starts, "tempo": tempo,
         "segs": [{"t": st_, "a": c["a"], "b": c["b"], "part": c.get("part"), "cut": c["cut"], "src": c["src"],
                   "hit": c.get("hit"), "sfx": c.get("sfx")}
                  for st_, c in zip(starts, cuts)]}
    (RD / "measured.json").write_text(json.dumps(m, indent=1), encoding="utf-8")
    (RD / "captions.json").write_text(json.dumps(caps, ensure_ascii=False, indent=1), encoding="utf-8")
    return m, caps


def voice_chain(raw: Path, dst: Path, total: float, denoise_db: float = 24):
    """The street voice: (declip) -> DeepFilterNet capped -> the field chain. Decided by audio_bench2.py."""
    seg = raw.parent
    src = raw
    if DECLIP:
        dc = seg / "take_declip.wav"
        run(["ffmpeg", "-y", "-v", "error", "-i", str(raw), "-af", DECLIP, "-c:a", "pcm_f32le", str(dc)])
        src = dc
    if denoise_db > 0:
        dn = seg / "take_dn.wav"
        run([sys.executable, str(TOOLS / "denoise_voice.py"), str(src), str(dn), str(denoise_db)], capture_output=True)
        src = dn
    run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-af", FIELD_CHAIN, "-t", f"{total:.4f}", "-c:a", "pcm_s24le", str(dst)])


def src_to_t(M: dict, src_t: float, src: str | None = None) -> float:
    """A source second -> timeline second, through whichever segment holds it."""
    for g in M["segs"]:
        if not g.get("hit") and (src is None or g["src"] == src) and g["a"] - 1e-6 <= src_t <= g["b"] + 1e-6:
            return round(g["t"] + (src_t - g["a"]) / M["tempo"], 3)
    raise ValueError(f"source second {src_t} is not in the cut")
