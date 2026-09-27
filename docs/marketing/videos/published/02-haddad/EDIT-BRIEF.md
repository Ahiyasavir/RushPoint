# ריל 2 · יוסף חדאד — בריף עריכה מלא

**Hand this file to the session doing the edit. It is self contained.**
Read `02-haddad-loop.md` for the script and the reasoning; this file is the HOW.

---

## 0. Before anything

1. **Read `~/.claude/toolkits/video-editing/README.md` first.** Sixteen gotchas that each cost
   real time. The ones that bite hardest here are named below.
2. **Invoke the `video-script` skill** (`.claude/skills/video-script/`) if any wording changes.
   Its `scripts/check_script.py` must return 0 blocking on the final narration.
3. **Work in an ASCII path.** MediaPipe's Tasks API hard-aborts if the CWD contains non-ASCII
   characters. A Hebrew folder name is enough, and it is a native crash, not a Python exception.

## 1. What you are building

A **22.2 second self-closing loop**. Final: 1080x1920, 30fps CFR, H.264, AAC.

```
 0.00 —  3.67   [A] assets/A_open.mp4    חדאד: אוקיי, אז אני ממליץ עליה · אין עליך
 3.67 —  4.87   פנים   זה יוסף חדאד.
 5.17 —  8.77   פנים   עשר שניות לפני זה הוא לא ידע מי אני.
 9.07 — 11.47   פנים   ניגשתי אליו והראיתי לו אפליקציה שבניתי.
11.77 — 14.17   פנים   אני בן 17, ובניתי אותה לבד.
14.47 — 16.87   פנים   אני מעלה כל שלב בדרך. תעקבו.
17.17 — 22.24   [B] assets/B_close.mp4   חדאד: איזה אפליקציה עשיתה? + התשובה
                loops back into [A] on the identical frame
```

**The loop is the whole point.** `B_close` ends at source t=5.06 and `A_open` begins at source
t=5.06, so the rejoin lands on the same frame. **Measured seam: 8.2 / 255 mean pixel
difference.** Anything that moves either in/out point breaks it. Re-measure if you touch them.

## 2. Assets

| file | what |
|---|---|
| `assets/haddad-source.mp4` | 1080x1920, 9.73s, the full original |
| `assets/A_open.mp4` | 3.67s, source 5.06 to 8.70 |
| `assets/B_close.mp4` | 5.07s, source 0.00 to 5.06 |

The founder records the five narration lines on a **separate mic** while the phone films him.
Two files, one performance. Do not ask him to re-record to picture.

## 3. Workflow, in this order

**The order matters more than any single step.** The previous edit ran the face retouch four
times because every editing decision invalidated it. **Lock the cuts first. Retouch once, last.**

### 3.1 Sync

Cross-correlate the RMS envelope of the mic against the camera's own audio.
`~/.claude/toolkits/video-editing/audio_sync_xcorr.py` is the reference implementation.
**Check drift by thirds.** A flat offset, under 10ms of drift across the file, proves
simultaneous capture. A large or drifting offset means the audio was dubbed. In that case do
not force lip sync onto that shot, cut to the Haddad clip instead, and say so.

### 3.2 Choose takes, then verify them

He records several takes per line and says `אני עושה את זה עוד הפעם` between them.

- Compare candidates on **measured** energy in dB and pitch variance, not on impression.
- Find the true speech onset with an energy threshold, **then transcribe each chosen cut and
  read the text back.** A previous cut sliced into the word `יש` because he said it softly and
  it fell under the threshold. Only the transcription caught it.
- Whisper word END timestamps run early. Pad the out point or a final consonant dies. A 70ms
  fade at the cut boundary will eat the last syllable if you do not.

### 3.3 Two checks nothing else will catch

Run MediaPipe FaceLandmarker over the first ~15 frames of every chosen segment.

- **Head yaw.** Establish his baseline yaw while talking to camera, then flag any start
  deviating by more than about 0.055. Four segments once began mid head turn and he noticed
  every one.
- **Eye aperture.** `min(eyelid gap) / IPD < 0.055` is closed. One segment opened on a
  **15 frame, half second eye closure**, far too long to hide under a dissolve. Cover it with
  the Haddad clip or move the cut.

### 3.4 Assemble

- **Merge cuts that are contiguous in the source.** If line 2 begins exactly where line 1 ends,
  inserting a gap makes the video run forward and then **jump backward** to the same source
  point. That is precisely what "the cuts feel weird" meant.
- **Build the timeline on an integer frame grid** (toolkit gotcha 6). Cumulative boundaries as
  integers; each segment COUNT is `bounds[i+1] - bounds[i]`. Summing independently rounded
  durations drifts 50ms or more.
- **Speed**: he speaks slowly, 1.1x to 1.2x is right. Pick a small rational such as 6/5 and make
  the natural frame total a multiple of the denominator so `frames / speed` is exact (gotcha 7).
- **Cross-dissolve 6 frames at every cut**, centred on the join, and **alternate a gentle scale
  between adjacent segments** (1.00 / 1.065, cropped back to 1080x1920). The scale alternation
  does more work than the dissolve: it makes the cut read as intentional instead of as a jump.
- **Crop to the target aspect BEFORE any zoom** (gotcha 3), or the picture is squeezed and
  nothing but your own eye will catch it.

### 3.5 Audio

- **Lay a continuous room-tone bed under the whole track**, tiled with crossfades, taken from
  his own silence. Digital silence between beats makes the room noise vanish and return, and
  that pop is what reads as a rough cut. Speech fades into the bed over about 70ms.
- The Haddad clip keeps its original audio. Do not denoise it. The roughness reads as evidence.
- **Measure every level, never estimate** (gotcha 12). Voice around -16 LUFS integrated, final
  mix around -15. If you add music, render the bed alone and measure it: it belongs **8 to 12 dB
  under the voice**. A previous mix sat a bed at -48 LUFS against a -16 voice and threw no error.
- `sidechaincompress` needs its key duplicated with `asplit`; a labelled stream is consumed once
  (gotcha 13).

### 3.6 Retouch, once, here

He has a small red blemish on the bridge of the nose between the brows.

- Locate it **relative to face landmarks, not pixels**, so it tracks as he moves. Vote across
  several frames. The offset sits at roughly `u=+0.05, v=0.00` in IPD units from the nasion.
- Treatment: targeted redness suppression in Lab, pulling the local `a*` toward the surrounding
  median, **plus** a Poisson `seamlessClone` patch of clean skin from just above it, **plus** a
  light bilateral smooth at about 0.40 opacity **inside the face convex hull only**. Smoothing
  the whole frame is roughly ten times slower for no benefit.
- Detect on a **half resolution** copy. Landmarks are normalised, so they map straight back.
- Expect about 1.7 fps. Run it in the background and build the captions meanwhile.
- **Do not let MediaPipe touch the Haddad clip.** It will retouch Haddad's face too. Retouch the
  founder's segments only, then splice the clips in.

### 3.7 Captions

- **Render with PIL and `python-bidi`, not libass.** libass assumes an LTR paragraph base and
  flushes Hebrew sentence-final punctuation to the wrong side (gotcha 10). PIL reorders
  explicitly and is ground truth.
- Font: `~/.claude/toolkits/video-editing/fonts/Rubik.ttf`.
- **Full subtitle track, every word, including the hook.** Reels are watched muted; an
  uncaptioned line does not exist for most viewers. Plus two or three large emphasis cards, no
  more, or they stop being emphasis.
- Lay out RTL by reversing word order and calling `get_display` per word, then drawing left to
  right. Highlight the active word in amber `#FFB300`, the rest white, with a heavy dark outline
  and a soft dark halo so it survives the bright night footage.
- **Position**: measure his lowest chin across the video with MediaPipe and place the caption
  band below it. It once bottomed at 49.3%, so captions sat at 63%. Keep everything out of the
  bottom quarter where the Instagram UI sits.
- **Assert bounds**: fail the render if any drawn box crosses a frame edge.
- Caption timing follows **reading speed, not speaking speed**. Hold each line a beat past the
  audio.
- Never end a caption chunk on a weak function word (`עם`, `את`, `של`, `אתם`, `כאן`, `ממש`).

## 4. Verify before delivering

1. **Lip sync by audio-to-audio cross-correlation**, the camera's own mic against the final
   mixed track, RMS envelope (gotcha 14). Report the whole-file offset **and each quarter**.
   Target under 10ms with no drift. An optical mouth-aperture proxy is far less reliable.
2. **Exact frame count and duration** with `ffprobe -count_frames`.
3. **Re-measure the loop seam** if either Haddad clip moved. Under 15 / 255.
4. **Build a contact sheet** of 12 to 15 stills across the video and actually look at it:
   caption placement, card collisions, anything cropped.
5. **Transcribe the finished audio and read it.** It is the only check that catches a clipped
   word.

## 5. Traps that already cost hours

- **Never put a trailing ampersand inside a command you also launch in the background.** The
  wrapper exits, the child is orphaned, and two ffmpeg processes end up writing the same output.
  That produced a 123MB mp4 full of `Invalid NAL unit size`. If a probe reports corruption, hunt
  for a live orphan ffmpeg before blaming the encode.
- **`-vsync` was removed in ffmpeg 9.** Use `-fps_mode cfr` or `passthrough`.
- **Phone video is VFR even when `r_frame_rate` looks constant.** Normalise to CFR first, then
  do frame-accurate work (gotcha 5).
- **Do not pipe a long command through `head` or `tail` and trust the exit status.** You get the
  pager code. Redirect to a file, capture the code, then read the file.
- **`-shortest` can silently drop trailing frames.** Do frame-exact steps video-only with `-an`
  and mux real audio in a separate final pass (gotcha 8).
- **The Whisper language model overrides what it actually hears.** It will not reliably confirm a
  fine-grained audio edit. For anything at phoneme level, verify spectrally instead.

## 6. Delivery

Full quality into `docs/marketing/content-bank/`, plus a compressed copy. **File transfers over
roughly 15MB time out**, so make a 6 to 15MB version for the phone and keep the full one on disk.

Do not commit unless asked.
