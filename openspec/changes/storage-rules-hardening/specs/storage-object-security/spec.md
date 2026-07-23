## ADDED Requirements

### Requirement: Only prefixes the product uses are writable

The Storage rules SHALL grant write access only to object prefixes that product code actually
writes and that a deletion path can actually clean. Any prefix with no writer, no reader, or no
cleanup path SHALL be denied.

In particular, a prefix that is writable by any authenticated identity but is not covered by run
deletion, game purge, account deletion, or the data-retention prune SHALL NOT exist, because objects
written there can never be erased.

#### Scenario: A legacy prefix with no code path is denied

- **WHEN** any authenticated client attempts to upload to the legacy v1 check-in prefix
- **THEN** the write is denied

#### Scenario: A prefix no server writes is not readable

- **WHEN** any authenticated client attempts to read the unused public-stream prefix
- **THEN** the read is denied

#### Scenario: An unmatched path is denied

- **WHEN** a client attempts to read or write a path matching no declared prefix
- **THEN** both the read and the write are denied

### Requirement: Participant uploads are bound to the authenticated identity

A participant SHALL be able to write only under the prefix belonging to their own team within a run,
where the team segment equals the authenticated uid. Writing under another team's prefix SHALL be
denied, and an unauthenticated client SHALL NOT be able to write at all.

#### Scenario: A participant uploads to their own team folder

- **WHEN** an authenticated participant uploads an allowed image or audio object under their own
  run/team prefix
- **THEN** the write succeeds

#### Scenario: A participant cannot upload into another team's folder

- **WHEN** an authenticated participant uploads to a prefix whose team segment is a different uid
- **THEN** the write is denied

#### Scenario: A signed-out client cannot upload

- **WHEN** an unauthenticated client attempts any upload
- **THEN** the write is denied

### Requirement: Participant media is readable only by its owner and that run's staff

Reading a participant's uploaded object by path SHALL be permitted only to the participant who owns
it and to staff whose credentials are scoped to that same run. Every other identity — another
participant, staff of a different run, and an unauthenticated client — SHALL be denied, for both
reading an object and listing the folder that contains it.

#### Scenario: The owning participant reads their own object

- **WHEN** the participant who uploaded an object reads it by path
- **THEN** the read succeeds

#### Scenario: Another participant is denied

- **WHEN** a different participant reads or lists that object's folder
- **THEN** both are denied

#### Scenario: Staff are scoped to their own run

- **WHEN** staff whose credentials are scoped to the run read an object from that run
- **THEN** the read succeeds
- **WHEN** staff whose credentials are scoped to a different run read the same object
- **THEN** the read is denied

### Requirement: Size and content type are enforced by the rules

Object size and content type SHALL be constrained by the Storage rules themselves, not only by the
client. Uploads above the per-prefix size cap SHALL be denied. Content types SHALL be restricted to
the media the product actually produces, and SHALL exclude image formats that carry executable
content, on every writable prefix.

#### Scenario: An oversized upload is denied

- **WHEN** a participant uploads an object larger than the participant-prefix size cap
- **THEN** the write is denied

#### Scenario: A non-media content type is denied

- **WHEN** a participant uploads an object declaring a document or text content type
- **THEN** the write is denied

#### Scenario: Executable image content is denied everywhere

- **WHEN** any client uploads an object declaring an SVG content type, on either the participant
  prefix or the creator-media prefix
- **THEN** the write is denied

#### Scenario: A media type outside the allowlist is denied

- **WHEN** a participant uploads an audio object whose type is not one of the produced audio types
- **THEN** the write is denied

### Requirement: A tenant's object tree is not enumerable by others

Listing the contents of a creator's authored-media prefix SHALL be permitted only to that creator.
Fetching a single object by its exact path MAY remain public, because the product renders authored
media from stored download links, but the ability to DISCOVER which objects exist SHALL NOT be
granted to other identities.

This matters because creator identifiers are published in the world-readable gallery index, so an
enumerable prefix would expose media attached to private, unpublished, or pending-purge games.

#### Scenario: A stranger cannot enumerate a creator's media

- **WHEN** an unauthenticated client, or a different creator, lists a creator's authored-media prefix
- **THEN** the listing is denied

#### Scenario: The owning creator can enumerate their own media

- **WHEN** a creator lists their own authored-media prefix
- **THEN** the listing succeeds

#### Scenario: Rendering an authored media object still works

- **WHEN** any client fetches an authored media object by its exact path
- **THEN** the fetch succeeds

### Requirement: Creator media is writable only by its owning creator

Authored task media SHALL be writable only by the creator whose identifier forms the prefix. Neither
another creator nor a participant SHALL be able to write or overwrite an object there.

#### Scenario: Another creator cannot write into the prefix

- **WHEN** a creator uploads to a prefix keyed by a different creator's identifier
- **THEN** the write is denied

#### Scenario: A participant cannot overwrite creator media

- **WHEN** a participant uploads to a creator's authored-media prefix
- **THEN** the write is denied

### Requirement: Storage delete prefixes cannot widen or escape

Every Storage cleanup in the backend is a prefix delete, so the prefix SHALL be produced by a total
function that refuses any identifier which would widen or escape the intended scope. An absent,
empty, or whitespace-only identifier SHALL cause the derivation to fail rather than produce a
broader prefix, and an identifier containing a path separator SHALL be refused.

Purging a creator's entire media tree SHALL be reachable only by explicitly omitting the game
identifier; an empty game identifier SHALL NOT be treated as "all games".

A refused derivation SHALL be logged and skipped without aborting the surrounding deletion, matching
the best-effort contract of the existing cleanup helpers.

#### Scenario: A blank identifier does not widen the prefix

- **WHEN** a run prefix is derived from an empty or whitespace-only run identifier
- **THEN** the derivation fails instead of returning the prefix covering every run

#### Scenario: An identifier containing a separator is refused

- **WHEN** a prefix is derived from an identifier containing a path separator
- **THEN** the derivation fails

#### Scenario: An empty game identifier is not "all games"

- **WHEN** a creator-media prefix is derived with an empty game identifier
- **THEN** the derivation fails rather than returning the whole-creator-tree prefix

#### Scenario: Omitting the game identifier purges the whole tree

- **WHEN** a creator-media prefix is derived with the game identifier explicitly omitted
- **THEN** the whole-creator-tree prefix is returned, so account deletion erases every authored object

### Requirement: Game purge and retention cover uploaded objects

Destroying a game SHALL delete the uploaded objects of every one of its runs and the game's
authored media, including when the game has no runs. The data-retention prune SHALL delete a
finished run's uploaded objects along with its stored participant identifiers, so no uploaded object
outlives the record it belongs to.

#### Scenario: A purge covers runs and authored media together

- **WHEN** the set of Storage prefixes for a game purge is derived
- **THEN** it contains one prefix per run plus the game's authored-media prefix

#### Scenario: A game with no runs still purges its authored media

- **WHEN** a game with zero runs is purged
- **THEN** the authored-media prefix is still included

#### Scenario: Retention removes a finished run's objects

- **WHEN** a finished run passes the data-retention window and is pruned
- **THEN** the run's uploaded objects are deleted alongside its raw participant data
