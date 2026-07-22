## ADDED Requirements

### Requirement: Already-stored public tasks are brought under the location contract

A stored public task document carrying an exact authored coordinate SHALL be repairable to the state
the current publish path would produce: no exact coordinate, and either the coarsened area the
contract permits or no location at all.

The presence of the deprecated exact-coordinate field SHALL be what identifies a document as needing
repair. The value SHALL NOT have to be parseable for the document to be repaired — a malformed
stored coordinate is still a stored coordinate in a world-readable document.

Repair SHALL remove the exact-coordinate field entirely rather than setting it to an empty value, so
that a repaired document is indistinguishable from one written by the current publish path.

#### Scenario: A legacy document for an ordinary located task

- **WHEN** the backfill repairs a public task document that carries an exact authored coordinate and
  whose authored task is an ordinary located task
- **THEN** the document no longer has an exact-coordinate field
- **AND** the document carries an approximate area that differs from the authored coordinate by at
  most the coarsening cell's half-width on each axis
- **AND** that area is the same value the current publish path would write for that task

#### Scenario: A legacy document whose stored coordinate is malformed

- **WHEN** the backfill examines a public task document whose exact-coordinate field holds a value
  that is not a usable coordinate
- **THEN** the document is still treated as needing repair and the field is still removed

#### Scenario: A document already conforming to the contract

- **WHEN** the backfill examines a public task document with no exact-coordinate field
- **THEN** no repair is produced for it and the document is not written to

### Requirement: The authored task decides what may be published, not the public document

The repair decision SHALL be made from the authored task in the owning game, not from the public
document alone. A public task document does not record whether its task hides its location or is
locationless, so the public document alone cannot distinguish a task whose point may be coarsened
from a task whose location must not be published at all.

Where the authored task is available, the repair SHALL apply the same location rule the publish path
applies, so that a backfilled document and a freshly published document of the same task agree.

#### Scenario: The authored task hides its location

- **WHEN** the backfill repairs a legacy document whose authored task hides its location
- **THEN** the repaired document carries no approximate area and no exact coordinate
- **AND** the task remains listed in the public library with its title and other public fields intact

#### Scenario: The authored task is locationless or was never placed

- **WHEN** the backfill repairs a legacy document whose authored task is locationless, has no
  coordinates, or sits on the null-island placeholder
- **THEN** the repaired document carries no location of any kind

#### Scenario: A previously published area must be withdrawn

- **WHEN** the backfill repairs a document that carries both a legacy exact coordinate and a
  previously published approximate area, and the authored task now hides its location
- **THEN** the repaired document carries neither — the stale area is removed as well as the exact
  coordinate

### Requirement: The repair fails closed when the authored task cannot be found

The repair SHALL remove the exact coordinate and publish no approximate area whenever the owning
game or the task within it cannot be resolved — because the game was deleted, was never published,
or no longer contains that task.

The backfill SHALL report how many documents took this branch separately from the total repaired, so
that an operator can see how much of a run was decided pessimistically.

#### Scenario: The owning game no longer exists

- **WHEN** the backfill repairs a legacy document whose owning game cannot be read
- **THEN** the repaired document carries no location of any kind
- **AND** the run's report counts that document as unresolved as well as repaired

#### Scenario: The task has been removed from its game

- **WHEN** the backfill repairs a legacy document whose owning game exists but no longer contains a
  task with that identifier
- **THEN** the repaired document carries no location of any kind

### Requirement: The backfill is an admin-triggered, resumable, idempotent sweep

The backfill SHALL be reachable only by a platform administrator. It SHALL NOT run on a schedule and
SHALL NOT run automatically as a side effect of any other operation.

Each invocation SHALL process a bounded number of documents and return a cursor and a completion
flag, so that a subsequent invocation can continue from where the previous one stopped and an
operator can tell when there is nothing left to do.

The sweep SHALL offer a mode that performs every read and every decision and writes nothing, and
reports what it would have changed.

Running the sweep again after it has completed SHALL repair nothing, because a repaired document no
longer meets the repair test.

#### Scenario: A non-administrator attempts the sweep

- **WHEN** a signed-in creator who is not a platform administrator invokes the backfill
- **THEN** the call is denied and no document is modified

#### Scenario: A dry run

- **WHEN** an operator invokes the backfill in its no-write mode
- **THEN** the response reports how many documents were scanned and how many would be repaired
- **AND** no document is modified

#### Scenario: Sweeping a library larger than one page

- **WHEN** an invocation reaches its document limit
- **THEN** the response reports that the sweep is not complete and returns a cursor
- **AND** invoking the backfill again with that cursor continues after the last document examined

#### Scenario: Running the sweep a second time

- **WHEN** the backfill is invoked again after a run that repaired every legacy document
- **THEN** it reports that nothing was repaired and writes nothing
