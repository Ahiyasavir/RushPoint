## ADDED Requirements

### Requirement: A stored media attachment SHALL never be silently removed by a later save

Server-side media normalization SHALL distinguish media URLs that are already persisted on
a task from URLs newly introduced by the incoming payload. A URL already persisted on that
task SHALL be retained even when it no longer satisfies the current accepted-origin set.
A URL that is new in the payload and does not satisfy the accepted-origin set SHALL cause
the whole save to be refused with `invalid-argument`, naming the offending URL. Media
SHALL NOT be discarded from a task while the save reports success.

When a stored URL is retained despite failing the current accepted-origin set, the server
SHALL log a warning identifying the game, the task and the URL.

#### Scenario: A drifted stored URL survives a save from a runtime that would reject it
- **WHEN** a task holds `media: [{ kind: 'image', url: U }]`, `U` is already persisted on that task, and the saving runtime's accepted-origin set does not accept `U`
- **THEN** the save succeeds and the task still holds `media: [{ kind: 'image', url: U }]`

#### Scenario: A new off-origin URL is refused, not dropped
- **WHEN** a save introduces `media: [{ kind: 'image', url: 'https://evil.example/x.jpg' }]` on a task that does not already hold that URL
- **THEN** the callable throws `invalid-argument` and the URL appears in the message

#### Scenario: An unchanged task with no media is unaffected
- **WHEN** a task has no `media` field and is saved
- **THEN** the stored task still has no `media` field and no error is raised

### Requirement: Duplicating or translating a game SHALL re-host its media

`duplicateGame` and `translateGame` SHALL copy every stored media object from the source
game's storage prefix into the new game's storage prefix, and SHALL rewrite each `image`
and `video` `media[].url` on the copied stages to address the new prefix, before the new
game document is written. `youtube` entries SHALL be carried over unchanged. When the new
game has a different owner, the objects SHALL be copied into the new owner's prefix.

A failure to copy an object SHALL NOT abort the duplication; the affected URL SHALL be
left addressing the source object.

#### Scenario: A duplicate owns its own media
- **WHEN** a game whose task holds an uploaded image is duplicated
- **THEN** the new game's task media URL resolves to an object under the NEW game id's prefix

#### Scenario: Purging the original leaves the duplicate intact
- **WHEN** the source game is subsequently purged
- **THEN** the duplicate's media URL still resolves

#### Scenario: YouTube media is not copied
- **WHEN** a game whose task holds a `youtube` entry is duplicated
- **THEN** the entry's URL is byte-identical in the copy and no object copy is attempted for it

### Requirement: Media uploaded before a game exists SHALL be migrated on first save

Media uploaded while a game has no id SHALL be stored under a `draft` prefix. On the first
`createGame` that persists stages carrying such URLs, the server SHALL copy those objects
into the new game's prefix and rewrite the URLs before the document is written.

#### Scenario: Draft media follows the game
- **WHEN** a game is created with a task whose media URL addresses the `draft` prefix
- **THEN** the persisted URL addresses the new game's prefix and the object exists there

## MODIFIED Requirements

### Requirement: Task media authoring lives with the mission description

The task wizard SHALL present the media attachment control in the same step as the
mission description, and SHALL present it unconditionally rather than behind an opt-in
chip. `media` SHALL NOT be a member of the wizard's opt-in group set.

An upload that completes after the task has been edited SHALL NOT revert those edits: the
committed task SHALL be derived from the latest task state, not from the state captured
when the upload began.

The client SHALL validate the URL returned by the upload against the same shared predicate
the server enforces, and SHALL surface an upload error when it does not pass.

#### Scenario: The picture control is reachable without opening the last step
- **WHEN** a creator opens the task wizard's details step
- **THEN** the media attachment control is visible without any further click

#### Scenario: A slow upload does not revert a concurrent edit
- **WHEN** a creator edits the mission description while an upload is in flight, and the upload then completes
- **THEN** the task holds both the edited description and the new media entry
