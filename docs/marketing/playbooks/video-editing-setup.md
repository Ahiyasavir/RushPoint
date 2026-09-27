# Video editing toolkit — setup instructions for a fresh agent/machine

Written 2026-09-15 after cutting the "פוסט-מורטם 4 בבוקר" devlog reel (talking head +
b-roll + burned Hebrew captions + synthesized music, 1080x1920, loop-safe).

This is a **bootstrap guide**: hand it to another Claude account, a new machine, or a
future session, and it gets the same capability without rediscovering the same bugs.
The working scripts from that edit live outside the repo at
`~/.claude/toolkits/video-editing/` on the original machine — this document is what
lets you rebuild them from nothing.

---

## 1. FFmpeg (the actual engine — everything else is orchestration)

Check what you already have before installing:

```bash
ffmpeg -version
ffmpeg -hide_banner -filters | grep -E "xfade|sidechaincompress|zoompan|loudnorm|subtitles|gblur|vidstab"
```

You need a **full build** (gyan.dev "full", BtbN, or a distro build with `--enable-libass
--enable-libfreetype --enable-libfribidi --enable-libharfbuzz`). Confirm those four are in
the `configuration:` line — without libass+fribidi, burned Hebrew subtitles will not shape
or order correctly.

Install if missing:
- Windows: `winget install Gyan.FFmpeg` (the *full* package, not `-essentials`)
- macOS: `brew install ffmpeg`
- Debian/Ubuntu: `sudo apt install ffmpeg` (verify libass is in the config line; if not,
  use a static build from johnvansickle.com)

What this build gives you, which most guides assume you need a NLE for:
- `xfade` — 58 named transitions plus a `custom` mode taking an arbitrary pixel
  expression, i.e. a full transition pack
- `sidechaincompress` — duck a music bed under a voice track automatically
- `loudnorm` — EBU R128 two-pass loudness normalization (target -14 LUFS for social)
- `subtitles` / `ass` — burn styled subtitles, with RTL shaping via fribidi
- `zoompan` — Ken Burns / slow push
- `vidstabdetect` + `vidstabtransform` — two-pass stabilization for handheld footage
- `lut3d`, `curves`, `eq`, `colorbalance` — grading, including real `.cube` LUTs
- `atempo` — pitch-preserving speed change

Note: `-vsync` was **removed in ffmpeg 9**. Use `-fps_mode cfr` / `-fps_mode passthrough`.
Old scripts fail with "Option not found" and, under `-y` in a batch loop with no exit-code
check, do so silently.

---

## 2. Python packages

```bash
pip install opencv-contrib-python mediapipe moviepy pillow \
            librosa soundfile pydub noisereduce webrtcvad \
            scenedetect rembg ffmpeg-python \
            python-bidi arabic-reshaper fonttools \
            faster-whisper
```

What each is actually for:

| Package | Used for |
|---|---|
| `opencv-contrib-python` | frame I/O, `seamlessClone` (Poisson blending = healing brush), filtering |
| `mediapipe` | face landmark tracking — retouching, lip-sync measurement, framing checks |
| `librosa` + `soundfile` | audio envelopes, cross-correlation sync, spectral analysis |
| `pydub`, `noisereduce`, `webrtcvad` | silence detection, denoise, voice activity |
| `scenedetect` | automatic cut detection in raw footage |
| `python-bidi` + `fonttools` | Hebrew RTL reordering for PIL, and glyph-coverage checks |
| `faster-whisper` | transcription **with word-level timestamps** → caption timing |
| `rembg` | background removal (needs `onnxruntime`, pulled automatically) |
| `moviepy` | convenience wrapper; mostly unused — raw ffmpeg calls were clearer and faster |

Version conflicts to expect: `rembg` pulls a newer `pillow` than `moviepy` pins. It works
anyway — verify with `python -c "from moviepy import VideoFileClip"` rather than trusting
pip's warning.

---

## 3. Models and fonts (download once, reuse forever)

**MediaPipe face landmarker** (Google, Apache-2.0):
```bash
curl -L -o face_landmarker.task \
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
```

**Hebrew + Latin variable fonts** (Google Fonts, OFL):
```bash
curl -L -o Rubik.ttf "https://github.com/google/fonts/raw/main/ofl/rubik/Rubik%5Bwght%5D.ttf"
curl -L -o Heebo.ttf "https://github.com/google/fonts/raw/main/ofl/heebo/Heebo%5Bwght%5D.ttf"
```

**Hebrew Whisper model** — `faster-whisper` downloads on first use. Use
`ivrit-ai/whisper-large-v3-turbo-ct2`, which is dramatically better on Hebrew than the
generic multilingual models:
```python
from faster_whisper import WhisperModel
m = WhisperModel("ivrit-ai/whisper-large-v3-turbo-ct2", device="cpu", compute_type="int8")
segments, info = m.transcribe(path, language="he", word_timestamps=True, vad_filter=False)
```

Set `PYTHONUTF8=1` on Windows for any script touching Hebrew filenames or text.

---

## 4. Gotchas that cost hours — read before writing code

1. **MediaPipe hard-aborts if the current working directory contains non-ASCII characters.**
   Error is `Check failed: os_helper->IsDirectoryAccessible ... srcdir "????"`, a native
   crash, not a Python exception. A Hebrew folder name is enough. `os.chdir()` to an ASCII
   directory before constructing any `FaceLandmarker`, even when every file path you pass
   is absolute.

2. **`mediapipe.solutions` no longer exists** (removed in 1.0.x). Only the Tasks API
   remains: `mediapipe.tasks.python.vision.FaceLandmarker.create_from_options(...)` with a
   `.task` model file, then `detect_for_video(mp_image, timestamp_ms)` where you track the
   timestamp yourself.

3. **`zoompan` silently changes aspect ratio.** Handing it a 3:4 source and asking for a
   9:16 output stretches the entire picture instead of framing it — people come out 25%
   too narrow. Always `scale=...:force_original_aspect_ratio=increase,crop=W:H` to the
   target aspect **before** any zoompan. No automated check catches this; only your eye does.

4. **Phone video is VFR even when `r_frame_rate` looks constant.** Diff the actual frame
   timestamps (`ffprobe -show_entries frame=pts_time`); a 30fps clip typically has one
   150–200ms stall. Per-frame processing on the raw file, re-muxed at a fixed rate, drifts
   picture against sound by 100ms+. Normalize first: `-vf fps=30 -r 30 -fps_mode cfr`.

5. **Never sum independently-rounded shot durations.** Build the timeline as integer frame
   boundaries and derive each shot's length as `bounds[i+1] - bounds[i]`. Rounding 17 shots
   separately drifted the total by 50ms — enough to break lip sync at the end.

6. **A speed change must land on an integer frame count on both sides.** Choose a small
   rational (9/8 = 1.125) and make the pre-speed frame total a multiple of the denominator,
   so `frames / speed` is exact. Verify with `ffprobe -count_frames`, not by trusting `-t`.

7. **`-shortest` can silently drop trailing video frames** when muxing a piped raw-video
   stream against separate audio. If a step must produce an exact frame count, run it
   video-only (`-an`, no `-shortest`) and mux audio in the final pass.

8. **Filtergraph deadlock:** shifting a short looped-image input forward with
   `setpts=PTS+N/TB` to schedule an overlay later hangs ffmpeg at ~0% CPU — it looks like a
   slow render but is frozen. `overlay` blocks waiting for a second-input frame that
   doesn't exist yet at its own PTS 0. Fix: feed the overlay input at **full length from
   t=0** and control visibility with `fade=t=in:st=<when>:alpha=1`. Diagnose any long
   render by sampling CPU time twice — flat CPU means deadlock, not slowness.

9. **libass assumes an LTR paragraph base.** A Hebrew caption ending in a comma or ellipsis
   renders that punctuation on the visual **right** (English-style) unless the line is
   wrapped in `U+202B ... U+202C`. PIL + `python-bidi`'s `get_display()` does **not** have
   this problem, so use a PIL render of the same string as ground truth when checking.

10. **A glyph missing from both your text font and your emoji font renders as nothing
    obvious.** `➔` (U+2794) is in neither Rubik nor Segoe UI Emoji. Check coverage with
    `fontTools` cmaps and raise loudly rather than shipping invisible boxes.

11. **Measure the music bed, never guess its level.** `volume=-15dB` into a
    `sidechaincompress` produced a bed at **-48 LUFS against a -16 LUFS voice** — 32dB down,
    inaudible, and completely error-free. Render the ducked bed alone to a temp file and run
    `loudnorm ... print_format=json` on it. Aim 8–12dB under the voice.

12. **`sidechaincompress` needs `asplit`.** An ffmpeg labeled stream can only be consumed
    once; feeding the voice to both the sidechain key and the final `amix` requires
    `asplit=2[v1][v2]` first.

13. **Verify lip sync with audio-vs-audio cross-correlation**, comparing the camera's own
    mic track against the final mix (RMS envelope, FFT correlation). A mouth-aperture
    landmark proxy is far noisier (r ≈ 0.2–0.5 even when correct, vs 0.6–0.8 for
    audio-audio) and, if you compact the array to skip frames where detection dropped
    instead of interpolating on a fixed grid, it invents a lag that isn't there.

14. **Check whether external audio and camera audio captured the same performance before
    assuming they can be synced.** A flat offset (drift < 10ms over 10+ seconds) means
    simultaneous capture and lip sync is achievable. A large offset, or word *durations*
    that differ between the two, means separately-recorded audio — don't force it, cut to
    b-roll over that line instead.

---

## 5. Process checklist before the first full-quality render

Each of these cost an extra render cycle on the devlog reel. Two minutes on a low-res
preview catches all three:

1. Extract one frame per b-roll shot at the delivery aspect ratio and look for stretching
   (gotcha #3).
2. Confirm the opening two seconds contain visible motion, not a near-still frame with
   only a caption moving.
3. If the brief says "loop": read the last spoken line and the first spoken line back to
   back as text. If they form a continuous sentence, nothing — no title card, no hard beat —
   may be inserted between them.

---

## 6. Reference render settings that worked

```
1080x1920, 30fps CFR, H.264 high@4.1, yuv420p, +faststart
master:   -preset medium -crf 16   (~1.4 MB/s)
delivery: -preset medium -crf 21   (~0.7 MB/s, stays under a 30MB share limit for ~30s)
audio:    AAC 192k 48kHz stereo, normalized to -14 LUFS / -1.0 dBTP
```

Burn subtitles **last** in the filter chain so they sit above every overlay. Reference the
`.ass` file by a **relative** path from an ASCII working directory — the `subtitles` filter
parses its argument through two escaping layers, and a Windows drive colon plus a
non-ASCII folder name is not worth fighting.
