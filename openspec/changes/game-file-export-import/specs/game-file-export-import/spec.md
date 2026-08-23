## ADDED Requirements

### Requirement: A creator can export a game they own to a self-contained file

The platform SHALL provide an authenticated, owner-only callable that returns the complete
**authored template** of one of the caller's own games as a single self-describing document.

The document SHALL carry, for the game: `title`, `description`, `mode`, `scoringPreset`,
`scoringOptions`, `registrationFields`, `branding`, `tags`, `coverImage`, `approxLocation`,
`instructions`, `safeZone`, `requiresGuardianConsent`, `minAge`, `benchmarkOptOut`,
`allowInstantPlay`, `photoFeedEnabled`, `powerUpsEnabled` and `manualLeaderboardReveal`.

The document SHALL carry, for each stage in authored order: `id`, `order`, `title`, `isFinal`,
`requiredTaskCount`, `releaseAt`, `releaseAfterMinutes`, `narrative` and `exclusiveGroups`.

The document SHALL carry, for each task, every authored field, including `id`, `title`,
`description`, `type`, `coordinates`, `difficulty`, `estimatedMinutes`, `expectedDurationMinutes`,
`pointValue`, `maxConcurrentTeams`, `maxDurationMinutes`, `triggerMode`, `locationless`,
`hideLocation`, `locationClue`, `locationClueHe`, `hint`, `hintPenalty`, `hintAutoRevealMinutes`,
`hintAutoRevealAttempts`, `choices`, `answers`, `orderItems`, `surveyChoices`, `numericAnswer`,
`numericTolerance`, `geofenceRadiusMeters`, `requirePresence`, `steps`, `media`, `releaseAt`,
`releaseAfterMinutes`, `expiresAfterMinutes`, `unlockAfterTaskIds`, `tags` and the full `smart`
configuration.

#### Scenario: Owner exports a game

- **WHEN** the authenticated owner of a game requests its export
- **THEN** a document is returned containing the game's authored title, mode, scoring preset and
  options, registration fields, tags and every stage in authored order
- **AND** every task of every stage is present with its authored fields

#### Scenario: Answer keys are present in the owner's export

- **WHEN** the owner exports a game containing a quiz task with `answers`, a numeric task with
  `numericAnswer`, a sequence task whose steps carry `answer`, a smart station with
  `smart.secretCode`, and a task with a paid `hint`
- **THEN** each of those answer keys and the hint text is present in the returned document

#### Scenario: Hidden-location coordinates are present in the owner's export

- **WHEN** the owner exports a game containing a task with `hideLocation` set
- **THEN** the task's real `coordinates` and `hideLocation` flag are present in the document

#### Scenario: An unrecognised authored field is never silently dropped

- **WHEN** the `Task`, `Stage` or `Game` type gains an authored field the exporter has not been
  taught about
- **THEN** the round-trip fidelity check fails, rather than the field being omitted from exports

### Requirement: The export is owner-only and never reaches a participant surface

The platform SHALL produce a game export ONLY for the authenticated owner of that game, because
the document deliberately contains server-secret material: `answers`, the authored `orderItems`
order, `numericAnswer`, `steps[].answer`, `hint`, `smart.secretCode`, and the coordinates of
`hideLocation` tasks.

An unauthenticated caller SHALL be rejected. An authenticated caller who is not the game's owner
SHALL be rejected. The export SHALL NOT be reachable from any participant-facing or staff-facing
callable, and its content SHALL NOT be copied into `publicGames`, `publicTasks`, or any run,
team, feed or leaderboard document.

#### Scenario: A stranger cannot export another creator's game

- **WHEN** an authenticated creator requests the export of a game owned by a different creator
- **THEN** the request is denied
- **AND** no part of the game's content is returned

#### Scenario: An unauthenticated caller cannot export

- **WHEN** an unauthenticated caller requests a game export
- **THEN** the request is denied

#### Scenario: A game in the trash cannot be exported

- **WHEN** the owner requests the export of a game that has been soft-deleted
- **THEN** the request is refused as not found, consistent with every other read of a trashed game

### Requirement: The file carries an explicit schema version and refuses what it cannot read

The export document SHALL carry a format identifier and an integer schema version. On import, the
platform SHALL refuse, with a clear and specific message, any document whose format identifier is
absent or wrong, or whose schema version is absent, not an integer, or **newer than the version
this server understands**.

A refusal SHALL NOT create a game and SHALL NOT partially write one. The platform SHALL NOT
attempt to import an unknown-version document by ignoring the fields it does not recognise.

#### Scenario: A newer schema version is refused

- **WHEN** a creator imports a document whose schema version is higher than the version the server
  understands
- **THEN** the import is refused with a message naming the file's version and the supported version
- **AND** no game is created

#### Scenario: A document that is not a RushPoint game file is refused

- **WHEN** a creator imports a document with no format identifier, or a different one
- **THEN** the import is refused
- **AND** no game is created

#### Scenario: A known older schema version is accepted

- **WHEN** a creator imports a document whose schema version is one the server still understands
- **THEN** the import succeeds and produces a game

### Requirement: Import validates like any authored game and never writes a half-game

An imported document is untrusted input. The platform SHALL apply to it the same validation that
authoring through the Builder applies: structural winnability (no empty-task stage, no
uncompletable task, no negative `pointValue` / `difficulty` / `estimatedMinutes`), unlock-graph
soundness (no self-reference, no cross-stage or unknown prerequisite ids, no cycles), availability
windows (an expiry at or before a release is refused), ordering-quiz rules, survey-choice rules,
coordinate validity, and the task-media trust boundary.

When validation fails, the platform SHALL reject the import with the specific reason and SHALL NOT
create a game or leave any partially written document behind.

#### Scenario: A cyclic unlock graph is refused

- **WHEN** a creator imports a document in which two tasks in the same stage list each other in
  `unlockAfterTaskIds`
- **THEN** the import is refused naming the unlock-graph problem
- **AND** no game is created

#### Scenario: A missing required field is refused

- **WHEN** a creator imports a document whose game has no title, or a task with no `id` or no
  `type`
- **THEN** the import is refused naming the missing field
- **AND** no game is created

#### Scenario: An uncompletable task is refused

- **WHEN** a creator imports a document containing a quiz task with no answer key
- **THEN** the import is refused
- **AND** no game is created

#### Scenario: An oversized document is refused

- **WHEN** a creator imports a document exceeding the published size or count bounds
- **THEN** the import is refused naming the bound that was exceeded
- **AND** no game is created

### Requirement: Import always creates a new game, owned by the caller, that is launchable

The platform SHALL create a NEW game in the caller's own account from the imported document. It
SHALL NOT overwrite, merge into, or replace any existing game, and SHALL NOT accept a target game
id.

The created game SHALL be owned by the caller, SHALL be `private`, SHALL have a `playCount` of 0,
and SHALL carry fresh server-assigned `id`, `createdAt` and `updatedAt` values regardless of what
the document contained. The imported game SHALL be launchable without further editing whenever the
game it was exported from was launchable.

#### Scenario: Import creates a new, private, caller-owned game

- **WHEN** a creator imports a valid document
- **THEN** a new game id is returned
- **AND** that game is owned by the caller, is private, and has a play count of zero
- **AND** no other game of the caller was modified

#### Scenario: A restored game can be launched

- **WHEN** a creator imports a document exported from a launchable game
- **THEN** launching the imported game succeeds

#### Scenario: Importing a document that names another owner does not transfer ownership

- **WHEN** a creator imports a document that carries a different creator's owner id or a game id
- **THEN** those values are ignored and the created game is owned by the caller with a fresh id

### Requirement: Export and import round-trip without loss

Exporting a game, importing that document, and exporting the resulting game SHALL yield an
identical document, excluding only the server-owned identity fields (`id`, `ownerUid`,
`visibility`, `playCount`, `createdAt`, `updatedAt`, `deletedAt`, `deletedBy`) and the export
timestamp.

Round-trip fidelity SHALL hold for every task type, for optional fields both present and absent,
for Hebrew and other right-to-left text, for emoji, for stages with `requiredTaskCount`, for
exclusive groups, for unlock graphs and for media arrays.

#### Scenario: Round trip is stable for every task type

- **WHEN** a game containing at least one task of each supported type is exported, imported and
  exported again
- **THEN** the second document equals the first, excluding the server-owned identity fields

#### Scenario: Round trip preserves Hebrew, emoji and RTL text

- **WHEN** a game whose stage titles, task titles, descriptions, clues and answers contain Hebrew,
  emoji and mixed-direction text is round-tripped
- **THEN** every string is byte-identical to the original

#### Scenario: Absent optional fields stay absent

- **WHEN** a game whose tasks omit every optional field is round-tripped
- **THEN** those fields are still absent, and are not materialised as null or a default value

#### Scenario: Stage structure survives the round trip

- **WHEN** a game with a partial-completion stage, exclusive groups, an unlock graph, stage release
  timing and narrative beats is round-tripped
- **THEN** stage order, `isFinal`, `requiredTaskCount`, release timing, narrative and exclusive
  groups are all preserved exactly

### Requirement: Run history is excluded from the file

The export SHALL NOT contain runs, teams, scores, leaderboards, submitted photos, feed items,
feedback responses, location tracks, access codes, `playCount`, or any other record of the game
having been played. It SHALL NOT contain server-injected runtime values (`smart.stationCoords`,
`currentTeamCount`) or owner-private integration secrets (`integrationWebhookUrl`,
`integrationPlatform`).

#### Scenario: A played game exports the same template as an unplayed one

- **WHEN** a game that has been launched, played and finalized is exported
- **THEN** the document contains no run, team, score, leaderboard or feed data
- **AND** it is identical to the export of the same template before it was ever played

#### Scenario: The webhook secret is not exported

- **WHEN** a game with a configured Slack or Teams incoming-webhook URL is exported
- **THEN** the document contains neither the webhook URL nor the derived platform

### Requirement: The creator can export and import from the Builder

The creator console SHALL offer, from the Builder for a game, an action that downloads the game's
export document as a file, and an action that creates a new game from a chosen file. Both actions'
labels, confirmations and error messages SHALL be available in both Hebrew and English through the
translation dictionaries.

#### Scenario: Exporting from the Builder downloads a file

- **WHEN** the creator triggers the export action in the Builder
- **THEN** a file is downloaded whose name identifies the game

#### Scenario: A rejected import explains why

- **WHEN** the creator chooses a file the server refuses
- **THEN** the refusal reason is shown to the creator in the console's current language
- **AND** the Builder's current game is left untouched
