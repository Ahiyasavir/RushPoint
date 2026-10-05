---
name: video-script
description: Write short form video scripts (Reels / TikTok / Shorts) for RushPoint in Ahiya's own Hebrew voice, built to be watched to the end and shared. Use whenever asked for a script, a sketch for a video, a hook, a voiceover, a caption for a clip, a devlog video, or a collab video for another account. Encodes his real speech corpus, the hook bank, the proven structures, and the anti AI checklist.
---

# Video scripts that sound like Ahiya and get watched

## Before writing anything, read these

1. `references/voice.md` — his real transcribed speech plus the extracted rules. **This is the
   whole point of the skill.** Never write a line that could not appear in that corpus.
2. `references/structures.md` — pick ONE structure by name before writing a word.
3. `references/hooks.md` — the hook is chosen from a type, not improvised.
   `references/hook-bank.md` is the bank itself: ten families mined from 457 named patterns,
   with real Hebrew lines, plus a five question engine for generating a new one.
   `references/visual-hooks.md` is the FIRST FRAME, which on a muted feed is the whole hook.
   Score it with NERV before writing; his default seated talking head scores 8 of 20.
4. `references/anti-ai.md` — run it as a checklist on the finished draft, line by line.
   Its Hebrew companion is `references/ai-tells-hebrew.md`, which is the part that exists
   nowhere else: the English AI tell catalogs ported to Hebrew constructions.
5. `references/assets.md` — what footage, numbers and real events actually exist. A script
   that needs a shot he cannot film is a script he cannot use.

## The process

**Step 1 name the one true thing.** Every video is ONE real thing that happened, with a date,
a number or a name attached. Not a topic. Not a feature. If you cannot say "on Thursday
dozens of people ran" or "the CEO of Dreams called me in the middle of the day", stop and ask
him what happened this week. A script built on a topic instead of an incident always reads
as AI, whatever words it uses.

**Step 2 pick the structure** from `structures.md` by name. Write the name at the top of the
draft.

**Step 3 write the hook last but place it first.** Draft the body, then go back and cut the
hook from the sharpest line already in it. A hook invented separately from the body never
matches it.

**Step 4 write in beats, with timecodes and shots.** Output format below, always.

**Step 5 run the checks.** Mechanical first, judgement second:

```bash
python .claude/skills/video-script/scripts/check_script.py draft.md
```

It is calibrated so his own transcript passes clean and a deliberately AI draft fails on six
blocking findings. Then run `anti-ai.md` Tier 1 by hand, because no regex sees a lesson
sentence or a tied bow. Quote each failing line, fix it, say what changed.

**Step 5b check the opening frame** against `visual-hooks.md`. A script whose first frame is
a logo, a slow push in or a seated greeting is not finished, however good the words are.

**Step 6 read it aloud in your head at 150 words per minute.** Hebrew short form runs about
2.2 to 2.8 words per second spoken. A 30 second video is roughly 70 words. If the script is
longer than the slot, cut, do not speed up.

## Output format, always

```
STRUCTURE: <name from structures.md>
THE ONE TRUE THING: <the incident, with its date or number>
SLOT: <seconds> · <platform>

0.0 to 2.5 · HOOK
  קול:    <the spoken line>
  מסך:    <the shot>
  כתובית: <max 4 words, big>

2.5 to 7.0 · ...
```

Then, after the script:
- **ROLL** — the exact clips he has to film or already has (cross check `assets.md`).
- **CAPTION** — the post caption, in his voice, with the CTA. **ONE caption for every platform**
  (Instagram, TikTok, Shorts, Facebook), ending in **exactly 5 hashtags, two of which are always
  `#RushPoint` and `#רשפוינט`** (his rule, 2026-10-02). No hyphen inside a hashtag either.
- **THE RISK** — one honest line on why this video might not work. Never skip it.

## Hard rules

- **No hyphens, no dashes, anywhere.** Not in the script, not in the caption, not as
  punctuation, not the maqaf in `ל-4`. Write `לארבע בבוקר`. This is an absolute preference,
  see `voice.md`.
- **Hebrew first.** English only if he asks, and then it is rewritten, not translated.
- **One sentence per beat.** If a beat needs two sentences, it is two beats.
- **Never open on the logo, the product name, or a slow build.** Open on a person, a number,
  a stake or a mess.
- **Never write an ad.** The organic collab rule is that the product lives inside his story,
  it is not the subject of it. A screen tour is the format that measurably fails, see
  `assets.md`.
- **No claims that are not true.** He is 17, he built it for his grandmother's race starting
  Passover 2026, it is on Google Play. Do not round these up and do not invent traction.
- **He is a minor.** Do not write a script that pushes his school, his address or his
  grandparents' home into the frame for reach.

## Where things live

- Real transcribed voice corpus: `downloads/סרטון הספק מ4 בבוקר/_work/transcripts.json`
- His written voice at length: `apps/marketing/src/data/post/he-devlog-*.md`
- Existing rendered video masters and the Remotion source: `docs/marketing/playbooks/video-plan.md`
- Editing toolkit and ffmpeg gotchas: `~/.claude/toolkits/video-editing`
- Static social assets and their rules: `.claude/skills/social-carousel/`
- Distribution, cadence, series and audiences: `references/growth.md`. Read it before any
  brief that is about growth rather than about one video.

## Vendored companion skills

Two outside skills were installed into this repo because they are the best available on the
AI tell problem. **Both are English only**, which is why `references/ai-tells-hebrew.md` exists.

- `.claude/skills/writing-prose-like-a-human/` — five rules (be specific not significant,
  plain verbs, end sentences at the fact, vary rhythm, earn every adjective) plus a long
  vocabulary watchlist. CC BY SA 4.0, Kyle Hughes. **Read the five rules; they are good.**
- `.claude/skills/avoid-ai-writing/` — a deterministic detector, 53 issue types, regex plus
  stylometry, with a CLI. MIT, Conor Bronsdon. Run it on ENGLISH drafts only:
  `node .claude/skills/avoid-ai-writing/bin/avoid-ai-writing.js draft-en.md`
  Measured here: it scored a deliberately terrible paragraph 7 out of 100, "minimal AI
  signals". Treat it as a floor.
- `references/ai-prose-patterns-en.md` — a 36 pattern catalog of machine drafting tells.
  MIT, ghanemzadeh.
