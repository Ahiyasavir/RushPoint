## ADDED Requirements

### Requirement: A wrong answer carries a creator-configured cost
`submitTaskAnswer` SHALL charge a cost for a wrong answer on a graded task (`quiz`, `numeric`,
and the ordering variant of `quiz`). The cost is governed by a strictness **level** resolved from
`Task.wrongAnswerPenalty` when present, otherwise `Game.scoringOptions.wrongAnswerPenalty`,
otherwise `off`. The four levels are `off`, `gentle`, `standard`, `strict`. Resolution SHALL be a
single pure function in `@rushpoint/shared` so the server, the participant display and the creator
preview cannot drift.

`survey` tasks have no right answer and SHALL never be charged.

#### Scenario: A game authored before this change is unaffected
- **WHEN** a team answers wrongly in a game whose `scoringOptions.wrongAnswerPenalty` is absent
- **THEN** the resolved level is `off`
- **AND** `bonusPenalty`, `score` and retry availability are identical to the behaviour before this
  change
- **AND** no `answerPenalties` record is written to the team document

#### Scenario: A per-task level overrides the game level
- **WHEN** a game is set to `gentle` and one task carries `wrongAnswerPenalty: 'strict'`
- **THEN** wrong answers on that task are costed at `strict`
- **AND** wrong answers on every other graded task in the game are costed at `gentle`

#### Scenario: A survey response is never costed
- **WHEN** a team submits a survey response in a game set to `strict`
- **THEN** no points are charged, no cooldown is set, and no attempt is recorded

### Requirement: The cost escalates and is capped
The cost SHALL be zero for a level's first `freeAttempts` wrong answers on that task and SHALL rise
with each further wrong answer. For the k-th **charged** wrong answer (k starting at 1) the point
charge SHALL be `pointStep × k` and the retry cooldown SHALL be `min(cooldownStep × k,
maxCooldownSeconds)`.

The **cumulative points charged to one team for one task** SHALL never exceed that level's
`maxPoints`. Once the cap is reached, further wrong answers on that task SHALL charge zero points
while continuing to apply the (capped) cooldown.

The level table SHALL be:

| level | freeAttempts | pointStep | maxPoints | cooldownStep | maxCooldownSeconds |
|---|---|---|---|---|---|
| `off` | n/a | 0 | 0 | 0 | 0 |
| `gentle` | 2 | 5 | 20 | 10 | 30 |
| `standard` | 1 | 10 | 60 | 15 | 90 |
| `strict` | 0 | 15 | 150 | 30 | 180 |

New games SHALL be created at `standard`. A missing value SHALL resolve to `off`.

#### Scenario: The first wrong answer at standard is free
- **WHEN** a team gives its first wrong answer to a task at level `standard`
- **THEN** zero points are charged
- **AND** no cooldown is applied, so the team may retry immediately

#### Scenario: Escalation across successive wrong answers
- **WHEN** a team gives its 2nd, 3rd and 4th wrong answers to a task at level `standard`
- **THEN** the point charges are 10, 20 and 30 respectively (cumulative 10, 30, 60)
- **AND** the cooldowns are 15, 30 and 45 seconds respectively

#### Scenario: The point cap holds
- **WHEN** a team gives a 5th and 6th wrong answer to that same `standard` task
- **THEN** zero further points are charged, because the cumulative cap of 60 is already reached
- **AND** the cooldown continues to escalate up to its 90 second ceiling and no further

#### Scenario: The penalty can never drive a score below zero
- **WHEN** the accumulated `bonusPenalty` exceeds every point a team has earned
- **THEN** the team's ranked score is clamped at 0 by the existing `applyPenalties` floor
- **AND** the team's rank remains well-formed on both the live and the final leaderboard

### Requirement: The cost currency follows the scoring preset
The point component SHALL apply only under point-bearing presets. Under `time_only`, which awards
no points at all, the point charge SHALL be zero and the cooldown SHALL be the entire penalty.
Under `fixed_points_speed` and `smart_weighted` both components SHALL apply. The cooldown SHALL be
identical under all three presets.

#### Scenario: time_only charges time, not points
- **WHEN** a team answers wrongly past the free attempts in a `time_only` game at level `standard`
- **THEN** `bonusPenalty` is unchanged
- **AND** a retry cooldown is applied, which costs the team real race time

#### Scenario: point presets charge both
- **WHEN** the same wrong answer occurs in a `fixed_points_speed` or `smart_weighted` game
- **THEN** the charge is added to `team.bonusPenalty`
- **AND** the same retry cooldown is applied

### Requirement: The point charge rides bonusPenalty
The point charge SHALL be recorded by incrementing `RunTeam.bonusPenalty`, the same channel used
by paid hints and manual adjustments. `buildRankings` SHALL NOT be modified, so the live board
(`refreshLeaderboard`) and the final board (`finalizeRun`) reflect the identical charge.

The per-task ledger (`RunTeam.answerPenalties[taskId]`: points charged so far, the hash of the last
wrong answer, and the cooldown expiry) SHALL be written as a real nested map, never via a dotted
key and never as an array element.

#### Scenario: Live and final standings agree
- **WHEN** a team has been charged for wrong answers and the run is finalized
- **THEN** the score shown by the live leaderboard before finalization and the final ranked score
  reflect the same `bonusPenalty`
- **AND** the leaderboard invariants (each team once, contiguous ranks from 1, finite scores) hold
  on both

### Requirement: A retry is refused while the task is cooling down
While `answerPenalties[taskId].cooldownUntil` is in the future, `submitTaskAnswer` SHALL refuse the
submission with `failed-precondition` and a remaining-seconds figure, **before** the answer is
graded. Grading first would let a team submit every option during the cooldown and defeat the
deterrent entirely.

The refusal SHALL NOT record an attempt, SHALL NOT charge points, and SHALL NOT extend the
cooldown. The refusal message SHALL carry no information about the answer key. A test-drive
(rehearsal) run SHALL bypass the cooldown so a creator can rehearse without waiting.

#### Scenario: A submission during the cooldown is refused unguarded
- **WHEN** a team submits any answer, right or wrong, while the cooldown is active
- **THEN** the call fails with `failed-precondition` and the seconds remaining
- **AND** `taskAttempts[taskId]` is unchanged and `bonusPenalty` is unchanged

#### Scenario: The task is winnable again once the cooldown expires
- **WHEN** the cooldown expires and the team submits the correct answer
- **THEN** the task completes normally and routing assigns the next task

### Requirement: A duplicate submission is an idempotent replay
`submitTaskAnswer` SHALL treat a submission that normalizes to the same value as the team's last
recorded wrong answer for that task as a replay of a call the server already answered: the stored
verdict is returned, and no attempt is recorded, no points are charged and no cooldown is started
or extended. This covers a network retry, a double tap and an offline replay.

The comparison SHALL be made before grading, so a replay is safe even while the cooldown is
active.

#### Scenario: A retried wrong answer is charged once
- **WHEN** a team submits the wrong answer "42" and the same call is retried after a timeout
- **THEN** `taskAttempts[taskId]` increments by exactly 1 across both calls
- **AND** `bonusPenalty` increases by exactly one charge
- **AND** the second call returns the same wrong verdict rather than an error

#### Scenario: A different wrong answer is a genuine new attempt
- **WHEN** a team submits "42" and then "43", both wrong
- **THEN** two attempts are recorded and the escalation advances one step

#### Scenario: Correct-answer idempotence is preserved
- **WHEN** a correct submission is duplicated
- **THEN** the existing completion idempotence applies unchanged and the task scores exactly once

### Requirement: The participant knows the rule before answering
A graded task in the participant payload SHALL carry a server-computed, display-only
`answerCost` object stating the resolved level, how many free attempts remain, what the next wrong
answer would cost in points and in seconds, and the current cooldown expiry. It SHALL be derived
entirely from the team's own progress and the level table and SHALL contain no part of an answer
key.

After a wrong answer, `submitTaskAnswer` SHALL return what was just charged (`penalty`,
`cooldownUntil`, `attemptsUsed`, `replay`) so the participant app can state the cost and count the
cooldown down. All participant and creator strings SHALL be added to both dictionaries in
`i18n.ts` and read through `t.*`.

#### Scenario: The cost is shown before the first answer
- **WHEN** a team opens a graded task in a game at level `standard`
- **THEN** the answer input is accompanied by a statement of what a wrong answer will cost
- **AND** the statement is absent entirely when the resolved level is `off`

#### Scenario: The cost is shown after a wrong answer
- **WHEN** a wrong answer is charged
- **THEN** the participant sees what it cost and a countdown until they may retry
- **AND** the submit control is disabled until the countdown reaches zero

#### Scenario: The payload leaks nothing
- **WHEN** the participant payload for a graded task is inspected
- **THEN** every key is present in the sanitizer allowlist
- **AND** no answer, numeric target, ordering order or hint text is present

### Requirement: The cost composes with the existing attempt machinery
The `smart.attemptLimit` check SHALL continue to run first and keep its exact semantics: once the
limit is reached the task is locked with `resource-exhausted` and nothing further is charged. The
wrong-answer cost is the soft gradient in front of that hard wall.

`hintAutoRevealAttempts` SHALL continue to read the same `taskAttempts[taskId]` counter. Because
that counter is now maintained whenever a cost level is active (previously only when
`attemptLimit` or `hintAutoRevealAttempts` was set), a task carrying both a cost level and a hint
escalation threshold SHALL free its hint at the configured attempt count.

#### Scenario: A locked task charges nothing
- **WHEN** a team has reached `smart.attemptLimit` on a task
- **THEN** the submission fails with `resource-exhausted`
- **AND** no points are charged and no cooldown is applied or extended

#### Scenario: Guessing gets expensive, then the hint goes free
- **WHEN** a task carries `wrongAnswerPenalty: 'standard'` and `hintAutoRevealAttempts: 3`
- **THEN** the 2nd and 3rd wrong answers are charged
- **AND** once 3 wrong attempts are recorded the task's paid hint becomes free via the existing
  `isHintFree` path
