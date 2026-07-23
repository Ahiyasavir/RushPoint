## MODIFIED Requirements

### Requirement: field / self_report task — GPS denial shows warning, submission still possible

A GPS denial on a check-in SHALL NEVER permanently block the participant client-side; the response
depends on whether the task needs a location. When the participant taps the check-in control and
`withLocation` invokes `onDenied` (GPS denied, unavailable, or timed out):

- For a `self_report` task, or any task marked `locationless`, the app SHALL submit the completion
  WITHOUT coordinates (via `completeTask` with the coordinates omitted). These task types need no
  location and the server does not enforce proximity for them, so a participant who declined the
  location prompt can still complete a "mark complete from anywhere" task.
- For a genuinely located `field` task (coordinates placed, not `locationless`), the app SHALL display
  the localized warning `t.task.gpsWarning` and SHALL NOT submit blind, because the server needs
  proximity coordinates. The button SHALL remain active so the participant can tap again once GPS is
  available.

The decision of whether a task may be completed without a location fix SHALL be a pure, fail-open
predicate (`canCompleteWithoutLocation` in `apps/play-web/src/lib/stuckGuards.ts`) that returns true
only for `self_report` and `locationless` tasks and defaults to false for every other or unknown task
shape. The server remains the only authority on whether a completion is allowed.

#### Scenario: GPS denied on a self_report task — completion submitted without coordinates

- **WHEN** the participant taps "Mark complete" on a `self_report` task and GPS is denied
- **THEN** `completeTask` is called with the coordinates omitted
- **THEN** no terminal GPS warning traps the participant on the task

#### Scenario: GPS denied on a locationless field task — completion submitted without coordinates

- **WHEN** the participant taps the check-in control on a `locationless` task and GPS is denied
- **THEN** `completeTask` is called with the coordinates omitted

#### Scenario: GPS denied on a located field task — warning shown, button remains enabled

- **WHEN** the participant taps "I'm here" on a located `field` task and GPS is denied
- **THEN** `t.task.gpsWarning` is displayed
- **THEN** the check-in button is re-enabled (not permanently disabled) and no blind submission is sent

#### Scenario: GPS succeeds on retry — warning cleared, task submitted with coordinates

- **WHEN** the participant taps the check-in control again after granting GPS
- **THEN** the GPS warning is cleared
- **THEN** `completeTask` is called with real coordinates
