# Technical gotchas

The long list (34 entries: VFR phones, mediapipe Tasks API, libass Hebrew, zoompan
aspect, DeepFilterNet venv, RIFE silent failure, …) lives in
`~/.claude/toolkits/video-editing/README.md`. **Read it.** These are the ones found on
2026-10-01/02, each already fixed in `engine/`; they are listed so nobody "simplifies" the
fix away.

1. **`amix` beside a video graph drops audio inputs.** In one ffmpeg command with ASS +
   overlays, a voice input went to digital silence 3 s in, with no error. Audio is mixed in
   its own pass to a wav; every input is `apad`'ded to full length (amix also misbehaves as
   short inputs END).
2. **Concatenated AAC segments drift.** Each segment's encoder priming accumulates when the
   mix reads samples: ~0.5 s after 17 segments, lips visibly off. The audio bed is per segment
   PCM, cut to the exact frame count (`aresample=async=1:first_pts=0,apad,atrim=end_sample`).
3. **A single PNG frame held with `eof_action=repeat` is not reliably held**; `-itsoffset`
   windowed PNGs deadlock with several overlays; a full length loop decodes a PNG per frame.
   Overlays are composited inside each segment, looped only for that segment.
4. **`-ss` before `-i` lands audio late** against the picture on phone mp4s. A shot that
   keeps its sound is cut with `trim`/`atrim` inside the graph.
5. **ffmpeg clamps an out of frame `crop` silently** (his head cut off). `build.py` refuses it.
6. **overlay expressions use `W`/`H`, crop uses `iw`/`ih`.** Same text, different names.
7. **drawbox evaluates `w` once**, so a draining bar is a colour source slid by overlay `x`
   expression through a rounded track (`timer` in build.py).
8. **drawtext needs `fontfile=`** on this build (no fontconfig default): a bare drawtext
   segfaults. Use `C\:/Windows/Fonts/arial.ttf` or `fonts/...`.
9. **Brand fonts have no Hebrew** (Inter, Space Grotesk, JetBrains Mono). Hebrew falls back to
   Arial Bold, named explicitly (`hebrew_fallback`, captions `font`).
10. **libass wraps pre ordered (visual) Hebrew with the END on top.** The engine breaks lines
    in logical order itself; WrapStyle 2. Em ratio Arial Bold at \fs118 = 0.86.
11. **A `\b` or `\f` typed through Python string escaping becomes a control character** in
    the source and silently breaks the regex/override. Build ASS override strings with
    `chr(92)` or raw strings, then grep the file.
12. **Whisper word times ran ~0.5 s early.** Align to energy onsets (`scripts/ingest.py`).
13. **Background subtraction mask: use CHROMA, not brightness**, or his shadow is "him".
14. **`pip install` without pins broke cv2** (three OpenCV packages at once). Only
    `opencv-contrib-python` belongs here. After any install: `python -c "import numpy, cv2"`.
15. **`select='between(t,…)'` contact sheets can show the wrong frames.** Use `-ss` per frame
    when the exact moment matters.
16. **QA safe zone from the brief (200/250) is not the platform's.** Instagram covers below
    y 1420 and right of x 960 below y 850.

## 2026-10-04 (classroom video, 16:9)
- **Render speed:** segments used to render one after another at preset medium (~7 min for
  a 2 min video, 30 shots). Now: `RP_WORKERS` parallel segments (default cores/2), dissolves
  as a cheap second pass (prev segment's last frame faded over the first dz s), and preset
  `veryfast` for previews (`--final` keeps medium). Iterate on previews only.
- **The breath before every take** sits inside the first energy "speech" region, so
  ingest's energy aligned word shift puts the first word ON the breath. Find the real
  onset on the VOICE band (150 Hz..1.5 kHz) envelope, floor+20 dB or peak-26 dB for 3
  frames (`assemble.py onset()` in race-classroom). Measure every line's head and tail
  dB after prep; a tail louder than -40 dB = a clipped word, recut by the envelope.
- **Whisper word times can run backwards or past the line**: two caption words then draw
  at once (garbled line on screen). Clamp words into the spoken span, keep them ordered,
  min 0.12 s each, and assert no caption overlaps the next.
