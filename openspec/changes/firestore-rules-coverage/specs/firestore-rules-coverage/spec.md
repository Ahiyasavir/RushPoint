## ADDED Requirements

### Requirement: A game document cannot be destroyed by a client

Security rules SHALL deny every client delete of a game document, regardless of whether the game is
tombstoned. Destruction of a game SHALL happen only through the server, which destroys the game
subtree, its public gallery entries, its access codes, its stored photos and media, and records the
destruction in the audit trail as one act.

#### Scenario: Owner attempts a direct delete of a live game
- **WHEN** an authenticated owner deletes their own game document directly
- **THEN** the delete SHALL be denied
- **AND** the game SHALL remain, so that deletion can only proceed through the server path that
  produces a recoverable tombstone

#### Scenario: Owner attempts a direct delete of a trashed game
- **WHEN** an authenticated owner deletes a game document that already carries a tombstone
- **THEN** the delete SHALL be denied, because permanent destruction is the server's explicit
  purge operation and not a document write

#### Scenario: A deleted game stops being publicly readable
- **WHEN** a published game is deleted
- **THEN** no client-reachable path SHALL leave the game's public gallery entry or its public task
  entries behind, so a deleted game is never still world-readable

### Requirement: Every tombstone field is immutable to clients

Security rules SHALL deny any client write to a game document that introduces, changes or removes
ANY field of the deletion record, not only the deletion timestamp. The check SHALL be total: a
document carrying only part of a deletion record SHALL still produce a definite allow or deny rather
than an evaluation failure.

Ordinary fields of a tombstoned game SHALL remain writable by its owner, so the guard constrains the
deletion record only.

#### Scenario: Client changes who deleted the game
- **WHEN** an authenticated owner writes a different value for the deleting-actor field on a
  tombstoned game
- **THEN** the write SHALL be denied

#### Scenario: Client removes the deleting-actor field
- **WHEN** an authenticated owner removes the deleting-actor field while leaving the deletion
  timestamp in place
- **THEN** the write SHALL be denied

#### Scenario: Client clears the deletion timestamp by field deletion
- **WHEN** an authenticated owner deletes the deletion-timestamp field from a tombstoned game
- **THEN** the write SHALL be denied

#### Scenario: Client restarts the grace period
- **WHEN** an authenticated owner writes a later deletion timestamp onto a tombstoned game
- **THEN** the write SHALL be denied

#### Scenario: Ordinary edits of a trashed game still work
- **WHEN** an authenticated owner edits a non-deletion field of a game that is in the trash, leaving
  the deletion record untouched
- **THEN** the write SHALL be allowed

### Requirement: A creator's trash is private to that creator

Security rules SHALL confine tombstoned games to their owner: no other authenticated user SHALL be
able to read a tombstoned game document or enumerate another creator's games collection.

#### Scenario: Another creator reads a trashed game
- **WHEN** an authenticated user who does not own the game reads its tombstoned document
- **THEN** the read SHALL be denied

#### Scenario: Another creator lists the trash
- **WHEN** an authenticated user who does not own the games collection enumerates it
- **THEN** the listing SHALL be denied

#### Scenario: The owner lists their own games
- **WHEN** the owner enumerates their own games collection
- **THEN** the listing SHALL be allowed, including the tombstoned documents the trash view is
  derived from

### Requirement: Public gallery documents are readable by anyone and writable by no client

Security rules SHALL keep the public gallery collections world-readable and client-unwritable, so no
client can forge or inflate any ranking signal, copy counter, like record, or published location
field on content it does or does not own.

#### Scenario: Anyone reads the public task library
- **WHEN** an unauthenticated visitor reads a public task document
- **THEN** the read SHALL be allowed

#### Scenario: Client writes a published location
- **WHEN** any client writes the published area field of a public task document
- **THEN** the write SHALL be denied

#### Scenario: Client inflates another creator's gallery entry
- **WHEN** an authenticated user writes to a public game document they do not own
- **THEN** the write SHALL be denied

### Requirement: A staff token is confined to the run it was minted for

Security rules SHALL scope a staff session to exactly one run of one creator: a staff token whose
claims name a different creator or a different run SHALL NOT reach this run's data.

#### Scenario: Staff of another creator
- **WHEN** a staff token minted for a different creator reads a team document of this run
- **THEN** the read SHALL be denied

#### Scenario: Staff of another run of the same creator
- **WHEN** a staff token minted for a different run of the same creator reads a team document of
  this run
- **THEN** the read SHALL be denied

### Requirement: Run-scoped state is unwritable by every client verb

Security rules SHALL deny clients not only create and update but also delete on run-scoped state, so
that no client can remove a team, score or live-ops document any more than it can alter one.

#### Scenario: Client deletes a team document
- **WHEN** an authenticated owner or participant deletes a team document
- **THEN** the delete SHALL be denied
