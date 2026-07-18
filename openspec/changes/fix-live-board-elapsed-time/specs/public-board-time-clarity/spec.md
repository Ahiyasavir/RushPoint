# public-board-time-clarity Specification (delta)

## ADDED Requirements

### Requirement: Elapsed time is visually distinct from a completion time
On the public leaderboard, a team's per-row time SHALL be presented as a final completion time only
when the team has finished (`finishedAt` is set). A still-playing team's ever-growing elapsed time
MUST be rendered in a visually distinct, labelled style so a viewer cannot mistake it for a final
time.

#### Scenario: Finished team shows a final time
- **WHEN** a leaderboard row is for a team with `finishedAt` set
- **THEN** its time renders in the standard completion-time style, labelled as the finish time

#### Scenario: Still-playing team shows a distinct elapsed time
- **WHEN** a leaderboard row is for a team without `finishedAt` on a live board (only an elapsed
  `durationSeconds`)
- **THEN** its time renders in a distinct style (dimmed, marked) and is labelled as elapsed / still
  playing, not as a completion time
