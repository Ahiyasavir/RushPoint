# answer-submission Specification

## ADDED Requirements

### Requirement: Submitting an answer records it as well as grading it
Every path that grades a participant submission SHALL record that submission and its verdict into
the task record's `answerLog`, on every run — `submitTaskAnswer` (the sealed path, the correct path,
and both wrong-answer paths), `submitSequenceStep` and `verifyStationCode`. Recording MUST happen
from the same decision that graded the submission, so a stored entry can never disagree with the
score, the penalty or the response the participant received. Recording MUST NOT change any existing
outcome: the same submissions are accepted, refused, charged and cooled down as before.

#### Scenario: Grading behaviour is unchanged by recording
- **WHEN** a team answers a task with an attempt limit, a wrong-answer cost, or hint escalation
- **THEN** the attempt count, the penalty charged, the cooldown and the callable's response are
  exactly what they were before answers were recorded

#### Scenario: A recorded verdict matches the graded verdict
- **WHEN** the server grades a submission as wrong and charges for it
- **THEN** the entry recorded for that submission carries `correct: false`

#### Scenario: Recording never fails the submission
- **WHEN** recording an entry would be impossible (unusable text, a malformed existing log)
- **THEN** the submission is still graded and answered normally, with nothing recorded

### Requirement: Recording an answer does not change routing or scoring
Writing a `correct` verdict on an ordinary run SHALL NOT alter which mission routing hands out next.
The accuracy-based strength signal remains reachable only on a game that seals scoring from its
participants, so an ordinary run continues to route on measured pace.

#### Scenario: An ordinary run still routes on pace
- **WHEN** a team on a non-`testMode` game answers several questions correctly
- **THEN** routing uses the pace-derived skill ratio, exactly as before this change
