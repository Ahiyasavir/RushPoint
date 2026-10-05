# Ahiya's standing rules for every reel

Collected from his own feedback (2026-09-28 reels 06/07/08 and 2026-10-01/02 reels 09/10/11).
These outrank any brief, including briefs relayed by another session. When a brief
contradicts one, follow the rule and tell him in one line.

## Sound
1. **Every reel has music, and each reel a clearly different STYLE**, not a new key on the
   same instruments ("needs a twist"; "the same music in all three"). `qa.py` fails a style
   another reel in the work folder already uses. Music ducks ~11 LU under his voice.
2. **ONE uniform speed for his voice, 1.12x via atempo**, never per line. 1.0x is "too slow".
   Trim dead air inside a take (pauses to ~0.15 s), never stretch words.
3. **Never clip a word.** Final stops (ת of אחת) have a silent closure: require ~160 ms of
   quiet before calling a word over, pad +0.14 s, assert the clip's last 60 ms < −50 dB.
4. **Clean, not processed:** denoise only from a learned profile of his own room tone,
   capped (nr ~10). A blind denoiser made him "creak". His mic is usually clean.
5. **His narration over the text** is better than text to read ("not pleasant to read everything").
6. **Lip sync is exact.** A talking shot keeps its own audio, ≤ 60 ms off (`qa.py` measures).

## Picture
7. **No punch zooms, no screen jumps** on graphics ("disturbs the eye"). Smooth, continuous
   motion; a slow push only on a still photo or when he asks.
8. **No dead time and no choppy pieces.** Cut the waiting, but one continuous take beats a
   string of jump cuts ("too many pieces and booms, confusing").
9. **Real images, never icons, for real things** (violin, robotics): his own photos and
   clips first (ask him, he has them), licensed stock second with his OK to download.
10. **Screen recordings / phone screens:** full screen, or a full phone shown whole; built in
    HIS phone's style (dark WhatsApp "מערכת", Google Calendar dark, his lock screen).
11. **Blur strangers' FACES in circles** that follow them, not boxes over the people.
    Names of other people in screenshots are blurred; his name is fine.
12. **Logo = the compass icon only, top right corner**, never the wordmark.
13. **Pick takes by measured head tilt/gaze** and by him looking into the lens.
14. **Text inside the platform safe zone: y 250..1420**, and left of x 960 below y 850
    (Instagram's description, name and buttons). `qa.py --final` fails it.

## Structure
15. **The hook shows the result or the stake in the first second**, and must be understood
    at once; a hook that needs decoding (result first + rewind on the stairs) confused him.
16. **Numbers and labels live inside the line they belong to**, big; a corner number is invisible.
17. **Quizzes show the answers** except the last, which goes to the comments; time per item
    grows with difficulty.
18. **End on him or on the payoff**, no chapter cards; the last frame loops into the first.
19. **Retention devices that worked:** live seconds countdown, progress dots, "+1", a
    "השאלה האחרונה בעוד 3 2 1" window, a thin progress bar, an arrow to the comment button.

## Words
20. **No hyphens or dashes anywhere**, the maqaf included (`ב 1%`, not `ב־1%`).
21. **Captions follow what he actually SAID**, not the script.
22. **Never invent numbers or events.** A display number he chose is his call, but never
    caption it as measured. Unknown = TODO, and ask.

## Delivery
23. **ONE post caption for every platform**, in his voice (`video-script` skill + its
    checker), ending in **exactly 5 hashtags, two of them always `#RushPoint` and `#רשפוינט`**.
24. **Nothing is sent, posted or uploaded without his explicit OK**; captions go to him
    through the "אודי" session only when he asks.
25. **Once he has published a video, never touch it.**
26. **Drafts and published videos live in `docs/marketing/videos/`** by the folder rules
    (see `deliverables.md`), including shelved ones ("don't delete, keep it as a draft").
27. **He wants my opinion and takes pushback.** Recommend, including "drop it".

## Captive audience videos (classroom, in app), from the המירוץ לציון classroom video, 2026-10-04
28. **Never narrate the withholding.** Lines like "I won't tell you", "that's a secret", "you'll
    find out there" are what make a video cringe ("זה בדיוק מה שהופך סרטון לקרינג׳"). Suspense
    comes from the content itself: the stakes, the place, the hidden leaderboard, the prize.
29. **Teens hate anything that feels silly.** Tone is professional, calm and informative, like a
    serious production's trailer. No slogans, no jokes that wait for a laugh, no declarations
    ("אתם עולי רגל!"). Facts said plainly.
30. **A captive audience (shown in class, played while waiting) needs no crazy hook**: it must be
    interesting AND matter of fact. Keep the picture changing every 5 to 7 s instead.
31. **Places the audience does not know get a real animated map**, not a name said aloud.
32. **Voice not loud or harsh** (2026-10-04, "חזק מידי וצורם"): voice at about -19 LUFS, not -16,
    with presence tamed (-3.5 dB at 3.2 kHz, -3 dB at 6.5 kHz), a de-esser and gentle
    compression (ratio 1.8, makeup 1). Set via RP_VOICE_LUFS / RP_VOICE_CHAIN.
33. **Music from the very first second.** An opening without music "brings it down".
34. **Cut every false start and every breath before a line**, not only the stutter he points at.
35. **Transitions smooth and natural**: a dissolve of about 0.45 s between talking shots, never
    a hard jump between two takes of him.
