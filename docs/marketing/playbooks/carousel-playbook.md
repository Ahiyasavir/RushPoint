# Instagram carousel playbook — hooks, structure, and the psychology behind them

Written 2026-09-15 while building the "5 AI tools" carousel. Contains the finished copy
for that post, the research it was derived from, and a reusable checklist so the next
carousel does not restart from zero.

Companion doc: [video-editing-setup.md](video-editing-setup.md) — the toolchain for the
video content this account posts alongside carousels.

---

## 1. The finished copy

**Slide 1 — the hook**

> אין לי שותף, אין לי משקיע, ואין לי תואר.
> יש לי 5 כלים ושעון מעורר ל-4 בבוקר.

**Slide 8 — the close**

> בעוד שנה אנשים ישאלו איך הדבר הזה נבנה.
> אתה כבר תדע כשתעקוב.

Small open-loop line at the bottom of slide 1, to drive completion rather than a single
swipe:

> מספר 4 עשה יותר מכל השאר ביחד.

---

## 2. Why this hook works, and what it replaced

The hook is an **underdog brand biography**. Paharia, Keinan, Avery and Schor (*Journal of
Consumer Research*, Harvard) found that such biographies need **two dimensions, both
present**:

1. **External disadvantage** — what you lack, what stands against you
2. **Passion and determination** — what you do anyway

In their studies participants chose the underdog brand **71% of the time**. The effect is
mediated by identification, is stronger for people who see themselves as underdogs, and —
directly relevant here — is **stronger in cultures where underdog narratives form part of
national identity.** An Israeli audience is close to a best case for this frame.

The first draft had only dimension 1: "no partner, no investor, no degree — I have 5
tools." That is a list of deficits followed by a technical fix, and it reads as someone
who found a shortcut. Adding "שעון מעורר ל-4 בבוקר" supplies dimension 2: a concrete,
non-arguable fact that reframes him as someone paying a price. It also breaks the rhythm
of three "אין לי" clauses with a fourth beat arriving from an unexpected direction, which
is what makes the line memorable and quotable.

---

## 3. Why the close works

The close opens **three** mechanisms at once.

**Social currency (Berger, STEPPS).** People share what makes them look good, and the
purest form is insider knowledge — knowing something others do not. Early discovery is
social currency that never expires: it becomes a story they can tell permanently. The
line hands them that story pre-written: *I knew how it was built.*

**Psychological ownership (Pierce, Kostova and Dirks).** The feeling that something is
"mine" forms through exactly three routes — **control**, **self-investment**, and
**intimate knowledge**. Block one and ownership never forms; open all three and it is very
hard to dislodge. "אתה כבר תדע" is the intimate-knowledge route. Pairing the post with a
real practice of publishing decisions *before* making them opens the control route too.

**Zeigarnik effect.** People remember unfinished tasks better than finished ones; the brain
seeks closure. Serialized content is this at scale. **Critical caveat: the effect only
holds if the audience trusts the loop will eventually close.** If everything is "to be
continued" and nothing resolves, people stop investing. This is why the devlog series
matters more than any single post — it is the proof that loops do get closed.

---

## 4. The eight-slide skeleton

| Slide | Closes | Opens |
|---|---|---|
| 1 | — | Which 5? And what did number 4 do? |
| 2 | What "AI as a team" means in practice | So who is first? |
| 3 | Tool 1 plus what it actually built in RushPoint | Who is next? |
| 4 | Tool 2 | Three left, one of them is number 4 |
| 5 | Tool 3 | **Number 4 is next** — highest tension point |
| 6 | Tool 4, the promised payoff | What could follow that? |
| 7 | Tool 5 | So what came out of all this? |
| 8 | Proof (photo from the live event) plus follow | — |

Slide 5 is the critical drop-off point: tension is highest there, so it must not be the
boring one. Place the soft CTA ("save this") around slide 5 as well — research
consistently favours **two CTAs: one soft mid-way, one explicit at the end.**

---

## 5. Carousel mechanics (research-backed)

- Carousels get **roughly 1.9x the reach** of single-image posts and up to **3x
  engagement** — but only through **swipe-through rate**, which is what the algorithm
  actually measures.
- **The first slide carries roughly 80% of the weight**, decided in 2-3 seconds.
- **5-8 slides** is optimal for saves and completion.
- **Completion rate** (share of viewers reaching the last slide): 25-40% is healthy, 45%+
  is excellent. Only people who reach the end ever see the follow CTA.
- Posts with an explicit CTA get **20-30% more engagement**; carousels show roughly **41%
  stronger follower growth** than other formats.
- A follow CTA converts when paired with a **concrete posting promise** — what, and how
  often.
- **The CTA slide must visually match slide 1** — same colours, same type. A CTA slide in a
  different style reads as an ad and tanks the save rate.
- **Never use "tag 5 friends" or "comment YES"** — classifiers recognise and suppress them.

---

## 6. Hook formulas worth reusing

Six categories, strongest first for swipe-through:

1. **Curiosity / information gap** — highest raw swipe rate, because the gap closes *only*
   by swiping: open loop ("wait until slide 6"), the single secret, the contrast gap.
2. **Mistake / FOMO** — direct callout, "stop doing X", trusted-advice-is-harmful.
3. **Specificity / numbers** — stat contrast, before/after numbers, oddly specific figures.
4. **Story / vulnerability** — in medias res, hindsight wisdom, underdog arc. *This is the
   family the current hook belongs to.*
5. **Contrarian / challenge** — belief challenge, contrarian plus proof.
6. **Promise / how-to** — objection handling ("even if you..."), primed save.

**The structural rule that matters most:** a hook must open a gap that takes the *whole*
carousel to close. "The mistake I made" opens exactly one question, slide 2 answers it, and
the remaining six slides have no fuel. A **countable** gap ("5 tools", "3 things") creates
one sub-gap per slide, and that is what sustains an eight-slide post.

---

## 7. Design rules (Pubity style)

Pubity is roughly 37M followers and 240B annual views, started by two teenagers. What to
copy from their method:

- **Huge bold sans, minimum words, high contrast.** The headline *is* the design.
- **Short declarative sentences with no hedging.** Not "5 ways that might help" — a flat
  claim.
- **Treat the platform as a system to be learned**, not a distribution channel. They
  measured format, timing and image composition obsessively.

Applied: slide 1 should be **at most about 9 Hebrew words**, oversized type, one visual
element, high-contrast background.

---

## 8. Linking a post to the product without it reading as an ad

The rule: **the product is the evidence, not the offer.**

Each slide gets a "what it actually did" line, and every one of those points at RushPoint:

- Not "Claude Code writes code" but **"Claude Code wrote the scoring engine that ran on 29
  simultaneous players"**
- Not "an AI video tool" but **"this video was edited that way, lip sync included"**

The product enters seven times without a single "download my app". Slide 8 closes with the
result: a real photo from the event.

---

## 9. Rejected directions, and why (do not re-derive these)

| Rejected | Why |
|---|---|
| "5 AI tools that made me 7x more productive" | Closes the gap instantly; invented number with no proof; the most saturated category online. |
| "How to use AI and not be left behind" | Pure fear, zero specificity, indistinguishable from every other AI page. |
| "You use AI like Google. I use it like a team." | The reframe is strong but the "you... I..." construction is a rebuke followed by a flex — condescending, and worse when the writer is younger than the audience. **Fix: make yourself the one who was wrong.** The reader then reaches the conclusion alone, which persuades harder. |
| "The mistake I made with AI cost me months" | Opens exactly one gap; cannot sustain eight slides. |
| "Something there is going to break" | Creates tension by undermining product reliability — fatal when selling to event organisers. |
| "The system is built for it. The question is whether I am." | Self-deprecating *and* an unbacked boast about the product, simultaneously. |
| "In 3 months this will not be small" | A promise about the future. Promises are free and anyone can make them. |

**The general lesson from that sequence:** a strong close is not a *promise* about what the
account will become — it is an *offer* of something the follower receives immediately
(knowledge, influence, access). Promises are cheap; offers create ownership.

And when building tension around a product you sell: **the uncertainty goes on the person
or on the scale, never on the product.**

---

## 10. Checklist for the next carousel

1. Does slide 1 open a gap that needs the **whole** carousel to close, not one slide?
2. Is the gap **countable**?
3. Does the first sentence make the reader the fool? If so, swap the subject to "I".
4. If it is an underdog frame, are **both** halves present — disadvantage *and*
   determination?
5. Is there an open-loop line pointing at a **specific later slide**?
6. Two CTAs — soft around slide 5, explicit on the last?
7. Does the CTA slide look identical in style to slide 1?
8. Does the close **offer** something received now, rather than promise a future?
9. Does the product appear as evidence in every slide, and never as a pitch?
10. 5-8 slides, and 9 words or fewer on slide 1?

---

## 11a. Superseded — v1, five tools (kept for the record, not the plan to build)

**Rejected 2026-09-15, same day: not relevant to the audience.** Remotion, MediaPipe and
faster-whisper are real and impressive, but they are *dev/video-production* tools nobody in
the audience will ever touch themselves — one-time "wow" with zero practical value (Berger's
STEPPS: content that a reader can *use* outperforms content they can only admire). Replaced
with a trio the audience already recognises and can install tonight: Claude, Gemini,
Perplexity. See §11b for the actual plan. Section kept per this doc's own rule (§9) — a
rejected direction, once diagnosed, should stay legible so nobody re-derives it.

Written 2026-09-15, second pass. The 5 tools are picked from what is actually documented as
built for RushPoint (see [[marketing-video]], [[marketing-devlog-series]],
[[local-video-transcription]], [[video-editing-toolkit]] and CLAUDE.md's callable count) —
**verify the specific numbers below before publishing**, they age (CLAUDE.md itself says the
"112" is a snapshot, read live off the last `npm run e2e` run, not this doc).

**#4 is Remotion** — chosen as the standout because the claim is genuinely the strongest: the
explainer video's motion, Hebrew voiceover (`edge-tts`) *and* original music (synthesized in
Node, oscillators/kick/hats) were all machine-generated from one codebase, zero licensed
assets, and the 20s social cut published from the same source within hours of the 72s hero
cut. That is a materially bigger claim than "edited faster" — nothing was downloaded or
recorded to make that video exist.

Every slide below is scored against the two goals the carousel must serve simultaneously:
**(F)** — does it move someone toward hitting follow, and **(B)** — does it plant a specific,
checkable fact about RushPoint (not a vibe) that reads as evidence, not an ad.

### Slide 1 — Hook (locked, see §1)
> אין לי שותף, אין לי משקיע, ואין לי תואר.
> יש לי 5 כלים ושעון מעורר ל-4 בבוקר.
> *(small, bottom)* מספר 4 עשה יותר מכל השאר ביחד.

- **Mechanism:** underdog brand biography (both dimensions present) + countable curiosity gap
  (§6 family 4 + 3) + an open loop pointing at a *specific later slide*, per checklist item 5.
- **Visual:** huge bold Hebrew sans on BONE, one accent line in ORANGE for "5" and "4",
  Contour Kinetics contour texture faint behind, nothing photographic yet — the type *is* the
  design (§7).
- **(F):** does the 2-3 second decision (§5) — no follow ask yet, that would be premature.
- **(B):** zero — first slide never names the product (§8's "evidence not offer" rule starts
  at slide 3, once trust exists).

### Slide 2 — Reframe (new)
> חשבתי ש-AI זה גוגל מהיר יותר.
> טעיתי. זה צוות של חמישה, ולכל אחד תפקיד.
> *(small)* הראשון בנה את כל הדבר עצמו.

- **Mechanism:** contrarian-belief-challenge (§6 family 5), but self-directed ("I was wrong"),
  which is the fix from the rejected "you use AI like Google, I use it like a team" line (§9)
  — the reader reaches the reframe themselves instead of being corrected.
- **Visual:** five small numbered survey-stake markers in a row (Contour Kinetics marginalia
  style), only #1 lit in ORANGE — a literal progress rail the reader tracks across the post.
- **(F):** sets up "this is a structured reveal, not a rant" — raises trust before slide 5's
  soft ask.
- **(B):** none directly — still framing.

### Slide 3 — Tool 1: Claude Code
> 01 — Claude Code
> לא "סוכן שכותב קוד". בנה את המנוע: מאות קריאות שרת, מנוע ניקוד, ניתוב חי לכל שחקן. לבד.
> *(small)* השני עשה משהו שכבר ראית — וחשבת שמעצב בנה את זה.

- **Mechanism:** specificity/numbers (§6 family 3) — a hard, checkable claim about scale
  reads as credibility, not marketing copy. Pull the exact current callable count from
  `npm run e2e`'s own coverage line before publishing (CLAUDE.md: "read it there, not a
  memory") — do not hardcode last session's 112.
- **Visual:** monospace terminal-green-on-ink texture as the marginalia layer (the one place
  it's allowed to break from survey-marginalia into "code" — it's what the tool actually is).
- **(F):** progress rail advances to #1 lit; reader is now mid-reveal, harder to bounce.
- **(B):** first product mention — names concrete backend facts (scoring engine, live
  routing), never "RushPoint uses AI."

### Slide 4 — Tool 2: Gemini (image generation)
> 02 — Gemini
> עיצב את הלוגו, האייקונים והבאנרים של RushPoint. שום פיקסל לא Placeholder.
> *(small)* השלישי חסך לי משהו שלא היה לי בכלל: תקציב.

- **Mechanism:** the "already seen it and assumed a human/agency made it" beat is a
  recognition trigger — closes the previous slide's open loop with something mildly
  surprising, which is what keeps swipe-through above the drop-off point research flags for
  slide 4-5 (§5).
- **Visual:** a tight 3-up thumbnail grid of actual shipped assets (logo mark, an app icon,
  one banner) — real artifacts, not a stock AI-art cliché.
- **(F):** — (B): second explicit brand mention, visual proof this time not just a claim.

### Slide 5 — Tool 3: faster-whisper (local transcription) + soft CTA
> 03 — Whisper (מקומי)
> תמלל שעות של וידאו בעברית מהטלפון שלי. בלי ענן. בלי לשלם על דקה אחת.
> *(small)* שמור את זה. שני הכלים הבאים הם הסיפור האמיתי.

- **Mechanism:** this is the **highest-tension / highest-drop-off slide** (§4's table flags
  it), so it carries the resourcefulness beat — reinforces underdog dimension 1 again
  (no budget, no cloud bill) right before the payoff — and the **soft CTA** research says
  belongs at slide 5 (§5, §10 checklist item 6). "Save this" is chosen over "share" because
  saves are the signal the algorithm weights for distribution; it is also honest — the
  content that follows is the reason to save.
- **Visual:** same marginalia system, ORANGE underline only on "בלי ענן. בלי לשלם" — the two
  clauses doing the underdog work.
- **(F):** the save-CTA itself, worded as a reason ("the next two are the real story") rather
  than a bare command — matches the "never bare command" rule (§5).
- **(B):** the build-log video series (יומן בנייה on the marketing blog) is the direct
  downstream product of this tool — can be named here or saved for slide 8's proof.

### Slide 6 — Tool 4: Remotion (the payoff — highest emotional peak)
> 04 — Remotion
> כתב את כל סרטון ההסבר בקוד: התנועה, הקריינות בעברית, המוזיקה — הכל נוצר. שום קובץ לא
> הורד. גרסת הרשת פורסמה מאותו קוד תוך שעות.
> *(small)* ואז נשאר כלי אחד. הוא לא בנה שום דבר. הוא רק ראה הכל.

- **Mechanism:** this is where slide 1's open loop ("number 4 did more than all the others
  combined") finally closes — it must be the visually biggest, most concrete slide in the
  set, per §4's note that slide 5(→6 in this expanded version)'s tension must not be wasted.
  The claim is deliberately compound (motion **+** voice **+** music, all generated) because
  a single-fact payoff would undersell the loop it's closing.
- **Visual:** the one slide allowed a real frame grab — a still from the actual rendered
  video (hero cut), Contour Kinetics ORANGE route-line drawn overlaying it as if annotating
  the frame. Biggest visual weight of the whole carousel.
- **(F):** the emotional peak is what gets *remembered* and re-shared into Stories — peaks
  are what people screenshot.
- **(B):** the single strongest brand-evidence slide — points straight at a video the
  audience can actually go watch (marketing site hero / social channels), turning a claim
  into something verifiable in one tap.

### Slide 7 — Tool 5: MediaPipe (the quiet closer)
> 05 — MediaPipe
> עקב אחרי כל פריים, אימת סנכרון שפתיים, ניקה רקעים.
> חמישה כלים. אפס שכר עבודה.
> *(small)* אז מה יצא מכל זה?

- **Mechanism:** a deliberate quiet beat *after* the loud slide 6 — rhythm contrast (§7's
  "slow field, fast route" idea, applied to pacing not just layout) — and the closing line
  **"אפס שכר עבודה" (zero payroll) is a direct callback to slide 1's "no partner, no
  investor"**, closing the underdog frame the whole post opened with. The forward line asks
  the question slide 8 answers, rather than opening a new gap this late.
- **Visual:** an eye/scan-line motif, smallest and calmest slide in the set — the "he" of the
  progress rail: all five markers now lit.
- **(F):** the "so what came out of all this" line is what makes swiping to slide 8 feel
  mandatory rather than optional.
- **(B):** completes the count — five for five, all named, all tied to something real.

### Slide 8 — Close: proof + explicit follow CTA (must mirror slide 1's style exactly)
> בעוד שנה אנשים ישאלו איך הדבר הזה נבנה.
> אתה כבר תדע כשתעקוב.
> *(photo)* — a real photo from a live run (המירוץ לציון or another shipped event)
> *(CTA line)* עוקב אחרי הבנייה של RushPoint. פוסט אחד בשבוע — עד שהדבר הזה גדול מדי בשביל
> תיאור אחד.

- **Mechanism:** all three close-mechanisms from §3 at once (social currency, psychological
  ownership via intimate knowledge, Zeigarnik) — **plus** the explicit CTA is paired with a
  **concrete posting promise** ("one post a week"), which §5 flags as the difference between
  a CTA that converts and one that doesn't. The last clause is an *offer* ("you get access to
  the build starting now"), not a promise about the account's future size — matches the
  general lesson from §9's rejected-directions table.
- **Visual:** same BONE/INK/ORANGE, same type treatment as slide 1 — §5's non-negotiable
  rule ("a CTA slide in a different style reads as an ad"). The photo is the one departure
  from pure typography in the whole set, and it is real, not a mockup.
- **No "tag 5 friends" / "comment X"** — the CTA is a plain follow + a concrete reason.
- **(F):** the entire slide is the follow ask — the one place the whole carousel has been
  building toward.
- **(B):** closes with proof (a real photo, a real event) rather than another claim — the
  product's existence is no longer asserted, it's shown.

### What to confirm before building the images
1. Swap in the *current* callable count for slide 3 (don't hardcode 112).
2. Pick the actual event photo for slide 8 — needs to exist and be usable/consented.
3. Confirm Remotion's claim is still accurate if the video pipeline changed since 2026-07-09.
4. Decide whether "יומן בנייה" (the devlog series) gets named explicitly (slide 5 or 8) as
   the concrete thing a follow actually delivers — strengthens the posting-promise CTA.

---

## 11b. Current plan (v2) — "השלישייה המנצחת" (the winning trio)

Written 2026-09-15, third pass, replacing §11a. Six slides, not eight — with only three
characters, stretching to eight would mean padding, and §5's research says completion rate
(not slide count) is the real signal. Six sits inside the 5-8 optimal range and stays honest
to the amount of real content there is.

**The trio and their single, non-overlapping jobs:**
1. **Claude** — writes the code, manages the founder's time, integrates with everything
   (WhatsApp, email, calendar, files, Drive).
2. **Gemini** — images and branding only (deliberately stripped of any "planning" language
   that overlapped with Claude's time-management claim — one tool, one job, or the "each has
   exactly one role" premise stops being legible).
3. **Perplexity** — deep research that *directs* the other two — and, the twist the carousel
   is built around, the one that actually starts first, before either of the others touch
   anything.

**Reveal order deliberately differs from use order.** Perplexity runs first in real life, but
opening with it spends the twist for free. Claude and Gemini go first (familiar names, easy
early proof), and the reveal that Perplexity was running the whole show from before slide 1
is saved for the peak slide — the same "hidden reframe right before the close" device that
made the old #4 beat work, except this time it's structurally built into the trio itself
rather than invented for the post.

### Slide 1 — Hook (revised for 3)
> אין לי שותף, אין לי משקיע, ואין לי תואר.
> יש לי שלישייה מנצחת ושעון מעורר ל-4 בבוקר.
> *(small, bottom)* אחד מהם התחיל לפני ששני האחרים בכלל ידעו שיש פרויקט.

- **Mechanism:** underdog biography unchanged (§2) — both dimensions still present. The open
  loop is rebuilt around the reveal-order twist rather than a numbered "which one did most"
  gap, since three items don't support five sub-gaps the way the old count did — one strong
  gap ("which one started first, and why does it matter") carries six slides fine.
- **Visual:** unchanged from §11a — huge bold Hebrew sans on BONE, ORANGE accent on the
  numbers, Contour Kinetics texture faint behind. Rule-of-three composition: consider three
  short contour "ridgelines" behind the type instead of one, a quiet visual echo of "three."
- **(F):** the 2-3 second decision, no follow ask yet.
- **(B):** zero — product not named yet.

### Slide 2 — Reframe
> חשבתי ש-AI זה כלי אחד שעושה הכל.
> טעיתי. זו שלישייה, ולכל אחד תפקיד אחד בלבד.
> *(small)* הראשון לא רק כותב לי קוד — הוא מנהל לי את החיים.

- **Mechanism:** contrarian-belief-challenge, self-directed ("I was wrong") — same fix as
  §11a slide 2, still avoids the condescending "you...I" construction (§9).
- **Visual:** three survey-stake markers instead of five, only #1 lit — the progress rail
  now matches the trio exactly, so the reader can feel there are only three stops left.
- **(F):** sets up "structured reveal," raises trust before the soft ask at slide 4.
- **(B):** none yet.

### Slide 3 — Claude (anecdote confirmed 2026-09-15)
> 01 — Claude
> מסדיר לי היעדרויות משיעורים דרך וואטסאפ. קובע לי את הלו״ז.
> אשכרה מנהל לי את היום.
> *(small)* השני לא כותב שורת קוד אחת — והוא זה שאתה כבר ראית.

- **The anecdote is real, per the founder directly** (2026-09-15): Claude manages his day,
  is connected over WhatsApp, sets his schedule, and handles his school-absence excuses.
  The school-absence line leads because it's the single most specific, most surprising,
  most *checkable-sounding* claim of the three — leading with it is what makes "אשכרה מנהל
  לי את היום" land as an escalation rather than a restated feature list (§6 family 3,
  specificity beats a broad claim every time it's available).
- **One thing worth naming before this ships, not a reason to change the copy:** the founder
  is a minor and this is a public post — "AI arranges my school-absence excuses" is exactly
  the kind of specific, quotable line that gets *screenshotted into a comment thread*, for
  better or worse. That's good for reach and worth having eyes-open about, not a reason to
  soften it — his call.
- **Mechanism:** specificity/numbers (§6 family 3) — a hard, checkable claim, not marketing
  copy. Also **subtly reinforces the underdog frame again**: this is a teenager running his
  own logistics without a parent/assistant, which is its own quiet "disadvantage +
  determination" beat (§2) layered under the AI-stack angle.
- **Visual:** monospace terminal texture as marginalia — the one place allowed to break from
  pure survey-map style, because it's literally what the tool is.
- **(F):** progress rail advances to #1 lit.
- **(B):** first product mention, but framed as "what Claude does for the founder," not yet
  RushPoint directly — RushPoint enters at slide 4.

### Slide 4 — Gemini + soft CTA
> 02 — Gemini
> יוצר לי תמונות ומיתוג. הלוגו, האייקונים, הבאנרים של RushPoint — כולם ממנו.
> *(small)* שמור את זה. השלישי משנה את מה שחשבת על השניים האלה.

- **Mechanism:** "planning" language deliberately removed from this slide (per the overlap
  fix) — Gemini's job is visual only, full stop, so the "one tool, one job" premise stays
  legible. **Soft CTA lands here**, at the highest-tension point right before the twist
  reveal — matches §5/§10's "soft CTA around the middle" rule, now positioned one slide
  before the peak rather than two, because the trio is shorter. Worded as a reason ("changes
  what you thought"), not a bare command.
- **Visual:** 3-up thumbnail grid of real shipped assets (logo mark, app icon, one banner).
- **(F):** the save-CTA itself.
- **(B):** second, explicit RushPoint mention — visual proof, not just a claim.

### Slide 5 — Perplexity (the twist — peak slide)
> 03 — Perplexity
> לא בנה שום דבר. לא עיצב שום דבר.
> הוא זה שהתחיל הכל — לפני קלוד, לפני ג'מיני, לפני שורת קוד אחת.
> *(small)* המחקר שלו הוא מה שכיוון את שניהם מההתחלה.

- **Mechanism:** this is where slide 1's open loop closes — the reframe that the "quiet"
  third tool was actually running the show the whole time, retroactively re-contextualising
  slides 3-4. That retroactive re-read is the payoff mechanism itself (structurally similar
  to what a countable-gap hook does, but delivered as a hierarchy reveal instead of a
  number) — and it is the most rewatch/reread-worthy slide in the set, which is what tends
  to get screenshotted into Stories.
- **Visual:** biggest visual weight of the carousel — consider the two prior tool-markers
  (Claude/Gemini icons or initials) both drawn with a single ORANGE line converging back to
  a third mark positioned *before* them on the rail, making the "he was first" claim visible,
  not just stated.
- **(F):** the peak is what gets remembered/re-shared.
- **(B):** ties the founder's actual working method to RushPoint's existence — this is where
  "even the idea for RushPoint was researched before being built" can be said plainly if
  true; otherwise keep the claim scoped to "how the founder works," not the product's origin.

### Slide 6 — Close: proof + explicit follow CTA
> בעוד שנה אנשים ישאלו איך הדבר הזה נבנה.
> אתה כבר תדע כשתעקוב.
> *(photo)* — a real photo from a live run (המירוץ לציון or another shipped event)
> *(CTA line)* עוקב אחרי הבנייה של RushPoint. 4 פוסטים בשבוע — עד שהדבר הזה גדול מדי בשביל
> תיאור אחד.

- **Mechanism:** unchanged from §11a slide 8 — social currency, psychological ownership via
  intimate knowledge, Zeigarnik, all three at once, plus a concrete posting promise paired
  with the explicit CTA. Offer, not promise (§9's general lesson). **Cadence corrected
  2026-09-15: 4 posts/week, not 1/week** — confirmed by the founder directly. This is a
  *stronger* claim, not a weaker one: a higher, checkable cadence is more Zeigarnik-dense
  (more open loops per week = more reasons to keep checking back) and reads as more
  confident, not more modest.
- **Visual:** same BONE/INK/ORANGE, same type treatment as slide 1 — non-negotiable per §5.
- **No "tag 5 friends" / "comment X."**
- **(F):** the entire slide is the follow ask.
- **(B):** closes with proof, not another claim.

> **BUILT 2026-09-15** — the six slides exist as PNGs, generated by
> [`carousel/build_carousel.py`](carousel/build_carousel.py). See
> [`carousel/README.md`](carousel/README.md) for the structural idea (the carousel is
> rendered as crops of ONE continuous survey sheet, so the route bleeds across every seam)
> and the table of which retention technique is doing what on which slide.

### What to confirm before building the images
1. ~~Write the one real Claude anecdote for slide 3~~ — done, confirmed 2026-09-15.
2. Pick the actual event photo for slide 6 — **still open.** The build currently uses
   `poster/src_4.jpg`, an illustrative frame, not a real run.
3. Decide whether slide 5's last line should name RushPoint directly ("even this app was
   researched before it was built") — only if that is literally true of how it started;
   otherwise keep it scoped to the founder's working method, not the product's origin story.
4. Decide whether "יומן בנייה" gets named explicitly as what a follow delivers.

---

## Build tools — how to actually render the slides

Researched 2026-09-15. Two proven pipelines already exist in this repo — prefer them over
a generic SaaS carousel maker, because both already solve Hebrew RTL and match the brand.
(Written against the original 8-slide count; the current plan is 6 slides — §11b — same
tools, same 1080×1350 canvas, just fewer files.)

### Option A (recommended) — extend the Pillow/PIL poster pipeline

`docs/marketing/poster/` already has a working Hebrew-RTL image generator used for the
מירוץ למיליון campaign (`build_story.py`, `build_poster.py`). It is the closest fit because
it already solved every hard part a carousel needs:

- **Hebrew RTL text** via `python-bidi`'s `get_display(s, base_dir='R')` — call this `He()`
  helper on every Hebrew string before drawing; PIL itself has no bidi support.
- **Supersampling** — renders at `SS = 2` (e.g. 1080×1350 becomes a 2160×2700 canvas, drawn,
  then downsized) for clean anti-aliased type and lines; do the same for carousel slides.
- **Local fonts already on this machine**, referenced by absolute path under
  `C:/Windows/Fonts/`: `ahronbd.ttf` (Hebrew bold headline), `segoeui.ttf` /
  `seguisb.ttf` (body/subhead), `davidbd.ttf` (used as a signature/accent face).
- **The brand palette as RGB tuples**, ready to paste into a new script: `BONE (245,238,225)`
  paper background, `INK (33,30,25)` near-black text, `ORANGE (208,78,28)` / `ORANGE_DK
  (150,46,12)` the one signal color, `GREEN (74,92,74)` muted survey accent — see
  [contour-kinetics.md](poster/contour-kinetics.md) for why: RushPoint's established visual
  language is a topographic survey-map aesthetic (concentric contour lines, one dashed
  "route," restrained color used to classify not decorate, huge headline word + tiny
  monospace marginalia). **Read that doc before designing any slide** — it is the brand's
  actual art direction, not just a palette.
- **`fit_crop(path, tw, th, ybias)`** — a reusable helper for photo-led slides (crop-to-fill
  without distortion, with a vertical bias knob).
- Python deps for this are already installed per [video-editing-setup.md](video-editing-setup.md):
  `pillow`, `python-bidi`, `arabic-reshaper`, `fonttools`, `numpy`.

**Carousel size:** Instagram carousel slides are **1080×1350 (4:5)**, not 1080×1080 — taller
than a single post, because IG crops carousels to 4:5 in-feed. Build at that ratio directly.

Practical plan: copy `build_story.py` as a starting point (it is already 1080×1920 photo-led
with a title band — closest existing shape), change canvas to 1080×1350, and write one script
per slide (or one script producing all 8 PNGs in a loop) so the palette/fonts/He() helper are
defined once and reused.

### Option B — HTML/CSS + screenshot (matches the `design` skill's built-in workflow)

The `design` skill's `social-photos-design.md` (`.claude/skills/design/references/`) is a
ready-made HTML→PNG pipeline: exact platform size table (confirms 1080×1350 for IG carousel),
safe-zone rule (keep content inside the central 80%), type-size minimums (headline ≥48px,
body ≥24px at 1080px width), and four screenshot-export options (Chrome headless CLI,
`chrome-devtools` skill, Playwright, Puppeteer — all with a 3-5s render delay for
fonts/images). This is the same technique the open-source `open-carrusel` project
(MIT, github.com/Hainrixz/open-carrusel) uses: chat-authored HTML/CSS slides, Puppeteer
screenshot at exact IG pixel dimensions. Reasonable alternative to Option A if a slide leans
more "UI-styled card" than "hand-drawn map typography" — but it does NOT already have Hebrew
bidi handling wired in, so `He()`-style pre-processing (or `dir="rtl"` + testing the actual
render) is still needed for Hebrew copy.

### Option C — lightweight one-off (no build step)

`scripts/og-cards.html` is a third, simpler pattern already in the repo: a plain HTML file
with `<canvas>` drawing, opened directly via `file://` in a browser, Hebrew right-aligned,
"Download" button per canvas, no dependencies at all. Good only for something this simple
(a single branded card); not built for an 8-slide sequence.

### Not recommended here

External AI carousel makers (PostNitro, Contentdrips, Virale, Canva/Figma templates) were
surveyed and are fine general tools, but none of them carry RushPoint's Hebrew-RTL + Contour
Kinetics brand system — using one means re-deriving both from scratch inside someone else's
template constraints. Skip unless doing a fast, brand-agnostic draft.

---

## Sources

- Paharia, Keinan, Avery and Schor — *The Underdog Effect: The Marketing of Disadvantage
  and Determination through Brand Biography*, Journal of Consumer Research —
  https://academic.oup.com/jcr/article-abstract/37/5/775/2907483
- Pierce, Kostova and Dirks — psychological ownership, the three routes —
  https://yukaichou.com/gamification-analysis/psychological-ownership-pierce-kostova-dirks-mine-ness/
- Berger — *Contagious* / STEPPS, social currency —
  https://knowledge.wharton.upenn.edu/article/contagious-jonah-berger-on-why-things-catch-on/
- Carousel hook formulas — https://contentdrips.com/blog/2026/06/carousel-hook-examples/
- Carousel best practices and benchmarks —
  https://carouselli.com/blog/instagram-carousel-best-practices
- Zeigarnik effect and open loops —
  https://blog.neuromarket.co/the-power-of-open-loops-using-the-zeigarnik-effect-to-create-irresistible-content
- Pubity background — https://simonowens.substack.com/p/a-couple-teenagers-launched-a-media
