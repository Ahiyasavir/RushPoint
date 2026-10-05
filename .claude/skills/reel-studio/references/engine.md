# The engine (`engine/`): timeline.json in, QA'd mp4 out

Python + ffmpeg + headless Edge. Work folder: `%USERPROFILE%\Desktop\RushPoint-reels-work\<reel>\`
(`clips/ voice/ proofs/ assets/ graphics/ build/ sfx/ timeline.json`); delivered files:
`%USERPROFILE%\Desktop\RushPoint-reels-out\<reel>\`. Run every command from `engine/` with
`PYTHONUTF8=1 PYTHONIOENCODING=utf-8`.

| Command | Does |
|---|---|
| `python setup_workspace.py <reel>` | new reel folder from `examples/_blank`, synthesised SFX |
| `python build.py <reel> --opening A` | render one opening, preview quality (iterate on THIS) |
| `python qa.py <reel> --opening A` | all checks, prints its denominators |
| `python variants.py <reel>` | all openings + covers + QA (once the edit is settled) |
| `python variants.py <reel> --final` | master quality, copies only QA-passing files to the out folder |
| `python test_captions.py` | Hebrew word order regression test for the caption engine |
| `lib/audio.prep_voice(src, dst, keep|segments, noise, tempo)` | his voice: profiled denoise, pause tightening, 1.12x, two pass loudnorm |
| `lib/music.make_music(...)` | called by build from `timeline.music`; styles `suspense`, `funk`, `synthwave` |
| `examples/reel3-ai/make_proofs.py` | phone screens (WhatsApp dark, Calendar, Docs, lock screen) via `lib/phone.py` |

Build pipeline: each shot → its own segment (normalised 1080x1920 CFR, exact frame count, its
overlays composited INSIDE it, optional dissolve from the previous shot's last frame) →
concat → optional `occlude` pass (text behind a person) → audio mixed in its OWN pass from a
sample exact PCM bed + SFX + voices + music (sidechain ducked under every voice) → final pass:
progress bar + ASS captions + mux.

## timeline.json reference

Top level: `id, title, source, rules[], shots[], captions[], overlays[], sfx[], voice{},
music{}, openings{}, cover{}, screens{}, proofs[], receipt{}, stair_labels{}, dissolve,
progress_bar, min_seconds, max_seconds, keep_clip_audio, shelved, todo[]`.

**shots[]** (must tile 0..end exactly, frame rounded):
`id, start, end` and ONE source: `clip` (+ `in`, `speed`) or `graphic` (a PNG, or `@screen`).
Options: `effect` (`none`, `slow_push`, `zoom_in` 1→1.2, `push_up`, `punch_land` + `punch_at`,
`flash_in`; NO punch zooms on graphics for Ahiya) · `freeze` (hold the frame at `in`) ·
`reverse` + `in_end` (rewind) · `crop [x,y,w,h]` (in the 1080x1920 frame, refused if outside)
· `blur [{x,y,w,h}]` or `[{shape:"circle", r, x,y, x1,y1, t1}]` (moving face blur) ·
`audio_gain` (keep the clip's own sound, cut sample exact) · `timer {x,y,w,h,dur,count}`
(draining bar + live seconds) · `cut: true` (no dissolve into this shot).

**captions[]**: `start, end, text | words [[w,s,e]], style (box = dark plate, big, sub), y,
size, max_words, color (static, no word highlight), accent_words []`. Lines are broken by the
engine in logical order (libass never wraps). Keep `y + size` above 1420.

**sfx[]**: `{at, file, gain}`; files under `voice/` count as voice (they key the music duck
and QA's voice continuity check). **voice{}**: `{file, at, gain}`.

**music{}**: `{style, bpm, gain (~-13..-15), energy [[t, 0..4]], accents [t], drops [[a,b]], seed}`.

**openings{A,B,C}**: `{cut, shots, captions, overlays, sfx}`, each replaces everything that
starts before `cut`. Overlays that must exist in the opening go INSIDE the opening.

Data sections expanded to overlays by `lib/graphics.expand`: `proofs[]` (phone card +
numbered label, slides in), `screens{}` (`type`: quiz, intro, pill, or a title screen with
`lines`), `receipt{}` (thermal slip, stamp), `stair_labels{}` (text written on steps, occluded
behind the person, needs an empty-plate PNG `assets_bg_plate.png`).

## Performance (this laptop, no GPU)
Segment render ~2 to 5 s per shot. A 30 s reel: ~1 min. The occlusion pass is per frame in
numpy: ~4 min for 22 s. `variants.py` = 3x. Iterate on A only.

## Landscape (16:9) mode, added 2026-10-04 for the classroom video of המירוץ לציון
`RP_FORMAT=landscape` before ANY engine command (build, qa, setup_workspace): `lib/common.py`
merges `config.json` → `landscape` over `video`, `captions`, `safe_zone` at import, so W/H
become 1920x1080 and captions sit bottom centre. Music style `procession` (walking toms,
lyre in an old mode) was made for it. Worked example with everything generated in code:
`RushPoint-reels-work/race-classroom/` → `make_timeline.py` (graphics + timeline from the
script, re-flows on measured take lengths in `measured.json`), `map/render_map.mjs`
(frame exact MapLibre animation in headless Chromium, MapTiler outdoor, Hebrew labels,
trails hidden), `screens/record_app.mjs` (records the REAL play-web on the emulator: two
Pixel 7 phones of one team, a Node driven GPS shim, CDP screencast) and
`screens/compose.py` (phones into 16:9 with bezel, blurred mission text, crisp score card).
