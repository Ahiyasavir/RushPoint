# streak-momentum Specification

## Purpose
TBD - created by archiving change streak-momentum. Update Purpose after archive.
## Requirements
### Requirement: Streak counter is computed from completed task states
A `computeStreak` pure function SHALL count consecutive completed tasks (no skip, no timeout gap)
from the current stage's task states and MUST reset the streak when a task is skipped or when the
gap between consecutive completions exceeds `breakMultiplier × medianTaskMs` (default multiplier: 2).

#### Scenario: Consecutive completions increment the streak
- **WHEN** a team completes 3 tasks in a row without skipping or significant gaps
- **THEN** `computeStreak` returns `{ streak: 3, milestone: 3 }`

#### Scenario: A skip resets the streak
- **WHEN** a skipped task appears in the sequence
- **THEN** the streak count resets to 0 at that point

#### Scenario: A long gap breaks the streak
- **WHEN** the time between two consecutive completions exceeds `breakMultiplier × medianTaskMs`
- **THEN** the streak is broken and counting restarts from the next completion

#### Scenario: Milestone thresholds are reported
- **WHEN** the streak reaches exactly 3, 5, or 10
- **THEN** `computeStreak` returns the corresponding `milestone` value

### Requirement: Streak counter is displayed on the play screen
The play screen SHALL show a streak chip (hidden below 2) with a milestone animation at 3, 5, and 10.
The animation MUST be suppressed when `prefers-reduced-motion` is active.

#### Scenario: Chip appears at streak 2+
- **WHEN** a team's streak reaches 2
- **THEN** the "🔥 N in a row!" chip is visible on the play screen

#### Scenario: Chip is hidden with streak < 2
- **WHEN** the streak is 0 or 1
- **THEN** the chip is not rendered

#### Scenario: Reduced-motion suppresses animation
- **WHEN** `prefers-reduced-motion: reduce` is active
- **THEN** the milestone animation class is not applied

