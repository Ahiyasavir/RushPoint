## ADDED Requirements

### Requirement: The guided tour judges "established" per creator account
The console SHALL decide whether a creator looks established from a signal stored under a key
scoped to that creator's uid. A signal stored for one account SHALL NOT affect the decision made
for another account signing in on the same browser.

#### Scenario: Two creators share one browser
- **WHEN** creator A has been seen holding games on this browser
- **AND** creator B signs in on the same browser and has no record of their own
- **THEN** creator B is not treated as established
- **AND** the guided tour auto starts for creator B

#### Scenario: The same creator returns
- **WHEN** a creator who has been seen holding games returns on the same browser
- **THEN** they are treated as established
- **AND** the guided tour does not auto start

#### Scenario: An unknown account assumes nothing
- **WHEN** no game count is stored for the signed in creator
- **THEN** they are not treated as established

### Requirement: A share link warns about publishing only when it would really publish
A shareable run artifact SHALL be flagged as publishing the standings on share only when the
artifact is audience facing, the run has not finished, AND the standings are not already published.

When the publish state is not supplied the artifact SHALL be flagged as publishing on share, so an
unknown state warns rather than silently revealing live standings.

#### Scenario: The board is already published on a live run
- **WHEN** the share artifacts are built for a live run whose standings are already published
- **THEN** no artifact is flagged as publishing on share

#### Scenario: The board is not yet published on a live run
- **WHEN** the share artifacts are built for a live run whose standings are not published
- **THEN** the board, ceremony and TV artifacts are flagged as publishing on share
- **AND** the join link, access code, staff link and recap are not

#### Scenario: A finished run never publishes on share
- **WHEN** the share artifacts are built for a finished run, published or not
- **THEN** no artifact is flagged as publishing on share

### Requirement: A team that needs attention surfaces its remedial control on the row
The team row action split SHALL be a function of both the team and its attention verdict. A team
whose verdict is `stuck` SHALL carry the single task skip on the row itself rather than behind the
overflow menu.

The row SHALL carry at most one control, SHALL never carry a destructive control, and every control
SHALL appear in exactly one of the two lists. A team held by the safe zone latch SHALL keep the
safety release as its single inline control whatever its attention verdict.

#### Scenario: A stuck team surfaces the task skip
- **WHEN** the row actions are built for a stuck team that is not held out of bounds
- **THEN** the single task skip is the only inline control
- **AND** the stage skip and the score adjustment stay in the overflow menu

#### Scenario: The safety release outranks the attention verdict
- **WHEN** the row actions are built for a stuck team that is also held out of bounds
- **THEN** the safety release is the only inline control
- **AND** the single task skip is in the overflow menu

#### Scenario: A calm row promotes nothing
- **WHEN** the row actions are built for a team whose verdict is `ok` or `watch`
- **THEN** no control is inline

#### Scenario: A malformed row never throws
- **WHEN** the row actions are built for a missing team or a missing verdict
- **THEN** a well formed split is returned and nothing throws

### Requirement: Each console panel reports its own load failure
A panel that fails to load its data SHALL render copy that names that panel's data, in both
languages. The survey results panel SHALL NOT render the analytics panel's error string.

#### Scenario: The survey results fail to load
- **WHEN** the survey results panel's load fails
- **THEN** it renders the survey specific error copy
- **AND** that copy exists in both the Hebrew and the English dictionary

### Requirement: The gallery mission card shows its detail affordance
The gallery mission card SHALL render a visible cue that pressing it opens the mission's full
detail, sourced from the translation dictionaries. A translated string SHALL NOT be retained solely
because a test asserts its presence.

#### Scenario: A creator browses the gallery
- **WHEN** the gallery renders a mission card
- **THEN** a visible localized "view details" cue is rendered on the card

### Requirement: An audit record never fails an action that already committed
A callable that writes a durable audit record after its own state change has committed SHALL write
that record best effort: the record SHALL still be written, and a failure to write it SHALL be
logged rather than returned to the caller as a failure of the action.

No module other than the audit module itself SHALL call the throwing audit writer directly.

#### Scenario: The audit write fails after a skip commits
- **WHEN** a single task skip commits and the audit write then fails
- **THEN** the operator receives a successful result
- **AND** the failure is logged through the best effort channel

#### Scenario: The rule is enforced structurally
- **WHEN** the callable surface is scanned
- **THEN** no source file outside the audit module calls the throwing audit writer
