## ADDED Requirements

### Requirement: The API process may serve game, run and team reads from its own memory

The system SHALL be permitted to answer a read of a game, run or team document from a copy held in
the API process instead of reading Firestore, for exactly those document kinds whose sole writer is
the API process itself.

A cached read SHALL be indistinguishable from a Firestore read of the same document at the moment
of the server's last write to it. Every caller that reads these documents today SHALL continue to
receive the same shape and the same field values.

#### Scenario: A warm read costs no Firestore read
- **WHEN** a document is already held in the cache and is read again
- **THEN** the held copy is returned
- **AND** no Firestore read is performed

#### Scenario: A cold read falls back to Firestore and warms the cache
- **WHEN** a document is not held in the cache
- **THEN** it is read from Firestore and returned
- **AND** a subsequent read of the same document is served without a Firestore read

#### Scenario: A missing document is not mistaken for a cache miss
- **WHEN** a document does not exist in Firestore
- **THEN** the caller observes the same "not found" outcome as it does today
- **AND** the absence is not cached as an existing document

### Requirement: Every server write updates the cached copy

The system SHALL update or discard the cached copy of a document as part of every write the API
process makes to that document, so that a read issued after a write never returns the pre-write
value. This coherence rests on the API process being the only writer of these documents
(`firestore.rules` denies client writes on `runs`, `teams` and their sub-collections, and the game
template is persisted through the `updateGame` callable).

#### Scenario: A read after a write reflects the write
- **WHEN** a callable writes a team document and a later callable reads that team
- **THEN** the read reflects the written value

#### Scenario: A write through one callable is visible to another
- **WHEN** one callable mutates a run document and a different callable subsequently reads it
- **THEN** the second callable observes the mutation

#### Scenario: A failed write does not leave a false cached value
- **WHEN** a write to Firestore fails
- **THEN** the cache does not retain a value that was never persisted

### Requirement: A run's team roster and location freshness are maintained in process

The system SHALL maintain, per run, the set of team documents and each team's last location
timestamp from the writes the API process already performs, so that listing a run's teams does not
require reading the teams collection or the `teamLocations` collection.

Listing a run's teams SHALL return the same rows, with the same fields and the same ordering
guarantees, as reading those collections would. When the roster for a run is not held, the
system SHALL fall back to reading Firestore.

#### Scenario: A warm team listing performs no collection reads
- **WHEN** a run's roster is held and its teams are listed
- **THEN** the returned rows match what a Firestore read would produce
- **AND** neither the teams collection nor the `teamLocations` collection is read

#### Scenario: A newly joined team appears in the listing
- **WHEN** a team joins a run whose roster is already held
- **AND** the run's teams are listed
- **THEN** the new team is present in the listing

#### Scenario: A location ping updates freshness without a collection read
- **WHEN** a team reports its location
- **AND** the run's teams are then listed
- **THEN** that team's last-location timestamp reflects the ping
- **AND** the `teamLocations` collection is not read

#### Scenario: A cold roster falls back to Firestore
- **WHEN** a run's roster is not held and its teams are listed
- **THEN** the rows are read from Firestore and returned
- **AND** the roster is held for subsequent listings

### Requirement: Cached reads never widen access

The system SHALL apply every authorization, ownership and validation check exactly as it does for a
Firestore read. Serving a value from memory SHALL NOT let a caller reach a document, a field, or a
run they could not reach before, and SHALL NOT bypass the participant sanitizer.

#### Scenario: An unauthorized caller is refused on a warm cache
- **WHEN** a caller who is not the run owner requests a run's teams and that run's roster is held
- **THEN** the request is refused with the same error as it is today

#### Scenario: Participant payloads stay sanitized
- **WHEN** a participant's team state is served from a cached game document
- **THEN** the payload carries no answer key, hint text or station secret

### Requirement: Cache memory is bounded and a cold read can be forced

The system SHALL bound the number of documents and rosters it holds so a long-lived API process
cannot grow without limit as runs accumulate, and SHALL discard entries for runs that are no longer
active. Discarding any entry SHALL only ever cost a Firestore read — never a wrong answer.

The system SHALL provide a caller-level way to force a cold read, so a read site that has reason
to distrust a held copy can re-read from Firestore.

The OPERATOR-level control is the enable flag: clearing it and restarting the API returns every
read to Firestore with no code change. There is deliberately no runtime admin command to flush the
cache — the flag plus a restart is the recovery path, and a restart drops the cache entirely.

#### Scenario: Eviction degrades to a cold read
- **WHEN** an entry is evicted and the document is read again
- **THEN** the value is read from Firestore and is correct

#### Scenario: A forced cold read bypasses the held copy
- **WHEN** a read is issued with the cache bypassed
- **THEN** the value comes from Firestore
- **AND** the held copy is refreshed from it

#### Scenario: Disabling the flag restores Firestore reads
- **WHEN** the enable flag is cleared and the API is restarted
- **THEN** every read goes to Firestore, with no other change

### Requirement: Serving reads from memory is opt-in, and off by default

The system SHALL NOT serve reads from process memory unless explicitly configured to do so.
Correctness depends on exactly one process being the sole writer, which is a property of the
DEPLOYMENT rather than of the code: it holds for the single-process VPS API container, and does
not hold under the Firebase Functions emulator (which runs a pool of separate runtime processes)
or on auto-scaled Cloud Functions, where one process's write cannot invalidate another's copy.

Defaulting to off means an unverified topology loses a performance optimization rather than
serving stale game state. Write invalidation SHALL run regardless of the setting, so the enabled
and disabled paths do not diverge.

#### Scenario: An unconfigured deployment reads through to Firestore
- **WHEN** the cache has not been explicitly enabled
- **AND** a document is read twice
- **THEN** both reads come from Firestore
- **AND** nothing is retained in memory

#### Scenario: Enabling is explicit
- **WHEN** the cache is explicitly enabled
- **AND** a document is read twice
- **THEN** the second read is served from memory

#### Scenario: Invalidation runs either way
- **WHEN** a write occurs while the cache is disabled
- **THEN** the write still routes through the invalidation hook
