## ADDED Requirements

### Requirement: The task card eyebrow uses player-facing language

The eyebrow label above the active task title SHALL use plain, participant-facing language and SHALL
NOT expose internal routing/engine terminology such as "routed" / "managed".

For a full multi-task stage (more than one task, with no reduced required count) the eyebrow SHALL
read as the player's own task, in the same friendly register as the single-task eyebrow. The
partial-stage progress eyebrow ("Stop X of Y") and the single-task eyebrow SHALL be unchanged.

This is copy only: the label selection logic and the underlying translation key SHALL remain, with
only the resolved Hebrew and English text updated, and both dictionaries SHALL stay in parity.

#### Scenario: Full multi-task stage

- **WHEN** the player is on a task in a stage that has more than one task and no reduced required
  count
- **THEN** the eyebrow reads plain player-facing copy ("Your task" / "המשימה שלכם"), not "Routed
  task" / "משימה מנוהלת"

#### Scenario: Partial and single-task stages are unchanged

- **WHEN** the stage is a partial "complete N of M" stage, or has a single task
- **THEN** the eyebrow still reads "Stop X of Y" or the single-task label respectively, exactly as
  before
