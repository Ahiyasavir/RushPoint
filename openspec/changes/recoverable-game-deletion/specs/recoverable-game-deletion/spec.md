## ADDED Requirements

### Requirement: Deleting a game is reversible
Deleting a game SHALL NOT destroy any data. The system SHALL mark the game deleted with a tombstone
recording the deletion time and the acting uid, and SHALL retain the game document and every
document beneath it (runs, teams, feed items, feedback, chat, location tracks) until the game is
permanently purged.

#### Scenario: Owner deletes a game with a finished run
- **WHEN** the owner calls `deleteGame` for a game whose only run is finished
- **THEN** the call succeeds
- **AND** the game document still exists and carries `deletedAt` and `deletedBy`
- **AND** the run document and its team documents still exist unchanged

#### Scenario: A deleted game is invisible to its owner's console
- **WHEN** the owner calls `listGames` after deleting a game
- **THEN** the returned list SHALL NOT contain that game

#### Scenario: A deleted game cannot be opened
- **WHEN** the owner calls `getGame` for a deleted game
- **THEN** the call SHALL fail with `not-found`

#### Scenario: A deleted game cannot be launched, duplicated, translated or published
- **WHEN** the owner calls `launchRun`, `duplicateGame`, `translateGame` or `publishGame` for a
  deleted game
- **THEN** the call SHALL fail with `not-found`

#### Scenario: Deletion is idempotent
- **WHEN** the owner calls `deleteGame` twice for the same game
- **THEN** the second call SHALL fail with `not-found`
- **AND** the original `deletedAt` value SHALL be unchanged

### Requirement: Deleting a game with a live run is refused
The system SHALL refuse to delete a game that has any run whose status is not `finished`, and SHALL
leave the game and its runs completely untouched.

#### Scenario: Live run blocks deletion
- **WHEN** the owner calls `deleteGame` for a game with a live run
- **THEN** the call SHALL fail with `failed-precondition`
- **AND** the game SHALL NOT carry a tombstone
- **AND** the run and its access code SHALL remain usable

#### Scenario: Finalizing unblocks deletion
- **WHEN** the owner finalizes the live run and calls `deleteGame` again
- **THEN** the call SHALL succeed

### Requirement: Deletion revokes the game's access codes
Deleting a game SHALL set every access code pointing at one of that game's runs to `revoked`, so a
participant entering the code is told the code is revoked rather than hitting a dangling reference.
The access-code documents SHALL be retained (not deleted) so restore can reinstate them.

#### Scenario: A revoked code refuses a join
- **WHEN** a participant calls `getJoinInfo` or `joinRun` with the access code of a deleted game
- **THEN** the call SHALL fail with `permission-denied`

#### Scenario: Codes revoked by deletion are marked as such
- **WHEN** a game is deleted
- **THEN** each of its access codes SHALL record that this deletion revoked it, so that a later
  restore reinstates only those codes and never a code the owner revoked for another reason

### Requirement: Deletion clears every public surface
Deleting a game SHALL remove its `publicGames` entry and all of its `publicTasks` entries,
regardless of the game's visibility at the time of deletion.

#### Scenario: Deleted public game leaves the gallery
- **WHEN** a published game is deleted
- **THEN** `searchGallery` SHALL NOT return it
- **AND** `searchTaskLibrary` SHALL NOT return its tasks
- **AND** `startInstantPlay` and `checkChallengeAnswer` for that game SHALL fail with `not-found`

### Requirement: An owner can list and restore recently deleted games
The system SHALL expose the owner's tombstoned games, each with its deletion time and the moment it
becomes eligible for permanent purge, and SHALL restore any one of them to exactly the state it had
before deletion.

#### Scenario: Restoring brings the game back whole
- **WHEN** the owner restores a deleted game
- **THEN** `getGame` SHALL succeed and the tombstone fields SHALL be absent
- **AND** `listGames` SHALL include the game again
- **AND** the game's runs and teams SHALL be present and unchanged
- **AND** the access codes revoked by that deletion SHALL return to their pre-deletion status

#### Scenario: Restore does NOT re-publish
- **WHEN** the owner restores a game that was public when it was deleted
- **THEN** the game SHALL be restored as `private`
- **AND** it SHALL NOT reappear in the gallery until the owner publishes it again

#### Scenario: Restore of a purged game
- **WHEN** the owner attempts to restore a game whose grace period has already elapsed and which has
  been purged
- **THEN** the call SHALL fail with `not-found` and the owner SHALL be shown that the game is gone
  permanently

#### Scenario: Only the owner may restore
- **WHEN** a creator who does not own the game attempts to restore it
- **THEN** the call SHALL fail with `not-found` or `permission-denied` and nothing SHALL change

### Requirement: Permanent destruction happens after a grace period or on explicit request
The system SHALL permanently destroy a tombstoned game, its subtree, its access codes, its uploaded
run photos and its authored game media once the grace period since deletion has elapsed, and SHALL
also do so immediately when the owner explicitly requests permanent destruction.

#### Scenario: Grace period not yet elapsed
- **WHEN** the scheduled maintenance sweep runs while a game's grace period is still open
- **THEN** the game SHALL NOT be purged

#### Scenario: Grace period elapsed
- **WHEN** the scheduled maintenance sweep runs after a game's grace period has elapsed
- **THEN** the game document, its whole subtree, and its access codes SHALL be deleted
- **AND** the game SHALL no longer appear in the owner's recently deleted list

#### Scenario: Owner destroys early
- **WHEN** the owner explicitly requests permanent destruction of a tombstoned game
- **THEN** the same destruction SHALL happen immediately

#### Scenario: Permanent destruction requires a tombstone first
- **WHEN** permanent destruction is requested for a game that is not tombstoned
- **THEN** the call SHALL fail with `failed-precondition` and nothing SHALL be destroyed

### Requirement: The tombstone cannot be set or cleared by a client write
Security rules SHALL reject any direct client write to a game document that introduces, changes, or
removes the tombstone fields, so deletion state is only ever produced by the server.

#### Scenario: Client forges a tombstone
- **WHEN** an authenticated owner writes `deletedAt` directly onto their own game document
- **THEN** the write SHALL be denied

#### Scenario: Client clears a tombstone
- **WHEN** an authenticated owner writes to a tombstoned game document removing `deletedAt`
- **THEN** the write SHALL be denied

### Requirement: Deleting a game requires deliberate confirmation
The creator console SHALL NOT delete a game from a single confirmation click. It SHALL require the
creator to type the game's title into a confirmation field before the delete action becomes
available, and SHALL state that the game is recoverable for the grace period.

#### Scenario: Wrong title typed
- **WHEN** the creator opens the delete confirmation and types text that is not the game's title
- **THEN** the confirming action SHALL remain disabled

#### Scenario: Exact title typed
- **WHEN** the creator types the game's title exactly, ignoring surrounding whitespace
- **THEN** the confirming action SHALL become available
