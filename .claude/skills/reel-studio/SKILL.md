---
name: reel-studio
description: Make and edit RushPoint short videos (Reels / TikTok / Shorts) end to end, physically: concept check, script, shot list, ingesting his phone footage and voice memos, cutting, Hebrew captions, music, phone screen mockups, QA, delivery to docs/marketing and the post caption. Use for ANY video task: "תערוך", "ריל", "סרטון", new footage or recordings arriving, a caption for a video, re-editing a draft, or judging whether an idea will work. Wraps the video-script skill (words) and the ~/.claude/toolkits/video-editing toolkit (talking head tools).
---

# Reel studio: from idea to a QA'd, delivered reel

Ahiya (17, RushPoint founder) films on his phone and judges every cut on his phone. He
answers in Hebrew, wants short Hebrew status updates, and gives blunt feedback. This skill is
everything learned from ~10 reels and two long edit sessions. **It does the work; it is not a
reading list.** But step 0 is not optional: every mistake in `references/lessons-2026-10-02.md`
happened because something already written was not read.

## Step 0 · Read before the first command (every time)

1. `references/founder-rules.md`: his standing rules (55). They outrank any brief.
2. `references/lessons-2026-10-13.md` (newest: white background, the voice chain that keeps his timbre, three pass ingest), `lessons-2026-10-05.md` and `lessons-2026-10-02.md`: what went wrong and the fix.
3. `references/pre-delivery-checklist.md`: the zero notes checklist. **Every cut passes it before it is sent.**
4. `references/kill-criteria.md`: the six question test.
5. `references/gotchas.md` + `~/.claude/toolkits/video-editing/README.md` (the long list).
6. For words (script, hook, caption): the `video-script` skill, `.claude/skills/video-script/`.

## Step 1 · Concept gate (before ANY editing)

Run the six questions in `kill-criteria.md` on the idea or script. Under 4 of 6: do not
start a timeline. Tell him in Hebrew, three options (drop / reshoot with a shot list / one
specific fix), recommend one. A brief relayed by another session (אודי) gets the same test.

## Step 2 · Research, then script and shot list

**Research first** (founder rule 49): a few web searches for hot topics he can tie to the app, and
what is working in reels right now; then propose one short (~15 to 25 s) and one long (~60 s) idea.
Hooks proven for him: "אל תדלגו על זה" and a stake with a live timer. Describe the app plainly
(rule 50), no dates (36), neutral facts first (37), spoken Hebrew (42). A dialogue leaves the other
person a beat every two or three lines. When he asks for a shoot plan, deliver a PDF: sections by
LOCATION, every shot a separate take with its frame (A half body, B close, C angle, D phone to lens,
V voice over a screen), and a "what I need from you" list.

Use the `video-script` skill (structure by name, hook last, beats with timecodes, ROLL,
CAPTION, RISK). Write the shot list as what he can film on a phone in one afternoon. Ask him
for his OWN photos and clips of real things (he has rappelling, robotics, FIRST, park
workouts); stock only with his OK; never icons for real things.

## Step 3 · Ingest what he sends, READ the transcript, then cut

Field clips carry side talk (mic setup, English, chatter after the take), walk ins and head turns at
both ends. The transcript is the cut list: keep from the first scripted word to the last scripted
word, nothing else (rules 34, 48).

**He improvises and repeats shots inside one long take, and a whole file transcription drops entire
retakes.** For any take longer than ~15 s, or when he says he repeated or improvised, run the three
passes of `engine/examples/race-opening/` (`par_ingest.py`, `phrases.py`, `gaps.py`), write the cut
list explicitly (`CUTS`), and **transcribe every cut line back** (`assemble.py --check`) before any
picture work. Captions are what he said. Copy only the files he named, never `*.mp4` from his folder.

```bash
cd .claude/skills/reel-studio
PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python scripts/ingest.py "<folder>" --out "<scratch>/ingest"
```
It probes every file (VFR flag), writes a 12 frame timestamped contact sheet per video,
finds speech by energy and transcribes with word times aligned to the real onset.
**Look at every sheet** (Read the jpg), tag each file to its shot, then COPY (never move,
never rename the originals) into `RushPoint-reels-work/<reel>/clips/` under the timeline's
names. For a precise moment (a landing, a door opening) extract single frames with
`ffmpeg -ss t` and look again. Talking head with separate recorder audio: the toolkit's
`reel-pipeline/sync.py` and `headpose.py` (pick takes by head tilt, he asked).

## Step 4 · Voice

```python
from lib.audio import prep_voice   # run from engine/
prep_voice(raw, dst, segments=[(a,b), ...], noise=(silence_a, silence_b), tempo=1.12)
```
Segments come from `ingest.json` speech regions (pad 0.04 before, 0.07 after; never clip a
final stop consonant). One file per narration line, so each line can sit on its own shot.
If he flubbed a line and redid it, use the retake. Captions = what he SAID.

**His clean lav takes need almost nothing.** The measured chain is high pass 80, one 1.6:1
compressor, a -2 dB shelf at 5.5 kHz, a limiter (`RP_VOICE_CHAIN` in
`examples/race-opening/assemble.py`): under 1 dB of timbre drift, where the heavier chains moved his
voice by up to 11 dB ("does not sound like me"). Enhancers only for noisy field audio. Check a new
chain with `bench13b.py` before using it. You cannot hear the result: say so when you send.

## Step 5 · Build the timeline in code

Start from a worked example, never from nothing: `engine/examples/reel14-monologue/` (his takes +
headline cards over stock + app screens + a loop), `engine/examples/reel15-dialogue/` (13 field
clips → one take, joins covered by framing changes AT the join and app inserts, one continuous voice
file, a live timer) or `engine/examples/race-opening/` (a long instruction film: 31 lines from 13
takes, **pure white background** behind him, every shot cut on his eyes with the voice finishing
under the next one, lower third titles, app recordings on white, a RushPoint outro).

**Where a talking shot ends is decided by his EYES, not by the sound** (rule 56, the note he gave on
every shot of reel 16 v1). Run `tails.py`, mute the talking clips, lay each line's voice as its own
file, never make a shot longer than its clip, cut hard. **A background he asks for** (white, a colour)
is `lib/whitebg.py`: look at a frame of every take first, run ONE shot to the final file and measure
it, then start the 25 minute batch. Shared 9:16 helpers are `engine/lib/portrait.py`: `GRADE` (apply it to flat
takes and stock, rule 46), `phone_shot()` (big centred phone), `placeholder()`, `png()` (cached).

`python setup_workspace.py <reel>` (from `engine/`), then write `timeline.json` from a
small Python script that computes every time from measured values (landings, speech
regions, durations), never by hand. Schema: `references/engine.md`. Decide up front:
- **music style**, not used by any other reel in the work folder (QA fails a repeat);
- **where text sits**: inside y 250..1420, left of x 960 below y 850;
- **voice drives timing**: each shot is at least its line + 0.25 s. (Not for his own talking shots:
  those end on his eyes, see above.)
- **energy**: a video watched on a phone gets hard cuts, no air between lines and an upbeat bed, also
  when it explains rules (rule 57). Dissolves and a calm bed are for a classroom projector.

## Step 6 · Iterate on opening A only

```bash
cd engine && PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python build.py <reel> --opening A && python qa.py <reel> --opening A
```
Then LOOK, the way a viewer does, before he does:
```bash
T=~/.claude/toolkits/video-editing/tools
python $T/phone_preview.py build/<reel>_A.mp4 <scratch>/preview.jpg 8   # frames with the IG/TikTok UI drawn on
python $T/muted_watch.py   build/<reel>_A.mp4                          # stretches with nothing new, sound OFF
```
Read the preview jpg. Nothing readable may touch a zone. Then extract 6 to 10 frames at the
moments that matter (`ffmpeg -ss t -frames:v 1`), read them, and measure what QA cannot see.
Tile the LAST frame of every talking shot into one sheet and look at it: this is where v1 of reel 16
failed, and no number caught all of it.
**A cut with any ✖ in QA is never sent** (rule 55). Walk `pre-delivery-checklist.md`. Only then send it to him
(`SendUserFile`, display render) with a short Hebrew note: what changed, what is open.
Every piece of feedback that is a RULE (not a one off) goes into `founder-rules.md` and
the `feedback-reel-edit-rules` memory in the same turn. A bug class that reached him gets a
`qa.py` check in the same turn.

## Step 7 · Finish

```bash
python variants.py <reel> --final     # B and C openings, covers, master quality, only passing files delivered
```
Then `references/deliverables.md`: folder `docs/marketing/videos/drafts/<NN>-<slug>/`,
`-v1`, `-v1-small`, `-v1-open-b/c`, `-v1-cover.png`, README with the five headings and
`## כיתוב לפוסט`, index table, `npx tsx scripts/test-marketing-structure.ts` green.
Caption: `video-script` skill, one for all platforms, 5 hashtags incl. `#RushPoint` and
`#רשפוינט` (never #הנוערשלישראל: that partnership ended). Nothing is sent or posted without his
explicit OK. Files go to him in the chat; text for WhatsApp goes to the אודי session, which posts in
the group "תוכן" (it cannot open files on this machine).

## Step 8 · Close the loop

Before saying "done": add any new gotcha to `references/gotchas.md`, any new rule to
`founder-rules.md`, any shelved idea's post mortem to `kill-criteria.md`, and update the
`reels-edit-pipeline-2026-10-01` memory. The next session should not relearn anything.

## What the engine can do (so you reach for it instead of rebuilding)

Hebrew word by word captions (RTL correct, boxed or outlined, amber active word) ·
a person cut out on a pure white background (`lib/whitebg.py`) · shots cut on the eyes with an L cut
(`examples/race-opening/tails.py`) · a RushPoint end animation (`outro()` there) ·
phone screens in his style (WhatsApp dark, Calendar, Docs, lock screen) with blurred names ·
quiz screens with a live countdown, progress dots, answer reveal · title cards with a follow
pill or a comment arrow · receipt slips with a slamming stamp · text written behind a
person (occlusion against an empty plate) · moving circular face blur · crop, freeze, rewind,
slow push, zoom in, dissolves, progress bar · voice prep (profiled denoise, pause trim,
1.12x, two pass loudness) · eight synthesised music styles with sidechain ducking (the newest,
`kickoff`, is the upbeat one) · SFX
(land, ding, whoosh, pop, hit, riser, tick, register, close, type, buzz, print) · QA:
format, length, pace, safe zone, platform UI zone, dashes, loop, TODOs, music presence and
uniqueness, voice continuity, lip sync, frozen last frames, eyes at the cut, measured white.

## Installed tools (verify before installing anything)
ffmpeg 9 full (libass, fribidi, harfbuzz, xfade, sidechaincompress) · Python 3.11 with
numpy, scipy, Pillow, soundfile, python-bidi, fonttools, faster-whisper (models cached:
`ivrit-ai/whisper-large-v3-turbo-ct2`), opencv-contrib-python (ONLY this OpenCV),
mediapipe 1.0 (Tasks API only; `face_landmarker.task` in the toolkit; chdir to an ASCII
folder first) · Edge headless for HTML → PNG · the toolkit's binaries (Real-ESRGAN, RIFE) and
DeepFilterNet in its own venv. **Pin versions; after any pip install run
`python -c "import numpy, cv2"`.**
