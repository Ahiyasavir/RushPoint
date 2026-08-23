## ADDED Requirements

### Requirement: Primary "right now" zone

The Run Console SHALL present, above every other control, a primary zone containing only the
controls a host needs while a run is in progress: the access code with its QR, the join link, the
station-QR print action, "Start all teams", any unacknowledged alerts, the announcement broadcast,
and the live team map. Every other control SHALL live outside that zone.

#### Scenario: Live run first paint

- **WHEN** a creator opens the console of a run whose status is `live`
- **THEN** the primary zone renders the access code + QR, the join link, station-QR print, "Start
  all teams", the alerts list (if any), the announcement broadcast and the live team map
- **AND** no other panel renders inside the primary zone

#### Scenario: Advanced control is not promoted

- **WHEN** the console computes the primary zone for any run status
- **THEN** hot zone, trackables, territory, flash missions, per-team skip, manual score adjustment,
  photo moderation, the feed, chat, the standings tables, the post-run panels and the share/screen
  links are all excluded from it

### Requirement: Named collapsible groups with at-rest summaries

Every panel outside the primary zone SHALL belong to exactly one named group. Groups SHALL render
using the existing `Advanced` collapsible primitive, SHALL be collapsed by default, and SHALL expose
a summary (`meta`) that reports the group's live contents while the group is folded.

#### Scenario: Panel assignment is total and unambiguous

- **WHEN** the grouping rule is applied to the console's panel catalogue
- **THEN** every panel is assigned to exactly one group or to the primary zone
- **AND** no panel is assigned to two groups

#### Scenario: Folded group still reports its state

- **WHEN** a group is collapsed and contains 5 photos awaiting review
- **THEN** the group's header displays a summary reporting 5 items awaiting review
- **AND** the summary is derived from the same values the expanded panel would display

#### Scenario: Empty group does not render

- **WHEN** a group's panels would all be empty or inapplicable at the current run status
- **THEN** the group is not rendered at all

#### Scenario: Group open state persists for the run

- **WHEN** a creator expands a group, navigates away from the console and returns to the same run
- **THEN** that group is expanded
- **AND** groups the creator did not expand remain collapsed

### Requirement: Status-appropriate grouping

Group and panel visibility SHALL be derived from the run's status so that live-only tools do not
appear after a run is finished and post-run tools do not appear while a run is live.

#### Scenario: Finished run hides live-only tools

- **WHEN** the run's status is `finished`
- **THEN** hot zone, trackables, territory, chat and flash missions are not rendered

#### Scenario: Live run hides post-run tools

- **WHEN** the run's status is `live`
- **THEN** the run summary, analytics, heatmap and feedback panels are not rendered

### Requirement: Destructive controls are distinguished

Every action control the console offers SHALL be classified as routine, cautionary or destructive by
a single shared rule. Destructive controls SHALL be visually separated from routine controls, SHALL
carry an accessible name that states what they do and what they affect, and SHALL confirm before
acting.

#### Scenario: Manual score adjustment is named

- **WHEN** the manual score-adjustment control is rendered for a team
- **THEN** it has a visible text label rather than a bare glyph
- **AND** it exposes an accessible name that identifies both the action and the team it affects

#### Scenario: Score adjustment confirms with specifics

- **WHEN** a creator submits a score adjustment for a team
- **THEN** a confirmation states the team's display name and the signed delta before it is applied
- **AND** cancelling leaves the team's score unchanged

#### Scenario: Finalize is separated from routine controls

- **WHEN** the run is live
- **THEN** "Finalize run" is not rendered inside the same control group as "Refresh standings" or
  "Invite staff"
- **AND** it is classified destructive
- **AND** its confirmation states that the run ends for every team

#### Scenario: Classification is total

- **WHEN** the classification rule is applied to the console's control catalogue
- **THEN** every control receives exactly one classification
- **AND** finalize-run and manual score adjustment are classified destructive

### Requirement: Consolidated share and screens surface

The console SHALL present all shareable artifacts of a run through one named surface: access code,
join link, public board link, ceremony link, TV screen, recap and staff link. Each entry SHALL carry
a human-readable name and a description of who it is for. No entry SHALL be labelled only by an
emoji or icon.

#### Scenario: Every artifact is listed once

- **WHEN** the share surface is computed for a run
- **THEN** it contains exactly one entry per shareable artifact
- **AND** each entry has a non-empty name and description sourced from the translation maps

#### Scenario: Availability follows run status

- **WHEN** the run is live
- **THEN** the recap entry is marked unavailable rather than omitted silently
- **AND** the join link entry is available

#### Scenario: Copy action is labelled

- **WHEN** a share entry's copy action is rendered
- **THEN** it has an accessible name naming the artifact being copied

### Requirement: Human-readable team and task labels

The console SHALL identify teams by their display name and tasks by their title. A raw document
identifier SHALL be shown only when no human-readable name can be resolved, and only in a shortened
form clearly marked as a fallback.

#### Scenario: Alert names the team

- **WHEN** an alert is raised by a team whose display name is known
- **THEN** the alert row shows that display name
- **AND** it does not show the truncated team document id

#### Scenario: Photo queue names the task

- **WHEN** a photo submission is awaiting review for a task whose title is known
- **THEN** the pending card and the reviewed row both show the task title
- **AND** neither shows the raw task id

#### Scenario: Unresolvable identity falls back safely

- **WHEN** a team or task cannot be resolved to a name
- **THEN** a shortened identifier is shown
- **AND** the render does not throw or display an empty label

### Requirement: Run-console jargon is explained in place

The console SHALL carry an in-place explanation, reachable from the label itself and rendered with
the existing tooltip primitive, for every term that assumes prior product knowledge: flash mission
and its lifetime, announcement persistence, hot zone, and each run billing type. Field labels SHALL
NOT state implementation details in place of an explanation.

#### Scenario: Flash mission lifetime is disclosed

- **WHEN** the flash-mission control is rendered
- **THEN** the duration a flash mission stays active is stated in the interface
- **AND** it is not knowable only by reading the source

#### Scenario: Billing chip is explained

- **WHEN** a run's billing chip is rendered
- **THEN** an explanation of that billing type is reachable from the chip

#### Scenario: Explanations are localized

- **WHEN** any new explanation, label or accessible name introduced by this capability is rendered
- **THEN** its text is read from the translation maps in both Hebrew and English
- **AND** no such string is hardcoded in a component
