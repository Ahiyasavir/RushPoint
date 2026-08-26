# answer-log Specification

## ADDED Requirements

### Requirement: Every graded submission is recorded on the team document
The server SHALL append an entry to `RunTaskRecord.answerLog` for every participant submission it
grades, on EVERY run — not only on a `testMode` game. An entry SHALL carry the submission text, the
server's own verdict (`correct`), the server instant (`at`), and the `kind` of submission that
produced it (`answer`, `ordering`, `sequence_step`, `station_code`, `survey`). The verdict recorded
MUST be the same one the grading path acted on, written from the same decision — never re-derived
afterwards.

#### Scenario: A wrong answer is recorded, not just counted
- **WHEN** a team submits a wrong answer to a quiz task on an ordinary (non-`testMode`) run
- **THEN** the task record's `answerLog` gains an entry with that text and `correct: false`
- **AND** the response the participant receives is unchanged

#### Scenario: The winning answer is recorded
- **WHEN** a team submits the correct answer and the task completes
- **THEN** the task record's `answerLog` gains an entry with that text and `correct: true`

#### Scenario: Ordering, sequence steps and station codes are recorded
- **WHEN** a team submits an ordering arrangement, a sequence step, or a smart-station code
- **THEN** an entry is recorded with the matching `kind`
- **AND** a sequence-step entry also carries its `stepIndex`

#### Scenario: A replayed identical submission does not double-record
- **WHEN** the wrong-answer replay guard identifies a submission the server already graded
- **THEN** no new entry is appended

### Requirement: The log is bounded so a team document cannot be inflated
Each entry's text SHALL be trimmed and truncated to `MAX_ANSWER_LOG_ANSWER_LEN` characters, and each
task's log SHALL hold at most `MAX_ANSWER_LOG_ENTRIES` entries. When the cap is reached the append
SHALL preserve the OLDEST entries and the NEWEST entry, dropping from the middle — so both "what
they tried first" and "what they finally submitted" survive. The append helper MUST be total: a
malformed existing log, a non-string answer, or an empty answer yields a valid array rather than a
throw.

#### Scenario: Overlong text is truncated
- **WHEN** a submission longer than `MAX_ANSWER_LOG_ANSWER_LEN` is recorded
- **THEN** the stored text is truncated to that length

#### Scenario: A brute-forcing device cannot grow the log without bound
- **WHEN** a team submits more than `MAX_ANSWER_LOG_ENTRIES` answers to one task
- **THEN** the log holds exactly `MAX_ANSWER_LOG_ENTRIES` entries
- **AND** the first entry recorded and the most recent entry are both still present

#### Scenario: Unusable input records nothing
- **WHEN** the submission text is empty, whitespace-only, or not a string
- **THEN** no entry is appended and the existing log is returned unchanged

### Requirement: The log is never readable by a participant
`answerLog` SHALL NOT be added to `sanitizeTeamForParticipant`'s allow-list, in either sealed or
unsealed mode, so it is absent from `getMyTeamState` and from every other participant payload. Only
the game owner may read it, through `getRunPlayerReport`.

#### Scenario: The participant payload omits the log
- **WHEN** a participant reads their own team state after answering
- **THEN** no `answerLog` key is present on any task record
- **AND** this holds whether or not the game seals scoring

### Requirement: Recorded answers are destroyed after 30 days
A retention sweep SHALL strip `answerLog` from every team document of any run whose retention anchor
is older than `ANSWER_LOG_RETENTION_DAYS` (30), independently of and earlier than the existing 90-day
PII prune. Scores, per-mission verdicts, timings and attempt counts SHALL survive the strip — only
the free-typed submission text is destroyed. The sweep MUST be idempotent and MUST stamp the run so
a later pass skips it.

#### Scenario: Answer text is gone after the window
- **WHEN** the sweep runs against a run finished more than 30 days ago
- **THEN** every team's task records carry no `answerLog`
- **AND** each record's `earnedScore`, `status` and timings are unchanged

#### Scenario: A recent run is untouched
- **WHEN** the sweep runs against a run finished 3 days ago
- **THEN** its answer logs are left intact

#### Scenario: The 90-day PII prune also strips the log
- **WHEN** `pruneRunPII` runs on a run whose answer logs somehow survived
- **THEN** the logs are stripped as part of that prune
