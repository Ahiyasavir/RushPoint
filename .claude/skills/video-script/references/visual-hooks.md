# The visual hook bank

The spoken hook is half of it. **The first frame is the other half**, and on a muted autoplay
feed it is the only half that fires. The research is consistent that the opening works when a
visual change, a text overlay and a spoken line land together in the first one to three
seconds, and that short form feeds reward **pattern interruption**: anything that visually
breaks the rhythm of scrolling.

---

## The NERV audit

Score the first frame out of 5 on each. **Under 12 of 20 means replace the opening shot, not
adjust it.** Treat this as a heuristic; the source presents no data behind the threshold, and
it is still the fastest way to kill a dead opener.

| | Question |
|---|---|
| **N** ovelty | Does this frame look different from everything else in the feed? |
| **E** motion | Is there a face, a reaction, tension, or delight in it? |
| **R** elevance | Does it show a problem, a desire or an identity the viewer recognises? |
| **V** oid | Does the viewer need one more second to work out what is happening? |

**His default frame, a seated talking head at a desk, scores about 2, 3, 2, 1 = 8.** That is
below the replace line. It is also what he filmed last time. This is the single biggest cheap
win available.

---

## Frames he can actually shoot

Cross checked against `assets.md`. Anything not listed there he does not have yet.

### Tier 1 · highest novelty, he already owns the material

1. **The moving map.** Full screen, team pins crawling across Jerusalem, no UI chrome. Nobody
   scrolling has seen this frame. Void is very high because it is not obvious what it is.
2. **Hands on a phone, outdoors, moving.** Sunlight, a real street behind. Not a screen
   recording: a phone held by a person who is walking.
3. **The leaderboard flipping.** One team overtaking another, mid animation. Motion in the
   first frame is the cheapest novelty there is.
4. **The bug table.** A screen full of red rows. Reads as "something is wrong" in half a
   second, with no caption at all. Already filmed, `footage/devlog-hachvav-retro/shot1`.
5. **Terminal, tests going green.** Same shot, opposite emotion. Already filmed, `shot2`.
6. **The pin dropping on the map in the Builder.** Already filmed, `shot3`.

### Tier 2 · needs one afternoon

7. **A clock or a phone showing the actual hour.** `4:07` on a lock screen, in the dark. Pair
   it with the four in the morning line and the whole hook is two seconds long.
8. **The empty park before, the full park after.** Same frame, two moments, hard cut.
9. **Writing on paper, then the same thing on the screen.** The old way and his way, in one
   move, no words needed.
10. **Walking into frame and sitting down.** If the talking head is unavoidable, do not open
    already seated. Motion first, then settle.
11. **Over the shoulder at 4am,** screen glow the only light in the room.

### Tier 3 · needs people and permission

12. **A start line.** Bodies, noise, phones up.
13. **A face at the finish.** Highest emotion score available to him, by a distance.
14. **Someone reacting to their own screen** mid game, not looking at the camera.

**He has none of Tier 3 yet, and Tier 3 is where the emotion score comes from.** Getting
consent to film players at the Jerusalem race is a content decision worth as much as any
script. Flag it whenever a brief needs it.

---

## Openers to never shoot

- The logo. Any logo, any duration.
- A slow fade or a slow push in. The first frame must already be the frame.
- A seated talking head that starts with a greeting.
- A screen recording that opens on a login screen or a dashboard at rest.
- A title card the viewer has to read before anything happens.
- Anything that needs sound to make sense in the first two seconds.

---

## The three layer opening

Every opening stacks three things that land together. They must **not** be the same content
three times.

| Layer | Job | Example |
|---|---|---|
| **Frame** | novelty and emotion | clock reading 4:07 in the dark |
| **Caption** | the claim, max 4 words, very large | `ארבע בבוקר` |
| **Voice** | the sentence that opens the loop | `עשרות אנשים רצו אצלנו בחמישי האחרון` |

The frame says *when*, the caption says *what*, the voice says *why you should care*. If any
two of the three carry the same information, one of them is wasted.

---

## Re hook visually at second 7

The body needs its own visual breaks, not just the opening. At roughly second 7, and then
about every 5 seconds, change **one** of: location, shot size, who is on screen, or the
caption. A talking head held for 20 unbroken seconds loses viewers even when the words are
good.

Cheapest re hooks he has: cut to the phone, cut to the map, cut to the terminal, cut to a
still of the bug table, punch in on his own face.

---

## Captions: two layers, and the base layer is ALWAYS full

Corrected 2026-09-18 after he asked. An earlier version of this file implied sparse keyword
captions were enough. **They are not.** Short form is consumed muted by default, so an
uncaptioned line is a line most viewers never receive. Every script gets **two** caption
layers, and they do different jobs:

**Layer 1, the subtitle track. Every word he says, always.** Standard size, sitting in the
middle third, burned in. No exceptions, including the hook. Writing `כתובית: אין` over a
spoken line means that line does not exist for a muted viewer, and the hook is the worst
possible place to lose one.

**Layer 2, the emphasis cards. Four or five per video, no more.** Very large, held 2 to 3
seconds, reserved for the numbers and the decisions: the date, the prize, how many places are
left, the deadline, the link. These are what a viewer reads if they read nothing else, and
they are what a screenshot of the video has to carry alone.

**Placement, Instagram specifically.** Keep both layers out of the bottom quarter, where the
username, the caption and the audio strip sit, and off the very top, where the profile row
sits. The middle third is the only safe band. A `לינק בביו` card must sit HIGH enough to clear
the caption row but low enough to clear the top chrome.

**Hebrew specifically.** Auto caption tools mangle Hebrew more than English, especially
numbers, names and anything in Latin script. Read the generated track end to end before
posting. `רשפוינט`, `דרימז` and any English word are the usual failures.
