## ADDED Requirements

### Requirement: An imported game file is validated at every depth, not only at its allow-listed keys

The platform SHALL validate every value in a candidate game document before any part of it is
cloned, normalized, or written to storage — including values nested inside allow-listed fields such
as `branding`, `scoringOptions`, `safeZone`, `registrationFields`, `media`, `steps`, `answers` and
`choices`.

Validation SHALL be performed by a **pure** function that, given a parsed candidate object, returns
either a normalized game or a structured list of rejection reasons, and that **never throws** and
**never returns a partial game**. Each rejection SHALL name the offending field path and the rule it
violated.

#### Scenario: A problem nested inside an allow-listed field is found

- **WHEN** a candidate document is valid at the game, stage, task and `smart` levels but carries a
  violation inside a nested value such as `task.media`, `stage.tasks[].steps[]` or `game.branding`
- **THEN** the import is refused
- **AND** the returned reason names the path of the offending field

#### Scenario: Validation never throws

- **WHEN** any candidate document is validated, however hostile or malformed
- **THEN** the validator returns a result carrying rejection reasons
- **AND** it does not raise an exception

### Requirement: Prototype-polluting key names are refused anywhere in the document

The platform SHALL refuse a candidate game document containing an object key named `__proto__`,
`constructor` or `prototype` at any depth, including inside a stage, a task, `task.smart`,
`task.steps[]`, `task.media`, `game.branding` or `game.scoringOptions`.

Such a key SHALL be **refused and named**, not silently stripped, because a document produced by the
platform's own exporter can never contain one.

#### Scenario: A prototype-polluting key nested in a task is refused

- **WHEN** a candidate document contains a task whose `media` or `steps[]` object carries a
  `__proto__`, `constructor` or `prototype` key
- **THEN** no game is produced
- **AND** the reason names the disallowed key and where it was found

#### Scenario: Validating a hostile document does not modify the global object prototype

- **WHEN** a candidate document containing `__proto__` keys is validated
- **THEN** the runtime's base object prototype is unchanged afterwards

### Requirement: Structural size is bounded server-side

The platform SHALL enforce, on the server and independently of any client-side check, an explicit
maximum for: the total document size, the number of stages, the total number of tasks, the length of
any single string, the length of **any array** in the document, and the **nesting depth** of the
document graph.

Each bound SHALL be a named constant, and a document exceeding one SHALL be refused with a message
stating the offending field and the limit.

#### Scenario: An oversized list is refused

- **WHEN** a candidate task carries an `answers`, `choices`, `steps` or `unlockAfterTaskIds` list
  longer than the maximum array length
- **THEN** the import is refused with a message naming the field and the limit

#### Scenario: An over-deep document is refused rather than overflowing the stack

- **WHEN** a candidate document is nested more deeply than the maximum depth, supplied either as an
  object or as raw JSON text
- **THEN** the import is refused with a message naming the depth limit
- **AND** no stack-overflow error is raised

### Requirement: Values of the wrong type are refused with a named reason

The platform SHALL refuse a candidate document in which an authored field has the wrong type,
rather than accepting it and failing later. In particular: `answers`, `choices` and
`unlockAfterTaskIds` SHALL be arrays of strings; `steps` and `media` SHALL be arrays of objects;
`narrative`, `instructions`, `smart` and `coordinates` SHALL be objects; text fields SHALL be text;
and a document whose root, whose `game`, or whose `stages` is not of the expected kind SHALL be
refused.

No wrongly-typed value SHALL be able to cause an unhandled error in any validation, normalization or
persistence step that runs after the candidate is accepted.

#### Scenario: A number where a list is expected is refused, not crashed on

- **WHEN** a candidate quiz task carries `answers` as a number instead of a list of strings
- **THEN** the import is refused with a message naming the field and the expected type
- **AND** the downstream structural/completability validation is never reached with that value

#### Scenario: A top-level array or null is refused

- **WHEN** the candidate document is an array, `null`, a number, or contains a `game` that is not an
  object
- **THEN** the import is refused with a message saying the document is not a game file

### Requirement: Non-finite and out-of-range numbers are refused, never coerced

The platform SHALL refuse a candidate document containing `NaN`, `Infinity` or `-Infinity` at any
depth — including values that become non-finite only when the JSON text is parsed, such as `1e999` —
rather than coercing them to `null` or writing them to storage.

Latitude and longitude SHALL remain constrained to their valid ranges.

#### Scenario: A non-finite numeric field is refused

- **WHEN** a candidate task carries a non-finite value in `numericAnswer`, `numericTolerance`,
  `geofenceRadiusMeters`, `hintPenalty`, `pointValue` or a stage's `requiredTaskCount`
- **THEN** the import is refused with a message naming the field
- **AND** the value is not silently converted to `null`

#### Scenario: Out-of-range coordinates are refused

- **WHEN** a candidate task carries a latitude outside ±90 or a longitude outside ±180
- **THEN** the import is refused with a message naming the coordinate bounds

### Requirement: An import takes content only and assigns ownership from the caller

The platform SHALL treat a candidate game file as **content only**. Server-owned state SHALL be
assigned from the authenticated caller and the server clock, and SHALL NOT be honoured from the
file: the game's identity, owner, publish/visibility state, play count, timestamps, trash tombstone
state, integration secrets, and any wallet, credit, ranking, popularity or run identifier carried by
the file SHALL be ignored.

#### Scenario: A hand-edited file claiming another owner imports as the caller's game

- **WHEN** an authenticated creator imports a file whose game object carries `ownerUid` of another
  account, an `id`, `visibility: "public"`, a non-zero `playCount`, a trash tombstone, an
  integration webhook, or wallet/credit fields
- **THEN** a new game is created in the **caller's** account with a freshly generated id
- **AND** the created game is private with a zero play count and server-set timestamps
- **AND** none of the smuggled fields is stored

### Requirement: A legitimate export still round-trips exactly

Hardening SHALL NOT refuse any document the platform's own exporter produces. Exporting a game and
importing it SHALL preserve the authored template exactly, including Hebrew and other right-to-left
content, emoji (including zero-width-joiner sequences), and every task type.

#### Scenario: A fully-loaded Hebrew game survives export and import unchanged

- **WHEN** a game containing all supported task types, Hebrew/RTL titles, descriptions, clues and
  answers, emoji, media, an unlock graph, availability windows, ordering and survey tasks is
  exported and then imported
- **THEN** the parsed game equals the exported authored template
- **AND** no rejection reason is produced
