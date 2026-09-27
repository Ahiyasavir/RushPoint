## Decisions

### D1: the shape

```ts
interface AnswerOutcome {
  id: string;                 // stable, for the report
  label?: string;             // button text when the question uses buttons
  accepts?: string[];         // text matches (quiz matcher); for buttons, defaults to [label]
  range?: { min: number; max: number };   // numeric questions only, inclusive
  points: number;             // >= 0, integer
  message?: string;           // shown to the team when this outcome is hit
}
Task.answerOutcomes?: AnswerOutcome[];   // 2–10; smart_station, quiz or numeric
Task.unmatchedPoints?: number | null;    // absent/null ⇒ unmatched = wrong answer
Task.revealOutcomePoints?: boolean;      // show "(+50)" on buttons
```

On a `smart_station` mission the outcomes REPLACE `smart.secretCode` (one or the other; validation
refuses both), each outcome's `accepts` being its code(s) and `label` the operator-facing name printed
on its QR card. Mutually exclusive with `answers`/`orderItems` on a quiz and with `numericAnswer` on a numeric (the
same exclusivity rule survey already follows). Validation refuses overlaps: the same text in two
outcomes, or overlapping ranges, because "which one wins" must never be a guess. (Alternative
"first match wins" rejected: an author reordering outcomes would silently change scoring.)

### D2: matching, one pure function

`matchAnswerOutcome(task, raw) → { outcomeId, points, message } | { unmatched: true }` in shared.
Text: trim + lowercase exactly as `matchesTaskAnswer` and `verifyStationCode` do today, PLUS two
Hebrew-safe additions applied to outcome matching only: internal whitespace collapsed and niqqud
(U+0591–U+05C7) stripped, so "זַעְתָּר" and "זעתר " both hit "זעתר". Existing single-answer quizzes and
single-code stations keep today's exact comparison (no silent re-grading of live games). Numbers: the same strict `Number()` parse numeric uses today. Total.

### D3: points under each preset

Both `verifyStationCode` (station codes) and `submitTaskAnswer` (questions) call
`matchAnswerOutcome`; a station code matching no outcome is "Incorrect code" exactly as today (attempt
counted, `attemptLimit` enforced). `completeTaskForTeam` accepts `extras.awardOverride` (a non-negative finite integer). Where
`earnedScore` is computed (`functions/src/runs/index.ts`, the `earnedScore` block):
- `fixed_points_speed`: `earnedScore = awardOverride` instead of `taskScoreFixed(task)`; the route-level
  speed bonus is unchanged.
- `smart_weighted`: `earnedScore = awardOverride` (a fixed award; the time sigmoid does not apply to
  it). Documented in the Builder: "points by answer are fixed; speed does not change them".
- `time_only`: no points exist. The Builder allows only outcomes with 0 points in a time_only game and
  shows the reason; an unmatched answer still behaves as wrong, so outcomes still decide "counts or not".
- Multipliers applied after the base (hot zone, power-ups) apply as they do to any mission.
`earnedScore` is stamped on the record, so live and final standings stay a function of the stored team
document (the parity rule). The answer log records `outcomeId`.

### D4: secrecy

`answerOutcomes` is server-secret (points and accepted texts). The participant sanitizer emits
`choices` = outcome labels when every outcome has a label (buttons mode), plus the points only when
`revealOutcomePoints`. `sharedGameView.ts` lists the new fields as WITHHELD (its guard requires every
`Task` field to be declared). `searchTaskLibrary`/`publicTasks` strip them with the other keys.
`scripts/e2e-verify.mjs` `ALLOWED_TASK_KEYS` is unchanged (nothing new reaches the participant except
`choices`, already allowed) and a new assertion checks outcomes never appear in `getMyTeamState`.

### D5: the editors and the QR sheet

Station code mission: "several codes" toggle → rows of [code | points | name on the card]. The Run
Console's printable station QR sheet (`StationQrPrint`) prints one labelled QR per code, so the
operator can hand out the right card; the QR payload format is unchanged per code.

Questions:

In the question editor, a mode "points by answer" beside "one right answer": rows of
[answer(s) | points | optional message], "+ add answer", the "anything else" row (off = wrong, on =
N points), buttons vs typed vs number. The preset rule of D3 is shown inline.

## Test strategy

- Pure: `scripts/test-answer-outcomes.ts`: matching (text normalisation, buttons, ranges incl.
  boundaries, unmatched with and without `unmatchedPoints`), validation (overlaps, counts, negative
  points, NaN, exclusivity with `answers`), totality.
- `scripts/test-shared-game-view.ts` stays green only if the new fields are declared withheld.
- e2e (`scripts/e2e-verify.mjs`, new scenario "points by answer"). Headline case FIRST (Ahiya's
  example): a `smart_station` with codes זעתר→50 and מרווה→100; team A verifies "זעתר" → 50, team B
  "מרווה" → 100, team C "זַעְתָּר " → 50, team D "נענע" → "Incorrect code" with the attempt counted. Then: `fixed_points_speed` game, a quiz with
  outcomes X→50, Y→20: team A answers Y → `earnedScore` 20, team B answers X → 50; an unmatched answer
  counts as wrong (attempt recorded, lockout applies); a numeric outcome range boundary; the participant
  payload carries labels but no points/accepts; `smart_weighted` game awards the outcome points
  exactly; leaderboard parity (live vs final) holds.
- UI via preview: author a points-by-answer question, play it, see the outcome in the console and in
  the post-run report / Excel export. `i18n:check:strict`.
