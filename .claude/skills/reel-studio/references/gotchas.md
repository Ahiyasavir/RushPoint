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

## 2026-10-05 (reels 14/15, race opening, carousel)
- **Portrait projects share `RushPoint-reels-work/_portrait.py`**: placeholders for takes (grey card,
  frame letter, the line; replaced when a real `clips/<id>.mp4` exists without `.placeholder`),
  silent voice stand-ins, and `phone_shot()` (a 412x838 app recording inside a phone, 9:16).
- **The engine's `timer` works only on GRAPHIC shots.** Reel 15 burns its countdown into the take
  with ffmpeg drawtext (`bake_timer` in reel15-bet/make_timeline.py), red under 10 s.
- **CDP screencast frames come back at CSS px (412 wide) even with maxWidth 1082**; page.screenshot
  gives 1082x2202. For a sharper phone, record by screenshot loop.
- **Canva generate-image returns only a 161x200 thumbnail; the signed URL 403s on resize.** A full
  size AI image needs an export from a Canva design, or a Gemini key in the toolkit.
- The devices panel (QR to add a phone) opens from the phone count chip
  ("…הטלפונים של הקבוצה"), then the "הטלפונים של הקבוצה" row must be expanded.
- **`acrossfade` between concatenated segments OVERLAPS them: each join shortens the audio by the
  fade length.** 12 joins x 60 ms = 0.7 s of voice ahead of the picture by the end of reel 15 v1
  ("דיליי בין הוידיאו לאודיו"). Concat audio plainly; make every segment frame exact (apad+atrim).
- **Jump cuts between clips of one tripod shot cannot be hidden by a small crop alternation** (he saw
  every one). Cover each join instead: a close framing of the speaker from the SAME moment (lip sync
  kept), an app insert, or a card; one continuous voice file under all of it (reel15-bet/make_timeline.py).
- **Founder clips begin with him walking in and end with him turning to the camera**: trim to the
  first word, and cover clip edges with the join inserts.

## 2026-10-13 (race opening, white background)
- **Mixed colour range tags turn white into 235 grey, from one shot on.** Segments built from a PNG
  loop (phone shots, cards) came out tagged `pc`, talking segments untagged; every file decoded to
  255 on its own, but after the first `pc` segment the final pass read the untagged ones as full
  range. `build.py` now ends every segment with `scale=out_range=tv:out_color_matrix=bt709` and
  tags every encode. Measure white in the FINAL file, per shot, not in the clips.
- **A halo behind a cut out must die within ~60 px**, or a cropped (closer) shot has grey corners.
- **`qa.py` opened overlay PNGs relative to the cwd** (crashed outside the work folder), fixed.
- Whisper on a long take drops whole retakes: see `lessons-2026-10-13.md` section 3.
- RVM matting is ~0.5 fps per worker on this laptop: cut first, matte only the kept spans, and tell
  him it is a 25 minute step.
- **A new QA check is itself tested on a file known to be good before it is trusted.** The white
  check failed all 22 shots twice on a white video: first it sampled where the chapter tag sits
  (y 300), then it would have been wrong again through ffmpeg's `format=gray`, which reads limited
  range white as 241. It now samples rgb24 at y 180..230, above the safe zone.
- `qa.py` seeks 3 frames per talking shot; on a 150 MB master that is ~2 minutes. Run QA on the
  preview build, and once more on the master.
