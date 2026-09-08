## ADDED Requirements

### Requirement: A located task can hide its location from the participant

A located task SHALL support a `hideLocation` boolean flag (default `false`/absent). When `true`,
the task keeps its real `coordinates` and geofence radius server-side, but those coordinates SHALL
NOT be sent to the participant in any payload. `hideLocation` is orthogonal to `TaskType` and to
`triggerMode` — it layers on a task that uses `radius` or `exact` proximity.

#### Scenario: Default is not hidden
- **WHEN** a task is created without `hideLocation`
- **THEN** its location is treated as visible (pin shown, coordinates sent as today)

#### Scenario: Hidden flag is independent of task type
- **WHEN** a `field`, `geofence`, `photo`, or `quiz` task sets `hideLocation: true` with a `radius`
  or `exact` trigger
- **THEN** the flag is accepted and the task behaves as a hidden-location task regardless of its type

---

### Requirement: A hidden-location task carries a participant-visible clue

A hidden-location task SHALL support a `locationClue` (English) and `locationClueHe` (Hebrew) text
field that IS sent to the participant to guide discovery. The clue is distinct from the paid `hint`:
the clue is always visible and free; the paid `hint` remains a point-cost reveal via
`requestTaskHint`.

#### Scenario: Clue is exposed to the participant
- **WHEN** `sanitizeTaskForParticipant` runs on a hidden-location task with a `locationClue`
- **THEN** the returned payload includes the clue text and does NOT include `coordinates`

#### Scenario: Clue is independent of the paid hint
- **WHEN** a hidden-location task has both a `locationClue` and a paid `hint`
- **THEN** the clue is present in the sanitized payload while the paid `hint` text remains stripped
  (only `hasHint`/`hintPenalty` exposed)

---

### Requirement: Coordinates and exact radius are stripped for hidden tasks

`sanitizeTaskForParticipant` SHALL remove `coordinates` from the participant payload of a
hidden-location task and SHALL emit a `locationHidden: true` flag so the client can render the
hidden-location UI. The exact geofence radius SHALL NOT be exposed for hidden tasks (so the player
cannot infer how tight the spot is).

#### Scenario: Hidden task payload omits coordinates
- **WHEN** a participant fetches state (`getMyTeamState`) for a stage containing a hidden-location task
- **THEN** that task's sanitized entry has no `coordinates` field and has `locationHidden === true`

#### Scenario: Visible task payload is unchanged
- **WHEN** the same fetch includes a non-hidden located task
- **THEN** that task's sanitized entry still includes `coordinates` and has no `locationHidden` flag

---

### Requirement: Arrival reveals success and completes the hidden task

A hidden-location task SHALL complete via the existing `completeTask` GPS gate: the server validates
the participant is within the geofence radius (`radius`/`exact`) before completing. On a successful
gate, the participant app SHALL show an arrival reveal ("you found it") and the task completes.
Default behavior is arrival = complete.

#### Scenario: Arrival within radius completes
- **WHEN** a participant calls `completeTask` for a hidden-location task with GPS inside the radius
- **THEN** completion proceeds exactly as for a visible `radius`/`exact` task and the next task is assigned

#### Scenario: Underlying station gate still applies
- **WHEN** a hidden-location task is also a station type (e.g. `photo`/`quiz`) requiring a
  submission
- **THEN** the participant must first be within the radius to check in, after which the task's own
  verification (photo/answer) proceeds as normal

---

### Requirement: The participant map suppresses pins for hidden tasks

The participant map (`NavMap`) SHALL NOT render a marker for a task whose sanitized payload has
`locationHidden === true`, and the task UI SHALL present the clue plus a "hidden location" badge
instead of a distance/direction to a marker.

#### Scenario: No marker for a hidden task
- **WHEN** the active stage contains a hidden-location task
- **THEN** no map marker is drawn for it and the participant sees the clue text and a hidden badge

#### Scenario: Visible tasks still render markers
- **WHEN** the active stage also contains a visible located task
- **THEN** that task's marker is rendered normally

---

### Requirement: A hidden task must be authorable in the Builder

The creator Builder SHALL provide a "hide location on map" toggle for a located task and a clue
input (EN/HE). A hidden task SHALL still require valid coordinates and a geofence radius. All new
UI strings SHALL route through `t.*` (i18n) and pass the i18n correctness gate.

#### Scenario: Toggling hide-location reveals the clue field
- **WHEN** a creator enables "hide location on map" on a located task
- **THEN** a clue input is shown and the task is saved with `hideLocation: true` and the entered clue

#### Scenario: Hidden task still requires coordinates
- **WHEN** a creator enables "hide location" but the task has no coordinates
- **THEN** the Builder blocks saving / flags that a hidden task still needs a real spot on the map
