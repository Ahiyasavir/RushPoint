---
name: mission-studio
description: Invents, writes, judges and rewrites RushPoint game missions (משימות) at the highest quality, especially for teenagers 12 to 17, and audits or overhauls the mission bank. Covers the whole path from a brief to finished Hebrew mission text, adversarial review, a mechanical lint calibrated on the founder's own verdicts, and bank-ready TaskBankEntry code for apps/creator-web/src/taskBank.ts. Use for ANY request to create, improve, review, rate, delete or replace missions, mission ideas, mission bank content or a game's tasks, or "תביא לי משימות", "תכתוב משימה", "משימות לנוער", "המשימה הזאת חלשה", "הבנק משימות", even when the word "skill" or "bank" is never said.
---

# Mission studio

Ahiya (17, RushPoint founder) judges every mission as a teenager would. He rejected most of what
the bank produced for a year ("מביכות ומטומטמות"), then approved 8 of 10 missions built from a
research pass on 2026-10-20. This skill is that research turned into a procedure, plus every
lesson from his feedback since. **Its job is missions he approves on first read.**

The full research, with sources, is `docs/teen-missions-research-2026-10-20.md`. You do not need
to read it each time: the parts that drive decisions are condensed in `references/`.

## Step 0 · Read before writing anything (every time)

1. `references/lessons.md`: every rejection he gave, turned into a rule. Newest first. **These
   outrank everything else in this skill**, because each one is a mistake that already happened.
2. `references/gold-examples.md`: the missions he approved, and the near misses he rejected with
   his own words. Match the approved ones in register, length and shape. They teach more than
   any rule here.
3. `references/gates.md`: the hard gates and the scored checks. You run these in step 5.

Read these when the step needs them:
- `references/foundations.md`: why teens engage, the research in one page (step 2)
- `references/categories.md`: the 16 mission categories with seeds (step 2)
- `references/writing.md`: language, template, banned phrases (step 4)
- `references/bank-format.md`: TaskBankEntry fields and tests (step 8, only if asked)

## The workflow

Copy this into your working notes and tick it off. Skipping step 5 or 6 is how weak missions
reached him before.

```
- [ ] 1 Brief
- [ ] 2 Diverge (many raw concepts, drop the typical)
- [ ] 3 Build an engine card per survivor
- [ ] 4 Write the text
- [ ] 5 Lint + hard gates + scored checks
- [ ] 6 Adversarial readers
- [ ] 7 Present (with an honest weakness per mission)
- [ ] 8 After his feedback: log the lesson, update gold examples
```

### 1 · Brief
Settle, from the request or from defaults: audience (default: teens 13 to 16, mixed), setting
(default: a city street area), prep the creator will do (default: light), how many missions, and
**which categories are wanted**. If the request is "for the bank", look at which categories the
bank is thin in (table at the end of `references/categories.md`) and aim there first.
Ask only if the answer changes the missions completely (for example indoor vs outdoor).

### 2 · Diverge before you write
The first idea that comes to mind is the camp reflex: battle cries, pyramids, "be funny". That is
not a style problem, it is how models work: preference training pushes toward the most typical
answer (mode collapse; Verbalized Sampling, Zhang et al. 2026, raised creative diversity 1.6 to 2.1
times by asking for several candidates with how typical each one is).

So for every mission you will deliver, write **at least four raw concepts from at least three
different categories**, one line each, and mark each one `typical` / `uncommon` / `rare` (how
likely another hunt app would already have it). **Drop the typical ones**, unless it is a known
format with a twist that removes what made it typical. Keep 1.5 to 2 times more survivors than
you need, because steps 5 and 6 kill some.

Use the category seeds and the "what makes it good" line in `references/categories.md`.
Real formats beat invented ones: Taskmaster, Jet Lag, the Amazing Race, GISH, Cruel 2 B Kind, the
1930s youth movement games. Name the source format in the engine card.

### 3 · Engine card per survivor
Before any prose, fill this for each concept. If a field cannot be filled, the concept is not
ready.

```
Category / source format:
For whom: each audience tag with its one line reason (G18; a balance/aim/catch/guess game is kids):
The point, in one line (G19; "a nice photo" is not one):
Play it: one real team, simulated (seconds per try, first try success = too easy, can anyone solve it?) (L27):
Possible for EVERY team? Name a team for which it is impossible, not just hard (no bags, no shop, no bar); if one exists, make the resource certain or drop it (L30):
Event: a competitive race, or only a home game / party / one occasion (lock it) (L26):
The mechanic in one sentence:
What makes it HARD, in one sentence (if the obvious move beats it, there is no challenge):
The one constraint that removes the easy path:
Is any of it pretend play? (delete the role: is anything left to do?)
Time limit, if any: what a sharp team needs × 1.5, rounded down:
Where does it NOT work? (picture each area tag at its busiest):
Does it depend on where the team stands? Then it is located (opens on arrival):
The countable target (a number and a clock beat "until it works"):
Is getting the object a better mission than being handed it? (L22)
For multi-step missions: does EACH step pass the gates on its own? (L20)
What the team DECIDES:
How everyone contributes (could one person do it alone?):
Laziest possible completion, and is it still the mission?:
Who would WANT to break a rule here, and what stops them? (the app, the physical setup, or their own interest; "honour" is not an answer):
Proof the app gets (photo / video / numeric / quiz / geofence / code / sequence); a photo or video is shot LIVE in the app, no gallery, no camera modes or editing; video is one clip of 60 s or less of recorded time, pause and resume allowed (L31):
Creator setup, every step:
The moment they will tell a friend about tomorrow:
```

The two rejected missions in `gold-examples.md` would both have died on this card: one in the
"who would want to break a rule" line, one in "laziest completion".

### 4 · Write the text
Follow `references/writing.md`. Shape: **action, constraint, proof**, three sentences at most,
the action first. Title: three words at most, opens a question. Spoken imperative plural
(`תצלמו`, not `צלמו`). Concrete and literal: named places, numbers, order. The puzzle can be
hard; **the instructions never are.** Grant every permission they would otherwise assume is
forbidden ("מותר לכם להתפצל"). No slang, no "תהיו יצירתיים", no moral at the end.

### 5 · Lint, hard gates, scored checks
1. Run the lint on your drafts (UTF-8 JSON file, list of `{title, description}` objects):
   ```bash
   PYTHONUTF8=1 python -I .claude/skills/mission-studio/scripts/lint_mission.py drafts.json
   ```
   Fix every FAIL. Read every WARN and either fix it or know why it is fine.
   When you change the lint itself, run `... lint_mission.py evals/calibration.json --calibrate`
   (his real verdicts): no approved mission may FAIL, and every rejected one must be flagged.
   A lint that fails a mission he approved is wrong, not the mission. After each round of his
   feedback, append the round's missions to `evals/calibration.json` with `"expect"`.
2. Run the **hard gates** in `references/gates.md`. One failure means kill or redesign the
   mission. Do not soften a gate to keep a mission you like.
3. Score the **ten checks**. Under 7 means rewrite or drop.

### 6 · Adversarial readers
The writer is the worst judge of their own draft. LLM judges measurably prefer their own output
(self-preference bias, arXiv 2410.21819), and in this project a short checklist found faults its
own author could not see (taskBank.ts header, "IT WORKS"). So read each mission four more times,
as four different people, with the stated goal of **finding a fault**:

- **The confused reader**: reads only the first sentence while walking. Do they know what to
  do right now? Is any word vague ("כאן", "מכאן", "בסביבה", "משהו")?
- **The cheater**: wants the points with the least effort. What is the shortcut? Does it delete
  the mission? Which rule do they ignore, and does anything notice?
- **The embarrassed 15 year old**: where would they stand back and let someone else do it? Is
  anything performed for strangers without a role that explains it?
- **Ahiya**: would he call it "מביך", "מטומטם", "מבלבל" or "חלש"? Compare it, side by side, with
  the gold examples. Is it as good as the best of them?

Each reader must report at least one concrete weakness or say exactly why there is none. If the
user has said subagents are fine, a fresh agent with only this skill and the drafts is a better
critic than you are; otherwise do it yourself, and do it honestly.

### 7 · Present
For each mission, in Hebrew, in this order:
- **Title** (category)
- the text exactly as players see it, as a quote
- one line: type, setup, time limit, the places it is tagged for, and its family (which
  missions it can never share a game with). He checks these himself (L9, L13), so show them.
- one line: why it works (the mechanism, not praise)
- one line: **its real weakness**. He values this. Never inflate.

End with a short honest verdict. A self-assigned score is not proof; say so if you give one.
Do not put missions into the bank unless asked.

**Any document he reviews is GENERATED from the bank code, never hand-copied** (lessons L18): dump
`TASK_BANK`, render the current text, and after every change regenerate it. Under each mission he
commented on, show the new text marked "שונה לפי ההערה שלך"; list deleted missions as deleted. A
stale document makes applied fixes look ignored.

### 8 · After his feedback (do not skip)
- **How to read his feedback:** he goes through a list in order and comments only on what bothers
  him. A mission he passed without a note is APPROVED. A note on a mission he keeps is a lesson,
  not a rejection. Ask where he stopped if it is not clear; missions after that point are unread,
  not approved.
- For each rejection: write the **general lesson** in `references/lessons.md` (the pattern, his
  words verbatim, how to detect it next time, which step or gate now catches it). If a check can
  be mechanical, add it to `scripts/lint_mission.py` too.
- Move approved missions into `references/gold-examples.md`, and rejected ones into its near
  miss section **beside the fixed version**. Near misses with the fix next to them teach the most.
- If his note contradicts a rule in this skill, he wins: change the rule, and record why.

## Audiences other than teens
The bank also serves kids (10+), families at home, adults and companies. The **hard gates and
the writing rules apply to every audience** (a dead honour rule or a vague place is broken for
anyone). The teen-specific parts (embarrassment peak, status, competition) are calibrated on
13 to 16. For a kids mission, "simple" may mean simpler; for a corporate one, the 30-year-old
test in taskBank.ts rule 1 applies. Tag what is true (bank rule 13).

## Bank mode: auditing, rewriting and filling the bank
When the job is the bank rather than a handful of missions:

0. **Read his curation first** (lessons L15). His admin-page verdicts live in production
   Firestore and override the code. Read-only, from the VPS:
   ```bash
   ssh -o BatchMode=yes root@31.70.107.184 'docker exec -i rushpoint-api-1 node -e "const a=require(\"firebase-admin\");a.apps.length||a.initializeApp();a.firestore().collection(\"missionBankOverrides\").get().then(s=>{console.log(JSON.stringify(s.docs.map(d=>({key:d.id,...d.data()}))));process.exit(0)})"' > overrides.json
   ```
   `reviewedCopy: true` or any content field = **approved**: never delete or rewrite it on your
   own authority. `deleted: true` = he deleted it: delete it in code too. Content fields = his
   own text: bake it into the code, and keep it as a gold example of his voice.
1. **Dump every entry** (key, tags, title, description, type) so you judge the text the players
   see, not the comments around it.
2. **Verdict per mission. An audit is a JUDGMENT, not a lint pass** (lessons L23, L24: in round 5
   I hunted defects, fixed the copy, kept the rest, and he had a note on almost every one).
   **First question, before anything else (L28): if this mission did not exist, would I write
   it today for this audience?** If not, delete it and build a new one for the gap through the
   full workflow. Patching a weak idea gave him polished weak missions for three rounds. For
   EVERY mission that survives that question, write these lines in your notes:
   ```
   Played: one real team, simulated (seconds per try, first try success?, can anyone solve it?) (L27)
   Event: competitive race, or only a home game / party / one occasion, locked (L26)
   For whom: each audience tag, kept or dropped, with the reason (G18)
   The point: tension / story / postable result / status, in one line (G19)
   Score: the ten checks, honestly; under 7 is a rewrite or a delete
   ```
   Do these FIRST, then the text. A clean text does not save a mission with no point, and fixing
   the wording never settles the audience.
   - `keep`: passes the hard gates, scores 7+, its three lines are written, and it is not a
     weaker twin of another entry.
   - `rewrite`: the mechanic is worth keeping but the text or a rule fails (keep its `key`, so
     the recency memory and tests still recognise it, unless the act itself changes).
   - `delete`: fails a hard gate with no fix, is a drama-class warm-up, a troll, or a weaker
     duplicate. Before deleting, grep the repo for the key: tests, composer fixtures and the
     Firestore overlay (`lib/missionBankOverlay.ts`) may reference it.
   Write the reason for every verdict in one line. He reads the list.
3. **Fill the gaps by category** (coverage table in `references/categories.md`), not by count.
   Run steps 2 to 6 per batch of about eight. Inside a batch, no two missions share a mechanic
   unless they share a `family`.
4. **Generate the review document, never write it by hand** (lessons L18). Record what he has seen
   in `evals/review-state.json` (checked, changed with his note, deleted), then:
   ```bash
   npx tsx .claude/skills/mission-studio/scripts/dump_bank.ts bank.json
   python -I .claude/skills/mission-studio/scripts/review_doc.py bank.json .claude/skills/mission-studio/evals/review-state.json docs/missions-to-review-<date>.md
   ```
   Re-run both after EVERY change, so the text he reads is always the text that runs.
5. Then `references/bank-format.md`: entry shape, tags, tests. Bank changes go through the
   project's gates (CLAUDE.md), and the coverage table is updated at the end.
