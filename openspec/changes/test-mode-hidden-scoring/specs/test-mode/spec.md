## ADDED Requirements

### Requirement: A game carries an opt-in test mode setting
`Game` SHALL carry an optional `testMode` boolean, authored from the creator's game settings.
Absent or `false` means the game behaves exactly as before this change. The field MUST be listed in
`BUILDER_EDITABLE_FIELDS`, because a Builder-owned field missing from that list neither saves nor
registers as a change. A single pure predicate `sealsScoreFromParticipant(game)` SHALL be the only
place the setting is interpreted, imported by the functions, creator-web and play-web alike.

#### Scenario: A game authored before this change is unaffected
- **WHEN** any run of a game whose document has no `testMode` field is played
- **THEN** score, right/wrong feedback, penalties, hint costs, leaderboard and the final screen all
  behave exactly as they did before this change

#### Scenario: The setting round-trips through the Builder
- **WHEN** the creator switches test mode on and the Builder autosaves
- **THEN** `updateGame` persists `testMode: true`
- **AND** reopening the game shows the switch still on

#### Scenario: The predicate is total
- **WHEN** `sealsScoreFromParticipant` is given a game with `testMode` absent, `false`, `true`, or a
  malformed value
- **THEN** it returns a boolean and never throws, treating anything other than `true` as not sealed

### Requirement: The participant payload carries no score on a test-mode run
On a run whose game seals scoring, `getMyTeamState` SHALL omit every score and standing value from
the payload it returns to the participant — not merely hide them in the UI. The team document MUST
be projected through an allow-list built by construction, so a field added to `RunTeam` or
`RunTaskRecord` in future is absent from the participant payload until it is deliberately allowed.

Omitted: the team's `score` and `bonusPenalty`, `smartStreak`, `streakMultiplier`, each task
record's `earnedScore` and `scoreBreakdown`, the run `leaderboard`, and the `answerCost` warning
block.

#### Scenario: Scores are absent from the wire, not just the screen
- **WHEN** a participant in a test-mode run calls `getMyTeamState`
- **THEN** the response contains no `score`, `bonusPenalty`, `smartStreak`, `streakMultiplier`,
  `earnedScore`, `scoreBreakdown`, `answerCost`, or `leaderboard` value

#### Scenario: A normal run is untouched
- **WHEN** a participant in a run whose game does not seal scoring calls `getMyTeamState`
- **THEN** the payload is identical to the payload returned before this change

#### Scenario: The owner still sees everything
- **WHEN** the run owner reads the same team through `listRunTeams`, `getRunAnalytics`,
  `getRunSummary`, `getRunRecap` or a direct Firestore read
- **THEN** the full score, breakdown and standing are present and unchanged

### Requirement: Every answer advances on a test-mode run
On a run whose game seals scoring, `submitTaskAnswer` SHALL complete the task and route the
participant onward regardless of whether the answer was correct. The per-task attempt limit, the
wrong-answer point penalty and the retry lockout MUST NOT apply, and `requestTaskHint` MUST NOT
charge. A wrong answer completes with `earnedScore: 0`.

The response MUST NOT carry a correctness verdict: the `correct` key is **omitted entirely** rather
than set to a value, so no client can read or misreport it.

#### Scenario: A wrong answer completes the task and moves on
- **WHEN** a participant submits a wrong answer in a test-mode run
- **THEN** the task's status becomes `completed` with `earnedScore: 0`
- **AND** the next task is assigned
- **AND** the response contains no `correct`, `penalty`, `attemptsUsed` or `retryAfterMs` value

#### Scenario: No lockout, cap or hint charge applies
- **WHEN** a participant submits several wrong answers in a row in a test-mode run, including on a
  task carrying `smart.attemptLimit`, and reveals a hint carrying `hintPenalty`
- **THEN** no submission is refused with `resource-exhausted`
- **AND** no retry cooldown is started
- **AND** no points are deducted from the team

#### Scenario: A correct answer is indistinguishable on the wire
- **WHEN** a participant submits a correct answer in a test-mode run
- **THEN** the response has the same shape and key set as the response to a wrong answer

### Requirement: Submissions are recorded for the creator to grade
On a run whose game seals scoring, the server SHALL record what the participant submitted and
whether it was correct on that task's `RunTaskRecord`, written inside the same transaction that
scores the answer so a submission can never exist without its verdict. The stored text MUST be
length-bounded.

Both fields MUST be absent from the participant payload in **every** game, sealed or not — a
`wasCorrect` boolean on the wire would defeat this capability entirely.

#### Scenario: The creator can see what was answered
- **WHEN** a participant answers a quiz or numeric task in a test-mode run
- **THEN** the task record carries the submitted answer and its correctness
- **AND** the run owner can read both

#### Scenario: The recorded verdict never reaches any participant
- **WHEN** any participant calls `getMyTeamState`, in a test-mode run or a normal one
- **THEN** the response contains no `wasCorrect` and no `submittedAnswer` value

#### Scenario: Nothing is recorded on a normal run
- **WHEN** a participant answers a task in a run whose game does not seal scoring
- **THEN** the task record carries neither field, exactly as before this change

### Requirement: Routing steers a struggling participant toward easier tasks
On a run whose game seals scoring, the adaptive-difficulty term SHALL derive the participant's
strength from **accuracy** rather than pace. Once a wrong answer completes a task, elapsed time
stops measuring competence — a participant answering quickly and wrongly would otherwise read as
strong and be routed the hardest questions.

Accuracy `a` over the answered records maps to a strength ratio of `1 − 2a`, feeding the existing
difficulty-match term unchanged. With no answered records the accuracy signal is unavailable and
routing MUST fall back to its current behaviour rather than invent a verdict.

#### Scenario: Wrong answers lead to easier questions
- **WHEN** a participant in a test-mode run has answered mostly incorrectly
- **AND** candidate tasks of differing `difficulty` are available
- **THEN** routing prefers a lower-difficulty candidate

#### Scenario: Correct answers lead to harder questions
- **WHEN** a participant in a test-mode run has answered everything correctly
- **THEN** routing prefers a higher-difficulty candidate

#### Scenario: No history is neutral
- **WHEN** a participant in a test-mode run has answered nothing yet
- **THEN** routing behaves as it does for a team with no measured history

#### Scenario: Normal runs keep the pace signal
- **WHEN** routing runs for a game that does not seal scoring
- **THEN** the candidate ordering is identical to the ordering produced before this change

### Requirement: A test-mode run ends on a neutral completion screen
On a run whose game seals scoring, the participant's finish SHALL present completion only — no
score, no rank, no leaderboard, and no share or story card. The public leaderboard route MUST also
be sealed for such a run even after the board is published, since it is the one participant-facing
standing that is not reached through `getMyTeamState`.

#### Scenario: The finish shows no standing
- **WHEN** a participant finishes a test-mode run
- **THEN** the screen shows a completion message with no score, rank, leaderboard or share card

#### Scenario: The public board is sealed too
- **WHEN** anyone opens the public leaderboard route for a test-mode run
- **THEN** no standing for that run is served, whether or not the board was published

### Requirement: Task-type coverage is explicit
Test mode SHALL seal every task type whose submission carries a **knowledge verdict**: quiz,
numeric, sequence and survey. For each, a submission always advances, the response omits any
correctness field, and the per-task result is recorded for the creator.

Two participant-visible verdicts are deliberately NOT sealed, and this is a decision rather than an
omission:

- **Smart-station codes.** A station code is proof of *presence* — a value read off a sign at a
  physical location — not an answer being assessed. Auto-advancing on a wrong code would let a
  participant skip the stop entirely and would break the game rather than seal it, so
  `verifyStationCode` keeps refusing an incorrect code.
- **Photo review outcomes.** A `rejected` photo MUST stay visible to the participant. Withholding
  it would leave someone whose submission was rejected with no way to know they need to resubmit —
  a stuck player with no signal, which is a worse failure than the verdict it would hide.

#### Scenario: A sequence step never reports a verdict and never blocks
- **WHEN** a participant submits a wrong step of a sequence task in a test-mode run
- **THEN** the response contains no `stepCorrect` value
- **AND** the step still advances
- **AND** the task is recorded as incorrect for the creator once the sequence completes

#### Scenario: A survey answers with the same shape as a graded task
- **WHEN** a participant answers a survey task in a test-mode run
- **THEN** the response carries the same key set as a quiz answer and contains no `correct` value

#### Scenario: A discovery waypoint reveals neither verdict nor bonus
- **WHEN** a participant answers a discovery-POI trivia prompt in a test-mode run
- **THEN** the response contains no `correct` and no `bonus` value
- **AND** the answer is final, so an unanswerable waypoint cannot be ground indefinitely

#### Scenario: A station code still refuses when wrong
- **WHEN** a participant submits an incorrect station code in a test-mode run
- **THEN** the submission is still refused, because the code proves presence rather than knowledge
