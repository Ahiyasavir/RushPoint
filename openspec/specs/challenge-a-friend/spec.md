# challenge-a-friend Specification

## Purpose
TBD - created by archiving change challenge-a-friend. Update Purpose after archive.
## Requirements
### Requirement: A single task can be shared as a standalone teaser
A participant SHALL be able to share a single task via a `?challenge=<gameId>:<taskId>` deep link plus
a branded teaser image. Opening the link MUST show a standalone, non-scoring teaser (the question
with a 30-second timer) without requiring the viewer to join a run.

#### Scenario: Challenge link opens the teaser
- **WHEN** a viewer opens `?challenge=<gameId>:<taskId>`
- **THEN** the task question is shown as a standalone timed teaser with build/join CTAs

#### Scenario: Challenge param parsing
- **WHEN** `parseChallengeParam` is given "gameId:taskId"
- **THEN** it returns `{ gameId, taskId }`
- **AND** a malformed or empty value returns null

### Requirement: Challenge answers are checked server-side without leaking the key
A new `checkChallengeAnswer` callable SHALL validate the submitted answer and return only
`{ correct }`. The task's answer key MUST never be present in any client payload.

#### Scenario: Correct and incorrect answers
- **WHEN** `checkChallengeAnswer` is called with the correct answer
- **THEN** it returns `{ correct: true }`
- **WHEN** it is called with a wrong answer
- **THEN** it returns `{ correct: false }`

#### Scenario: Answer key never leaves the server
- **WHEN** the teaser loads the task and submits an answer
- **THEN** no response payload contains the task's answer key

#### Scenario: Unpublished task is protected
- **WHEN** a non-owner challenges a task from an unpublished game
- **THEN** the call is refused

