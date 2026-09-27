## Why

Field report 2026-09-25: *"I want to add another kind of question that is conditional on the
answer: if they write X they get a certain number of points, if they write Y they get a different
number…"*

Today a question has one right answer set and one award:
- `quiz`: correct iff the answer matches any of `answers` (trimmed, case-folded,
  `matchesTaskAnswer` in `packages/shared/src/challenge.ts`), scored like every mission.
- `survey`: every valid response completes the mission for a FIXED `pointValue`.
- `numeric`: correct iff within `numericTolerance` of `numericAnswer`.

**Ahiya's defining example (2026-09-25):** *"there is an operator at a station and he gives the team
a certain code. If he gives them 'זעתר' they get 50 points, if he gives 'מרווה' they get 100, and so
on."* That is a `smart_station` (station code) mission, not a quiz: today it accepts exactly ONE code
(`smart.secretCode`, compared trimmed and case-folded in `verifyStationCode`,
`functions/src/index.ts:1373-1375`). So the capability must cover station codes first, and questions
second.

Nothing lets different answers or codes earn different points. Further use cases: an estimation question ("how many
steps to the gate?": closer earns more), a judgement call with a best and a good-enough answer, a
riddle whose funny alternative earns a little, a trivia question with partial credit.

Researched 2026-09-25, the part that makes this more than a UI change: **what "points" means
depends on the scoring preset.** `fixed_points_speed` scores a mission by `pointValue`
(`taskScoreFixed`), `smart_weighted` ignores `pointValue` entirely and scores by difficulty ×
a time sigmoid (`taskScoreSmart`), and `time_only` ranks by time and never adds points. The design
must say what an answer's points do under each.

## What Changes

- A **station code mission** can accept several codes, each with its own points (the operator decides
  which code to hand out: "זעתר" → 50, "מרווה" → 100). Scanning the station QR works the same way: the
  printable QR sheet prints one QR per code, labelled.
- A question can define **answer outcomes**: each outcome is a set of accepted answers (or, for a
  number, a range) and the points that outcome earns. Optionally a message shown to the team.
- It works as buttons (each outcome's label is a choice), as free text (typed answers matched like
  quiz answers today), or as a number (ranges, e.g. 90–110 → 50 points, 70–130 → 20).
- An answer matching no outcome is treated like a wrong answer (the mission's existing retry and
  wrong-answer rules), or, if the creator sets "anything else earns N", it is accepted for N points.
- The points each answer earns are secret from players, like answer keys today, unless the creator
  chooses to reveal them on the buttons.
- Under `fixed_points_speed` and `smart_weighted` the matched outcome's points are the mission's award
  (the speed bonus of `fixed_points_speed` still applies at route level). Under `time_only` points do
  not exist, so the Builder offers only "accepted / not accepted" outcomes and says why.
- The organizer's console, the post-run report and the Excel export show which outcome each team hit.

## Non-goals

- Negative points for an answer (v1 awards 0 or more; a penalty is a follow-up through the score ledger).
- Branching the ROUTE by answer (a different next mission). That is a separate, larger feature.
- AI or fuzzy matching of free text beyond today's quiz matcher.

## Surfaces

- shared: `Task.answerOutcomes`, `Task.unmatchedPoints`, `Task.revealOutcomePoints`; a pure matcher
  `matchAnswerOutcome`; validation (`validation.ts`, `gameFile.ts`); `sharedGameView.ts` declares the
  field WITHHELD; `runPlayerReport.ts`; the participant sanitizer derives `choices` from outcome labels.
- functions: `verifyStationCode` and `submitTaskAnswer` grade outcomes and passes the award into `completeTaskForTeam`
  (changed callable behaviour); `checkChallengeAnswer`; `updateGame`/`importGameFile` validation.
- creator-web: the station-code editor ("several codes, each with points") and the question editor ("points by answer"), the station QR sheet (one QR per code), console/report display. play-web: nothing
  new beyond showing the optional message (choices already render from `choices`).
