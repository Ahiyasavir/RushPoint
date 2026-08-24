## MODIFIED Requirements

### Requirement: Server enforces per-task answer attempt limits
`submitTaskAnswer` SHALL read the task's `smart.attemptLimit` and refuse further answers once a team
has reached it, preventing server-side brute-forcing of quiz/numeric answer keys. The per-task count
is persisted as `taskAttempts[taskId]` (a map key on the team document, never an array element) and
MUST be incremented inside the same transaction that scores the answer, so the count cannot be raced.
When a task has no `attemptLimit`, current behavior (unlimited attempts) is preserved.

**Exception — runs that seal scoring from the participant.** When the run's game seals scoring
(`sealsScoreFromParticipant`), the attempt limit MUST NOT apply, and neither MUST the replay guard
or the retry cooldown. On such a run a wrong answer is free and final: it completes the task with
`earnedScore: 0` and routing moves the participant on, so there is nothing left to brute-force —
re-submitting cannot change an already-completed task. Enforcing a cap there would instead strand
the participant on a locked task whose verdict they are not permitted to see.

#### Scenario: Attempts past the cap are refused
- **WHEN** a team submits wrong answers to a task with `attemptLimit: 3` and exceeds the cap
- **THEN** the over-limit submission fails with `resource-exhausted`
- **AND** a correct answer submitted while locked is also refused

#### Scenario: Tasks without a limit are unchanged
- **WHEN** a team answers a task that has no `attemptLimit`
- **THEN** submissions are accepted with no attempt ceiling

#### Scenario: The cap does not apply when scoring is sealed
- **WHEN** a team in a run that seals scoring submits wrong answers to a task with `attemptLimit: 3`
- **THEN** no submission fails with `resource-exhausted`
- **AND** the first submission completes the task, so later submissions cannot re-grade it

## ADDED Requirements

### Requirement: The answer response omits correctness when scoring is sealed
When the run's game seals scoring from the participant, `submitTaskAnswer` SHALL return a neutral
acknowledgement carrying no verdict. The `correct` key MUST be **omitted entirely** rather than set
to a fixed value — an always-`true` field would be a false statement on the wire that a future
client could surface. The penalty, attempt-count and retry-delay fields MUST likewise be absent,
since none of them applies on such a run.

The answer is still graded server-side and the resulting score is still written, so the creator's
scoring, ranking and analytics are unaffected.

#### Scenario: Correct and wrong answers return the same shape
- **WHEN** a participant in a run that seals scoring submits a correct answer, and another submits a
  wrong one
- **THEN** both responses carry the same key set
- **AND** neither contains `correct`, `penalty`, `attemptsUsed`, `cooldownUntil` or `retryAfterMs`

#### Scenario: Grading still happens underneath
- **WHEN** a participant in a run that seals scoring submits a correct answer
- **THEN** the task record is scored exactly as it would be on a normal run
- **AND** the owner's leaderboard and analytics reflect it
