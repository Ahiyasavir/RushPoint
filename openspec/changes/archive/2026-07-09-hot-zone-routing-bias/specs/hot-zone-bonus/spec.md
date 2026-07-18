## ADDED Requirements

### Requirement: Smart routing is biased toward an active hot zone
The task routing engine SHALL favor assigning a team to a candidate task whose location is within an active hot zone's `radiusMeters` over an otherwise-comparable candidate task outside the zone, using the same activation/eligibility rule already used for the score multiplier (a zone exists, its multiplier is greater than 1, and the current time is within `[startedAt, expiresAt]`). The bias SHALL be additive to the existing load/transit/skill routing factors — it MUST NOT act as a hard filter that excludes out-of-zone tasks, and a sufficiently better out-of-zone task (e.g. far less loaded, far closer) MAY still be chosen over a poorly-suited in-zone task. A task with no location (a locationless task) SHALL NOT receive the bias, since it has no coordinates to evaluate against the zone.

#### Scenario: An in-zone task is preferred over an equivalent out-of-zone task
- **WHEN** a hot zone is active and two open candidate tasks have identical load, transit, and
  difficulty, but only one task's location falls within the zone's radius
- **THEN** the in-zone task receives a higher routing score and is the one assigned

#### Scenario: The bias does not apply when no hot zone is active
- **WHEN** no hot zone is active on the run (none activated, or the previous one has expired)
- **THEN** routing scores are computed exactly as before this change, with no bonus applied

#### Scenario: The bias is a nudge, not an override
- **WHEN** an in-zone task is heavily loaded (near its `maxConcurrentTeams` cap) or far from the
  team, while a comparable out-of-zone task is unloaded and close
- **THEN** the out-of-zone task's routing score MAY still exceed the in-zone task's score

#### Scenario: Locationless tasks are unaffected
- **WHEN** a hot zone is active and a candidate task is locationless (has no coordinates)
- **THEN** that task's routing score does not receive the hot-zone bonus
