## ADDED Requirements

### Requirement: Team-mode Join leads with create and demotes attach-device

In team mode, the participant registration step SHALL open directly on the "create a new team" form
as the primary path, without a forced up-front choice between creating a team and attaching a device.

The "attach this phone to a team that is already in" path SHALL be presented as a secondary
affordance (a demoted link, not a co-equal control) reachable from the create form, and SHALL remain
fully functional — same device-code form, same inputs, and same join action as today. Attaching
SHALL be reversible: from the attach form the player SHALL be able to return to the create form.

Solo mode SHALL be unaffected (it shows neither the toggle nor the attach affordance).

Switching between create and attach SHALL clear any pending inline error, and both affordances SHALL
be at least 44px targets with accessible names, using RTL-safe logical layout.

#### Scenario: Team-mode Join opens on the create form

- **WHEN** a player reaches the team-mode registration step
- **THEN** the create-a-team form is shown as the primary path with no forced create-vs-attach toggle

#### Scenario: Attaching a second phone is still reachable

- **WHEN** the player taps the secondary "team already in" affordance
- **THEN** the existing device-code attach form appears and its join action works as before, and a
  back affordance returns to the create form

#### Scenario: Solo mode is unchanged

- **WHEN** the run is solo mode
- **THEN** neither the attach affordance nor a create/attach toggle is shown
