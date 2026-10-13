# Ahiya's standing rules for every reel

Collected from his own feedback (2026-09-28 reels 06/07/08, 2026-10-01/02 reels 09/10/11, 2026-10-04
classroom video, 2026-10-05 reels 14/15 + carousel). Before sending ANY cut, run
`pre-delivery-checklist.md`: it is these rules turned into checks.
These outrank any brief, including briefs relayed by another session. When a brief
contradicts one, follow the rule and tell him in one line.

## Sound
1. **Every reel has music, and each reel a clearly different STYLE**, not a new key on the
   same instruments ("needs a twist"; "the same music in all three"). `qa.py` fails a style
   another reel in the work folder already uses. Music ducks ~11 LU under his voice.
2. **ONE uniform speed for his voice: 1.12x for his monologue, about 1.03x for a two person
   conversation** (2026-10-05: 1.12 "קצת מהיר מידי" in dialogue), via atempo, never per line.
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
12. ~~Logo = the compass icon only~~ **Superseded by 43: no logo at all.**
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

## From 2026-10-05 (reels 14/15, the missions carousel, the race opening) · details in lessons-2026-10-05.md
36. **No dates in reels.** "אמרתי לך כבר, אל תכניס שום תאריך". Not spoken, not on screen.
37. **Open on neutral FACTS, not on "this is bad"**: a negative first line makes people skip.
38. **In-app instruction videos do not detail missions.** "You'll get two missions on the way",
    "a mission at the lookout", "some missions give bonus points". Logistics yes, content no.
39. **Show, don't tell, in instruction videos**: every practical line gets its screen recording
    (how to add a friend's phone, what a sealed mission looks like, where SOS is).
40. **Friendly, not nerdy**: "תעשו טובה לעצמכם ותשתו מים", not a checklist (no sunscreen line).
41. **Carousels for madrichim are titled for פעולות**, and close on: create a game for your next
    activity (free), save it for a day with no plan, share with a friend who'd love it.
42. **No sentence opens with ו ("ובניתי", "ועכשיו", "ותחשוב") and no filler "כבר"**: both sound
    written, not spoken. Spoken numbers colloquial: "בעשר שקל", not "בעשרה שקל".
43. **No logo at all any more** (2026-10-05, replaces rule 12): not the compass, not the wordmark,
    in reels and in carousels.
44. **Captions 84 px** (`config.json` default; `qa.py` fails under 78), on a dark plate over a phone,
    centred y 1300 so the plate ends above 1420. Phone mockups big and centred (`lib/portrait.py`).
45. **Carousel mission text must be clear to someone who never played**: what you do, what you
    need, how you win. No incidental mechanics ("כל פעם מישהו אחר מדבר").
46. **Grade flat phone footage** (2026-10-05: "הפילטר שהכנסת הוא מעולה, תזכור להכניס את זה"): when a
    take looks dull, apply `GRADE` from `engine/lib/portrait.py` (contrast 1.08, saturation
    1.25, gamma 0.97, a touch warm, light unsharp) to his takes and to stock.
47. **A countdown must be impossible to miss**: a big red pill, a tick on every second, louder in the
    last 10; its 60 "seconds" are spread over the real span so 0 lands exactly on the payoff line.
48. **Jump cut cover = change framing AT the join** (wide → close exactly on the cut), never a close
    crop that contains the join. And end a reel on the last scripted line, before any after talk.
49. **Research before ideas.** Hot topics he can tie to the app, proven hook styles ("אל תדלגו על זה",
    a stake with a timer), one short and one long reel. Ideas without research were "boring".
50. **Describe the app plainly, never with a slogan**: "אפליקציה שיוצרת לכם משחקים בסגנון המירוץ למיליון,
    מסמנים נקודות על מפה ובכל נקודה מחכה משימה". "מירוץ משימות אמיתי" means nothing to anyone.
51. **Prefer stock footage to a reshoot** when a line needs a picture he does not have (Mixkit, free
    license, recorded in `stock/LICENSES.txt`). He has little time to film.
52. **The hook hits**: a hit and whoosh on frame 0, music starting with an accent at 0, a `zoom_in` on
    the hook shot, the hook text big above his head, and the hook line said fast with no pause.
53. **Music around -11**, louder than the old -13..-18 (asked twice).
54. **Dialogue audio** (field): DeepFilterNet ≤ 12 dB, dynaudnorm, EQ cuts at 3.3/6.5 kHz, de-esser,
    gentle compressor; one continuous voice file under every picture.
55. **Never send a cut that has not passed `qa.py`** (2026-10-05: captions 8 px into IG's zone went out).

## From 2026-10-13 (the race opening video) · details in lessons-2026-10-13.md
56. **Every shot of him ends BEFORE his eyes leave the lens** ("נחתך מאוחר מידי, רואים אותי מסתכל לצד או מפסיק
    לזוז"). He looks to the laptop on, or just before, the last word. Measure it per shot (`tails.py`: head
    pose, iris, blink), cut the PICTURE about 5 frames before the drift, never hold a frozen last frame, never
    dissolve out of it; the voice finishes under the next shot (L cut, the next clip's first frame held).
57. **Instruction videos are energetic too**: hard cuts, no air between lines, an upbeat bed (~-11), a pop on
    titles, a whoosh on chapters. The calm 0.45 s dissolves of rule 35 read as slow.
58. **He may ask for a RushPoint end animation on a specific video** (asked 2026-10-13 for the race opening:
    icon springs in, wordmark, orange underline, on white). Rule 43 (no logo) still holds for reels unless he asks.
59. **A white background behind him means measured white** in the final file, every shot (see lessons-2026-10-13).

## From 2026-10-13 evening (reel 16 "the button", the morning of the race) · details in lessons-2026-10-13.md section 4
56. **The viewer must GET something.** A video that only asks them to care about him was "אין שם כלום, למה שיתנו לי
    לייק". Say what the app is and what they can do with it (build a game for a class, a פעולה, friends, free).
57. **No mission content and no quiz questions in a promo reel**: "זה לא מעניין אנשים". (Riddles as their own format are fine.)
58. **Show that the app is good, never that it might break.** No "if it falls", no bugs, no "what I could not test".
    Humanity comes from who it was built for (his grandmother), not from fear.
59. **Assume the viewer never heard of RushPoint**: one plain sentence of what it is, then how it works, shown on screen.
60. **Clean the room**: sockets, cupboards, cables and clutter behind him are removed (white cut out, `lib/whitebg`).
61. **Something changes in the frame at least every 3 seconds** (a framing jump, an insert, a graphic), and he wants
    visible jumps between framings, not one long locked shot.
62. **The hook is designed frame by frame** and has to look real: a screen insert must track, keep his fingers in
    front, and be impossible to tell from a lit phone.
63. **Two rejected versions of an idea = stop and ask what bothers him**, then follow HIS structure; do not guess a third.
