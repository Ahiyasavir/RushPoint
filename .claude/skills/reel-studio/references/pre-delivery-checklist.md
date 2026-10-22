# Pre-delivery checklist: the reel must reach him with zero notes

Run this, in order, before EVERY SendUserFile of a cut. Each line is a note he has actually given.
If a line fails, fix it and rebuild; do not send "with known issues" unless he asked for a rough cut.

## 1. Machine checks (must PASS, no exceptions)
- [ ] `python qa.py <reel> --opening A` → **PASS**. Read every ⚠ too: pace and loop warnings are
      fine only when the format explains them (a dialogue, a non looping reel).
- [ ] `check_script.py` on the script: 0 blocking; every "sentence opens with ו", "כבר" and date
      warning resolved.

## 2. Watch it the way he does (frames, then muted, then with sound)
Extract frames at: 0.2 s, every cut ±0.1 s, every insert, the last second. Then:
- [ ] **First second**: a person or a stake big in frame, the hook text readable, a hit on the first
      frame, music already playing (rules 15, 33).
- [ ] **Every cut**: no visible jump. Same clip + same framing across a cut = a jump; cover it.
- [ ] **The LAST frame of every talking shot** (tile them all into one sheet and look, do not trust the
      detector): he is still looking into the lens, eyes open, not frozen. He looks to the laptop on
      the last word of every take. `qa.py` "frozen tails" and "eyes at the cut" must be ✔ (rule 56).
- [ ] **No walk ins, no head turns to the camera, no off script words** at clip edges (read the
      transcript of the kept span).
- [ ] **Every reaction freeze is on the right face**: `examples/street-200/hit_sheet.py <reel>` and read the
      sheet. The detector freezes on whoever stands in front; set `face=(x, y)` by eye when it is wrong.
- [ ] **Whose face is on screen while who speaks**: when the camera shows someone other than the
      speaker, a label says who is who (rule 82), or the viewer takes the face for the voice.
- [ ] **Every insert shows THIS event**: no other race's route, place or people (rule 80).
- [ ] **Captions**: 84 px, under the speaker's face, never touching a phone, never below y 1420, the
      text = what was SAID, no dashes, no sentence initial ו.
- [ ] **Phone mockups**: big, centred, mission text blurred.
- [ ] **Colour**: not flat (GRADE applied to takes and stock).
- [ ] **A white (or any flat) background**: measured in the FINAL file, in every shot, not in the clips
      (`"white_background": true` → `qa.py`). No grey corners on the cropped shots.
- [ ] **Titles on close shots**: nothing sits on his chin or mouth. Lower third over the chest.
      `qa.py` fails a title, label or stamp over a face (`faces`); a label beside his head fits only
      on the WIDE framing (reel 17: "RushPoint" on his forehead, "בחינם" on his mouth).
- [ ] **The hero object is clear of the platform UI**, not only the text: the phone being pressed,
      the button, a stamp (`phone_preview.py`; reel 17 v1 had the phone under the like column).
- [ ] **Behind him: his real room, tidied** (`clean_room_rvm`), unless he asked for white or a colour.
      Every take of him has the light retouch (`retouch=True`).
- [ ] **No logo. No dates.**
- [ ] **Last frame**: ends on the last scripted line, nothing after; if it loops, first and last
      shots in the same place and framing.
- [ ] **The ending is the loudest real moment, and sounds like it means it**: no sarcastic, polite or
      off topic closing line (rule 81). Picture and sound celebrate it (riser, colour freeze, headline, sfx).
- [ ] **Read every kept line as a stranger hears it once**: no word that reads as pressure or crime even
      as a joke (rule 79; `qa.py` fails the known ones). Cut the clause, never reword him.

## 3. Listen
- [ ] Voice: not harsh, not fast (1.12 monologue, ~1.03 dialogue), every word audible, no breath or
      false start before a line, no audio ahead of the lips.
- [ ] **Every cut line transcribed back** (`assemble.py --check`): the text matches, the tail is under
      -40 dB (a louder tail = a clipped word), no attempt that breaks off ("את ה...").
- [ ] **The voice chain keeps his timbre**: under ~2.5 dB drift per third octave against the raw take
      (`bench13b.py`). A clean lav take gets the minimal chain, no enhancer.
- [ ] I cannot hear the file. The message says so and names what waits for his ear.
- [ ] Background noise tamed but natural (DeepFilterNet ≤ 12 dB).
- [ ] Music: present from 0, loud enough (~-8.5 for a promo, he asked for "more present"), warm, ducks
      under speech, unique style for this reel.
- [ ] **Loudness**: -14 LUFS, true peak under -1 dBTP (`build` masters it, `qa.py` checks `loudness`).
- [ ] **No phrase said twice** in one cut line (he restarts a bad opening and says it again).
- [ ] Sound effects only where they mean something (the hook hit, a timer tick, a reveal).

## 4. Content and safety
- [ ] Nothing invented: every number, quote and claim is true or was given by him.
- [ ] A minor on camera other than him → a parent's written consent noted in the README "פתוח".
- [ ] No boy/girl physical contact in generated images unless he approved it.
- [ ] Stock and images: license recorded next to the files.
- [ ] **The library was checked before stock or a reshoot was used**, and the new footage of this
      video went through a library pass (non talking, reusable moments added with start and end).

## 5. The message that goes with it
- [ ] Hebrew, short: what changed per note (numbered like his notes), what is still open.
- [ ] Energy matches the screen it plays on: a phone video gets hard cuts and an upbeat bed even when
      it is an instruction video (rule 57). Calm dissolves are for a classroom projector only.
- [ ] The file renders in the chat (`display: render`); the caption, if asked, ends with exactly 5
      hashtags including #RushPoint and #רשפוינט, and no ex partners' tags.
- [ ] The caption was written from THIS version and quotes only lines that are still in it.
- [ ] Several reels: each one is sent as soon as its own chain passes, not held for the batch.

## 5. Sending
- [ ] To his phone: a copy under 30 MiB (`engine/phone_copy.py`), the master stays on the laptop.
