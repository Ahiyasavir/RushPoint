# answer-submission Specification

## Purpose
TBD - created by archiving change auth-anticheat-hardening. Update Purpose after archive.
## Requirements
### Requirement: Server enforces per-task answer attempt limits
`submitTaskAnswer` SHALL read the task's `smart.attemptLimit` and refuse further answers once a team
has reached it, preventing server-side brute-forcing of quiz/numeric answer keys. The per-task count
is persisted as `taskAttempts[taskId]` (a map key on the team document, never an array element) and
MUST be incremented inside the same transaction that scores the answer, so the count cannot be raced.
When a task has no `attemptLimit`, current behavior (unlimited attempts) is preserved.

#### Scenario: Attempts past the cap are refused
- **WHEN** a team submits wrong answers to a task with `attemptLimit: 3` and exceeds the cap
- **THEN** the over-limit submission fails with `resource-exhausted`
- **AND** a correct answer submitted while locked is also refused

#### Scenario: Tasks without a limit are unchanged
- **WHEN** a team answers a task that has no `attemptLimit`
- **THEN** submissions are accepted with no attempt ceiling

