## ADDED Requirements

### Requirement: A published game may opt in to on-demand solo play
A game SHALL carry an `allowInstantPlay` opt-in that its creator sets in the Builder, and
`publishGame` SHALL denormalize that flag onto the game's public gallery document so a player can
see whether the game is playable right now. The flag SHALL default to absent, meaning not opted in.

#### Scenario: The creator opts a game in
- **WHEN** the creator enables instant play in the Builder and the game is published
- **THEN** the public gallery document carries the opt-in
- **AND** no server-only field travels with it

#### Scenario: A game that never opted in
- **WHEN** a published game carries no opt-in
- **THEN** the public gallery document reports it as not instantly playable

### Requirement: A player may start a self-guided run of an opted-in public game
`startInstantPlay` SHALL, for a signed-in participant naming a published game that has opted in,
create a free self-guided run with its own access code, register the caller as a solo team, start
that team, and return the run context. It SHALL consume none of the owner's credits, and it SHALL
refuse a game that is unpublished or has not opted in.

#### Scenario: An opted-in game is started on demand
- **WHEN** an anonymous player calls `startInstantPlay` for an opted-in published game
- **THEN** an active self-guided run exists with the caller as a started solo team
- **AND** the caller receives the run context needed to play
- **AND** the owner's credit balance is unchanged

#### Scenario: A game that did not opt in is refused
- **WHEN** a player calls `startInstantPlay` for a published game with no opt-in
- **THEN** the call is refused
- **AND** no run, access code or team is created

### Requirement: Instant-play runs are marked as self-guided
A run created by `startInstantPlay` SHALL be flagged `selfGuided`, so scoring and standings stay
scoped to that run and billing treats it separately from an organizer-launched run.

#### Scenario: The run is distinguishable from a launched run
- **WHEN** an instant-play run is created
- **THEN** it is flagged self-guided
- **AND** its standings cover only its own teams
