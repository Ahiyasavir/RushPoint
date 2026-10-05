# fair-final-score Specification

## Purpose
TBD - created by archiving change fair-final-score. Update Purpose after archive.
## Requirements
### Requirement: A board ranks on the points the team earned

Every leaderboard entry SHALL carry `points`, the team's earned mission points minus its
`bonusPenalty`, which is the number its own phone shows. No completion bonus and no Z-score SHALL
be added, and `fixed_points_speed` SHALL NOT add its route speed bonus at ranking time.

#### Scenario: The run of 2026-10-05
- **WHEN** two teams finish with 100 and 50 points
- **THEN** the organizer's board and the players' phones both read 100 and 50, published or not

### Requirement: A small speed bonus, only on a published or final board

A published board and the final board SHALL add `speedBonus` to each finisher: at most 10% of the
team's own points, linear from the fastest finisher (10%) to the slowest (0), and only when at
least 4 teams finished. An unpublished board SHALL carry no speed bonus. `score` SHALL equal
`points + speedBonus`.

#### Scenario: Four finishers, published
- **WHEN** four teams finish with 100 points each in 10, 20, 30 and 40 minutes and the board is published
- **THEN** the fastest reads 110 (100 + 10), the slowest 100

#### Scenario: Three finishers
- **WHEN** only three teams finish
- **THEN** no team gets a speed bonus

### Requirement: The bonus is shown, never folded in

The points and the speed bonus SHALL be shown as their own line wherever a published score with a
bonus is shown: the console boards, the player's final screen, the public board, the TV and the
ceremony screens.

#### Scenario: A team with a bonus on the public board
- **WHEN** a team reads 110 with a 10 point bonus
- **THEN** the board also shows "100 + 10 מהירות"

