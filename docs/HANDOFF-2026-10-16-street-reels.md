# Handoff: the street-200 reels (18 to 22), 2026-10-16

**Read this first, then the `reel-studio` skill (step 0), then `references/lessons-2026-10-16.md`.**
Ahiya filmed street interviews ("200 שקל או משימה מסתורית?") and a RushPoint Live booth in the market
on 15.10. Five reels were cut from it in one session; v1 got his notes, v2 answers them. Your job: take
his notes on v2 and make the last fixes (v3, v4...), then the final delivery.

## Status (16.10, 15:10)
- **v2 of all five built, QA PASS** (0 fail; the only warnings are pace 1 to 3 shots just over 3 s, and the
  loop frame difference, which is expected for interviews). Files: `drafts/<NN-slug>/<NN-slug>-v2.mp4`,
  `-v2-small.mp4` (under 15 MB, the one to send), `-v2-cover.png`. v1 files stay beside them.
- **All five v2 sent to him** (20 + 18 at 15:08, 19 + 21 + 22 at 15:18). Waiting for his notes.
  `test-marketing-structure.ts`: 403 passed. Nothing committed.
- Checked by eye on v2: a 16 frame sheet per reel plus a frame from EVERY hit freeze. Two freezes were aimed
  wrong and are fixed in v2 (the README and this file call it v2; the earlier render was never sent):
  19's "1,000" freeze showed the back of a head (now `t=34.1, face=(0.36, 0.41)`, the blond boy), and 22's
  end freeze was on the boy beside the persuader (now `t=0.9, face=(0.30, 0.25)`, his face).
- READMEs: status lines and the index table say v2; reel 20's script, reasoning and post caption were
  rewritten (no more "three tries"); 20's open list notes that the girls' first names are captioned.
- Still flagged, not changed: the route map insert in 19 and 21 is the Race to Zion route ("מוצא").
- **v3 (his notes on v2, 15:30):** 18 drops "ואם סחטנו אתכם לצפות בסרטון עד עכשיו," (rule 79): the end is now
  his own following words, "אז באמת תעשו לייק." + "יאללה, חבר'ה. ותשמרו." (summary source 75.80 to 79.32).
  19 and 21: the route insert is `maps/map-jerusalem-zoom.mp4` from `va=1.5` (the city with dots, no route; rule 80).
  `deliver.sh` writes `-v3`. 20 and 22 stay at v2 (no notes on them). v3 of 18, 19, 21: QA PASS, frames
  checked, 18's end re-transcribed (heard as captioned), sent to him 15:55. The play app insert
  (`app-screens/play-map-and-mission-card.mp4`, green map with "אני כאן", a navigation line) stays: he OK'd it.
- **v3 of 20 and 22 (17.10):** 20 drops the sarcastic "יאיי"; it ends on "1,000 שקל!" as a colour freeze
  (`shake=26, flash=4`, new pass-through in street.py), a big gold `T.big` "1,000 ₪!", riser + register + pop.
  22 is four beats (18.6 s): hook split in two, pitch, "you win", "it's about the experience", end freeze; the
  pill switches to "משכנע עובר אורח" when the camera turns to the hooded man (else he reads as the seller).
  Both QA PASS, sent. Captions for all five: `docs/marketing/videos/drafts/street-200-captions.md` (and each README).
- **Loop closed (17.10):** founder rules 79 to 82; `qa.py` gained a `wording` check (rule 79) and its date
  check now really catches numeric dates (it held literal backspaces; see gotchas.md); all five re-run PASS.
  The library catalogue marks the three route maps "Race to Zion only" and describes `map-jerusalem-zoom`.
- **Next:** his notes on v3. Bump `deliver.sh` to the next version first (sed, while nothing runs it).

## The five videos

| # | Folder (docs/marketing/videos/drafts/) | Work folder (Desktop/RushPoint-reels-work/) | Source file(s) | Music |
|---|---|---|---|---|
| 18 | `18-everyone-took-200` | `s200-compilation` | WA0009, WA0008, WA0013, WA0007, WA0010 + the summary `20261015_234102` | garage, then `sfx/sad_bed.wav` (sadviolin) in the summary |
| 19 | `19-mystery-surprise` | `s200-mystery-shlomo` | WA0014 (Akiva asks three boys) | detective |
| 20 | `20-three-tries` (the slug is from v1; v2 has no failed takes, the name stays: files are never renamed) | `s200-mystery-girls` | WA0015 (Akiva asks the girls from Beit Rimon) | marimba |
| 21 | `21-sixty-seconds` | `s200-60sec` | WA0016 (Ahiya: "תקשיבו לי 60 שניות") | afro |
| 22 | `22-booth-stranger` | `s200-booth-stranger` | `20261015_214907` (a stranger sells the race at the booth) | dembow |

All raw files: `Desktop/RushPoint-reels-work/street-200/raw/` (copies; originals in
`Downloads/Mobile Devices/`). Transcripts: `street-200/ingest/<file>.json` and the better re-transcription
of WA0015/WA0014 in `street-200/retrans.log` (beam 8 + VAD: it found the girls' choice v1 had cut).

## How a video is made (every step is a script; never hand edit timeline.json)

```bash
cd "%USERPROFILE%/Desktop/RushPoint-reels-work/<reel>"
python cuts.py                       # the cut list -> clips/take.mp4, voice/take.wav, measured.json, captions.json
cd C:/Users/savir/Projects/Rushpoint/.claude/skills/reel-studio/engine
python "%USERPROFILE%/Desktop/RushPoint-reels-work/<reel>/make_timeline.py"
python build.py <reel> --opening A   # preview build -> <reel>/build/<reel>_A.mp4
python qa.py <reel> --opening A      # must PASS before anything is sent (rule 55)
python variants.py <reel> --final    # master + cover + strict QA
bash  "%USERPROFILE%/Desktop/RushPoint-reels-work/street-200/deliver.sh" <reel> <NN-slug>   # into docs/.../drafts (master, -small under 15 MB, cover)
```
For a v2 file name, edit `deliver.sh` (it writes `-v1`) to the new version before running it, and add a
line to the README's status. **Never edit deliver.sh while it is running** (bash reads scripts as it goes).
Run `PYTHONUTF8=1 PYTHONIOENCODING=utf-8` in front of every python on this machine.

### The cut list (`cuts.py`), what each entry can say
- `dict(src=<file in raw/>, a=, b=, part=, caps=[(who, text, s, e)])`: a stretch of the source, in SOURCE
  seconds. who: `A` Ahiya/Akiva asking (white caption), `K` Akiva, `P` the person asked (amber caption).
  Captions are what was HEARD (rule 21, 22): never guess a word; check with `street-200/check_take.py <reel>`.
- `zoom=1.3` a tighter base framing; consecutive pieces of one source alternate wide/close automatically, and
  any cut longer than `max_shot` (2.6 s in v2) is split at caption starts (rule 61 / 70).
- `vsrc=<library clip>, va=<second>`: the PICTURE comes from a footage library clip while the voice continues
  (an insert). Library: `docs/marketing/footage/library/` (README.md is the catalogue).
- `bw=True`: black and white (the sad summary).
- `dict(hit=True, src=, t=, hint_x= | face=(x, y), zoom=, dur=, bw=)`: a REACTION HIT (`street-200/hits.py`):
  freeze on a face at source second t, punch in, B&W, flash, shake. The frame is sharpened with Real-ESRGAN
  general x4 v3. Add `a=, b=, caps=` and the voice of [a, b] runs under the freeze (the end of 22).
  `part="hit"` = boom + music drop; `part="hit_end"` = bright sting (the colour freeze at the end).
  **Always look at the rendered freeze** (`<reel>/_seg/h*.mp4`): the face detector misses small or turned
  faces; then set `face=(x, y)` by eye (two of them were wrong in v2's first pass).

### Shared code (`Desktop/RushPoint-reels-work/street-200/`, copied to `engine/examples/street-200/`)
`street.py` (assemble: cached picture segments, float audio with -8 dB headroom, the voice chain),
`hits.py`, `tl_common.py` (graphics at chest height `GTOP = 1000`, timer, pills, `hit_fx`, `motion_fx` =
whoosh into inserts + pop on titles), `audio_bench2.py` / `audio_bench3.py` (voice chain scoring),
`check_take.py` (round trip transcription), `revoice.py` (redo only the voice chain), `deliver.sh`.
New music styles live in `engine/lib/music_street.py` (detective, marimba, afro, garage, dembow, sadviolin).

## The sound (measured, do not loosen it without measuring again)
WhatsApp audio carries overs to +6.6 dB as a clean wave: decode in float with -8 dB (never 16 bit first).
Chain: `adeclip` -> DeepFilterNet atten 32 -> high pass 80, 1.6:1 compressor, -2 dB shelf at 5.5 kHz,
de-esser (i 0.5, m 0.6, f 0.45; added in v2 for "צורם"), limiter, loudnorm -19. Scores and why: lessons-2026-10-16.md.
Nobody here can hear: say so when sending, and ask him about voice and music level.

## His notes and where each stands
On v1 (all addressed in v2, check them on v2 again):
- 18: the WHOLE question every time; reactions emphasised strongly; summary very sad (B&W, sad music, a freeze
  on "מינוס שלושת אלפים"; we cannot make them stop smiling, said so).
- 19: lacks charisma and action -> hits on both choices and the promise, inserts, "מאיפה אתם... היידה".
- 20: no failed takes; show that they chose the secret surprise; it was not understandable (the choice, the names
  and where they are from were cut); end not energetic, "תעקבו ואולי תנצחו" off topic -> ends on "1,000 שקל!" + "יאיי!".
- 21: title covered faces; "לי קוראים אחיה" was cut (Whisper heard "מי קוראים אחי"); end energetic; voice harsh in
  places; boring, needs other shots -> chest height graphics, inserts (builder, play app, route map, market, finish
  screen), hits, de-esser. Then: **no "60 שניות לשכנע" line under the timer, only the number.**
- 22: good; the end must show the persuader's face -> the last line over a freeze on his face.
- General (now rules 70 to 78 in founder-rules.md): a frame change every ~3 s; reactions with effects; titles never
  on faces; sound effects everywhere they mean something.

## Open (ask him, do not guess)
- 19: the third boy's name ("שעיה"/"ישעיה"? unclear on tape), uncaptioned until he says.
- Minors on camera: a parent's OK before publishing (all five).
- "בחמישי הבא" is said: publish before the race only.
- Sharper picture needs the street clips' ORIGINALS sent as files (WhatsApp gave 576x1024).
- Post captions: `street-200/captions_draft.md` and each README's `## כיתוב לפוסט`. Re-check them against v2's
  content (20 no longer opens with three tries; its caption's first line must change).

## Traps hit in this session (so you do not)
- A python `print(assemble(...)["take_end"])`: assemble returns `(measured, captions)`.
- Headless Edge times out under a full CPU: html_render timeout is now 240 s; rerun, PNGs are cached.
- Python `write_text` on Windows flips LF to CRLF: write with `newline=""` / check `git diff --numstat`.
- Heredocs with `\n` inside Python: write files with the editor tool.
- Reels must sit at the top of the work folder (nested names break build.py).
- `_seg/` keeps every OLD hit render beside the current one (named by hash): when checking freezes, go by
  mtime or by the built video, not by listing the folder.
- A face detector with only `hint_x` picks whatever face is largest near that x: in a group shot that is
  often the person in front with his back half turned. For a reaction hit, prefer `face=(x, y)` set from a
  gridded source frame (extract at t, draw a 10x10 grid, read the fractions).
- Two waiters on one log both start a build: one waiter per chain, and end each chain with a unique marker
  (`FINALDONE`, `FINALDONE2`) so a second chain can wait on the first.
- `variants.py --final` renders only the openings the timeline declares (here only A, ~5 min a reel), and
  overwrites `build/<reel>_A.mp4` at master quality; `deliver.sh` reads that file, so deliver only after it.
