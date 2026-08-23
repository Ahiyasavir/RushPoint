## ADDED Requirements

### Requirement: Stage skip and out-of-bounds release confirm success
Skipping a team's whole stage and releasing a team from the out-of-bounds latch SHALL each confirm
success to the operator, consistent with the console's rule that a live-ops action must never look
like a no-op. The existing confirmation dialog on the stage skip and the immediate, unconfirmed nature
of the safety release SHALL be unchanged, and the existing failure messages SHALL be unchanged.

#### Scenario: Skipping a team's stage confirms success
- **WHEN** a creator confirms and skips a team's whole stage and the call succeeds
- **THEN** a success confirmation is shown naming the team

#### Scenario: Letting a team back in confirms success
- **WHEN** a creator releases an out-of-bounds team and the call succeeds
- **THEN** a "back in play" confirmation is shown naming the team

#### Scenario: Failure feedback is unchanged
- **WHEN** either action fails
- **THEN** the existing failure message is shown and no success confirmation appears

### Requirement: Acknowledging an alert is guarded against double-fire
The alert acknowledge control SHALL be guarded against a double-fire while its call is in flight,
consistent with the per-row guard used by the photo review queue. The control SHALL be disabled for the
duration of its own call, and the guard SHALL be per-alert so acknowledging one alert does not disable
the control on other alerts. Acknowledge behavior otherwise SHALL be unchanged.

#### Scenario: A double-tap acknowledges once
- **WHEN** a creator taps Acknowledge twice in quick succession on the same alert
- **THEN** the acknowledge call fires once and the control is disabled until it settles

#### Scenario: One alert's in-flight state does not block others
- **WHEN** one alert's acknowledge call is in flight
- **THEN** the acknowledge control on other alert rows remains enabled
