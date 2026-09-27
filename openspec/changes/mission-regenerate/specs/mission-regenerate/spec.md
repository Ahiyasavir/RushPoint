## ADDED Requirements

### Requirement: A mission offers a regenerate action

Every mission in the Builder SHALL offer a "regenerate" action that replaces it with a different
mission drawn from the mission bank. The action SHALL be reachable from the mission card's actions
menu and from the mission editor, and SHALL be available whatever the game was created from —
composed, template, library or hand-written.

The action SHALL NOT ask for confirmation, and SHALL go through the Builder's normal game-state
update so that the existing undo control reverses it.

#### Scenario: The action is offered on any mission

- **WHEN** a creator opens a mission's actions menu
- **THEN** a regenerate action is present
- **AND** it is present whether or not that mission ever came from the mission bank

#### Scenario: Regenerating is undoable

- **WHEN** a creator regenerates a mission and then presses undo
- **THEN** the mission is exactly the mission it was before the regenerate

#### Scenario: Regenerating does not interrupt the creator

- **WHEN** a creator presses regenerate
- **THEN** no confirmation dialog is shown
- **AND** the mission is replaced immediately

### Requirement: The outgoing mission's tag profile is derived from the mission itself

The system SHALL derive a bank-tag profile for the mission being replaced from that mission's own
stored content, so that a similarity comparison is possible for a mission that carries no record
of a bank origin. Derivation SHALL be total: any task, however malformed, SHALL yield a profile
rather than an error.

A dimension the mission says nothing about SHALL be absent from the profile rather than guessed.

#### Scenario: Activity is derived from the mission's interaction

- **WHEN** a profile is derived from a photo mission
- **THEN** the profile carries the camera activity tag

#### Scenario: Location is derived from the mission's placement

- **WHEN** a profile is derived from a mission marked locationless
- **THEN** the profile carries the from-anywhere tag and not the location-based tag

#### Scenario: The difficulty band is derived from the mission's own difficulty

- **WHEN** a profile is derived from a mission whose difficulty is 8
- **THEN** the profile carries the hard band tag

#### Scenario: An undeclared dimension is absent, not invented

- **WHEN** a profile is derived from a mission that says nothing about its audience
- **THEN** the profile carries no audience tag

#### Scenario: Derivation tolerates a malformed mission

- **WHEN** a profile is derived from a task with missing, null or wrongly-typed fields
- **THEN** a profile is returned and nothing throws

### Requirement: The replacement is the most similar bank mission

The system SHALL score every eligible bank mission for similarity to the outgoing mission's
profile and SHALL choose from the highest-scoring candidates. Similarity SHALL be computed over
the bank's own tag vocabulary, grouped by dimension (activity, setting, area, audience,
preparation, location and difficulty band), and SHALL be a weighted sum whose terms are named
constants rather than inline numbers.

A dimension on which the outgoing profile is silent SHALL score NEUTRAL for every candidate,
never zero, so that a mission which simply did not declare that dimension is not ranked below
every mission that did.

#### Scenario: An identical tag profile scores highest

- **WHEN** two candidates are scored against a profile
- **AND** one carries exactly the profile's tags and the other carries none of them
- **THEN** the first scores strictly higher

#### Scenario: A silent dimension does not punish candidates

- **WHEN** the outgoing profile declares no area
- **THEN** every candidate receives the same neutral area contribution
- **AND** a candidate carrying area tags does not thereby outrank one carrying none

#### Scenario: The outgoing mission is never its own replacement

- **WHEN** the outgoing mission is itself a bank mission
- **THEN** that bank entry is not eligible as its replacement

### Requirement: Repeated regeneration drifts toward a different direction

Each regeneration of the same mission SHALL be at a higher drift level than the one before it. As
the drift level rises the system SHALL:

- exclude every bank key already offered for that mission, and
- exclude the near-duplicate family of every key already offered, and
- progressively reduce the reward for matching the outgoing mission's activity kind, so that the
  candidates move toward a different kind of mission rather than around one.

At drift level zero the score SHALL be pure similarity, so a first press is the closest match
available.

#### Scenario: A first press maximises similarity

- **WHEN** a mission is regenerated for the first time
- **THEN** the chosen candidate is drawn from the closest-scoring band for that profile

#### Scenario: A second press cannot return the first suggestion

- **WHEN** a mission is regenerated twice
- **THEN** the second replacement is not the bank mission offered by the first

#### Scenario: A second press cannot return a near-duplicate of the first

- **WHEN** the first suggestion belongs to a near-duplicate family
- **THEN** no other member of that family is offered by a later press

#### Scenario: Drift moves away from the activity already shown

- **WHEN** the same mission is regenerated several times
- **THEN** the reward for sharing the outgoing mission's activity tag is lower at each higher
  drift level
- **AND** at a high drift level a candidate with a different activity can outrank one with the
  same activity that would have won at drift zero

### Requirement: Playability constraints never drift

The constraints that describe the creator's situation rather than their taste SHALL be applied as
hard exclusions at every drift level, and SHALL never be relaxed to widen the pool. A mission that
cannot be played in this game SHALL never be offered, however many times the creator presses.

#### Scenario: A venueless game is never offered a location-only mission

- **WHEN** the game is played from anywhere
- **AND** a candidate is location-based and not playable from anywhere
- **THEN** that candidate is excluded at every drift level

#### Scenario: An occasion-specific mission needs its occasion

- **WHEN** a candidate declares one or more occasions
- **AND** the game's occasion is absent or is not among them
- **THEN** that candidate is excluded at every drift level

#### Scenario: The prep budget is not widened by drift

- **WHEN** a candidate demands more preparation than the game's tolerance allows
- **THEN** that candidate is excluded at every drift level

### Requirement: The swap preserves the mission's identity and placement

Regenerating SHALL replace what the mission ASKS — its title, description, type, interaction,
difficulty and expected duration — while preserving what the game around it depends on. The task's
`id` SHALL be unchanged, so a sibling mission's prerequisite still resolves. The mission's
placement SHALL be carried over when the incoming mission can accept it.

#### Scenario: The task id survives

- **WHEN** a mission is regenerated
- **THEN** the replacement task has the same id as the mission it replaced

#### Scenario: A prerequisite pointing at the mission still resolves

- **WHEN** a sibling mission lists the regenerated mission in its unlock prerequisites
- **THEN** that prerequisite still names an existing mission after the regenerate

#### Scenario: A placed mission keeps its pin

- **WHEN** a placed mission is regenerated
- **AND** the incoming mission can be played at a fixed location
- **THEN** the replacement carries the same coordinates and geofence radius

#### Scenario: A locationless replacement does not inherit a pin

- **WHEN** the incoming mission is played from anywhere
- **THEN** the replacement is locationless and carries no coordinates

### Requirement: The pool never dead-ends

When drift and exclusion together leave no eligible candidate, the system SHALL relax the
already-offered exclusion — the softest of the constraints, and the only one that describes
history rather than playability — before reporting that nothing is available. If no candidate
exists even then, the system SHALL report that outcome and SHALL leave the mission unchanged.

#### Scenario: Exhausting the history recycles rather than fails

- **WHEN** every eligible candidate has already been offered for this mission
- **THEN** a candidate is offered again rather than nothing being returned

#### Scenario: A genuinely empty pool changes nothing

- **WHEN** no bank mission satisfies the playability constraints
- **THEN** no replacement is produced
- **AND** the mission is left exactly as it was
- **AND** the creator is told that there is nothing further to offer

### Requirement: The choice is deterministic for a given seed

The candidate choice SHALL be a pure function of the bank, the profile, the drift level, the
offered history and a seed. Given identical inputs it SHALL produce an identical result, so the
behaviour is assertable without mocking randomness.

#### Scenario: The same inputs produce the same replacement

- **WHEN** the chooser is called twice with identical bank, profile, drift, history and seed
- **THEN** both calls return the same bank key

#### Scenario: A different seed can produce a different replacement

- **WHEN** the chooser is called with the same inputs but a different seed
- **THEN** the result is drawn from the same near-best band

### Requirement: The offered history is per creator, game and mission, and fails soft

The record of which bank keys have already been offered SHALL be scoped to one creator, one game
and one mission, so that regenerating one mission does not narrow another's pool and one account's
history does not steer another's. Every storage failure SHALL degrade to an empty history or a
skipped write, and SHALL never prevent a regeneration.

#### Scenario: Two missions keep separate histories

- **WHEN** one mission has been regenerated several times
- **THEN** another mission in the same game starts from an empty history

#### Scenario: Unreadable storage still regenerates

- **WHEN** reading the history throws
- **THEN** an empty history is used and the regeneration proceeds

#### Scenario: Unwritable storage still regenerates

- **WHEN** writing the history throws
- **THEN** the regeneration still produces its replacement

#### Scenario: Malformed stored history is ignored

- **WHEN** the stored history is not the expected shape
- **THEN** it is treated as empty rather than throwing
