## ADDED Requirements

### Requirement: A comma separates tags

A tags field SHALL treat a comma as a separator: text entered as a comma-separated list SHALL become
one distinct tag per segment, never a single tag containing the commas.

The system SHALL also accept the Arabic comma and the fullwidth comma as separators, because mobile
keyboard layouts used by a Hebrew-first audience produce them and neither character is meaningful
inside a tag. A line break SHALL also separate tags, so a pasted one-per-line list becomes a tag
list. Whitespace alone SHALL NOT separate tags.

The rule SHALL be discoverable from the field itself, both as text and by immediately showing the
creator the tags their input produced.

#### Scenario: Comma-separated entry produces distinct tags

- **WHEN** a creator types three names separated by commas into a tags field
- **THEN** three distinct tags are produced, one per name

#### Scenario: Separator works with or without a following space

- **WHEN** the entry uses commas with no space after them
- **THEN** the same distinct tags are produced as when a space follows each comma

#### Scenario: An alternate comma character also separates

- **WHEN** the entry separates names with an Arabic comma or a fullwidth comma
- **THEN** the names become distinct tags

#### Scenario: A multi-word tag is not split on its spaces

- **WHEN** a tag contains internal spaces and is not followed by a separator
- **THEN** it remains a single tag with its internal spacing preserved as single spaces

#### Scenario: The creator sees the result while typing

- **WHEN** a creator types a separator into a tags field
- **THEN** the interface immediately shows the resulting tags as discrete items

### Requirement: Tag list normalization is a pure, total, shared function

The system SHALL define tag normalization once, in the shared package, and SHALL apply that same
definition in the creator interface, the participant interface and the server. Normalization SHALL
be a total function: every input, including absent input, input of the wrong type, and input whose
members are of the wrong type, SHALL produce a well-formed tag list rather than an error.

Normalization SHALL be idempotent — normalizing an already-normalized list SHALL produce that same
list — so it can be applied at every layer without the layers disagreeing.

Normalization SHALL accept both a raw typed string and an already-split list, and SHALL apply the
same separator rules to the members of a list.

#### Scenario: Absent input

- **WHEN** the input is absent
- **THEN** the result is an empty tag list

#### Scenario: Wrong-typed input

- **WHEN** the input is not text and not a list
- **THEN** the result is an empty tag list and no error is raised

#### Scenario: Wrong-typed members are discarded

- **WHEN** a list contains members that are not text
- **THEN** only the text members become tags and the others are discarded

#### Scenario: Normalization is idempotent

- **WHEN** an already-normalized tag list is normalized again
- **THEN** the result is identical to the input

### Requirement: Empty, blank and duplicate segments are discarded

The system SHALL trim surrounding whitespace from every tag, SHALL collapse runs of internal
whitespace to a single space, and SHALL discard any segment that is empty after trimming — including
those produced by consecutive separators, a leading separator or a trailing separator.

The system SHALL discard characters that can spoof how a tag is displayed, specifically zero-width
and bidirectional-control characters, because tags are creator-authored text shown to strangers in a
world-readable gallery. The system SHALL NOT otherwise alter the characters of a tag.

#### Scenario: Consecutive separators produce no empty tag

- **WHEN** the entry contains two separators in a row
- **THEN** no empty tag is produced

#### Scenario: A trailing separator is tolerated

- **WHEN** the entry ends with a separator
- **THEN** the tags before it are produced and no empty tag is added

#### Scenario: Whitespace-only input

- **WHEN** the entry contains only whitespace and separators
- **THEN** the result is an empty tag list

### Requirement: De-duplication is case-insensitive and preserves the first casing

The system SHALL treat two tags that differ only by letter case as the same tag, keeping only the
first occurrence and preserving the casing exactly as it was first entered.

Case comparison SHALL be culture-invariant, so that the creator interface and the server always reach
the same result regardless of the device's locale.

#### Scenario: Identical tags are collapsed

- **WHEN** the same tag is entered twice
- **THEN** it appears once in the result

#### Scenario: Case-differing tags are collapsed to the first casing

- **WHEN** a tag is entered in one casing and then in another
- **THEN** a single tag remains, spelled as it was first entered

### Requirement: Hebrew and mixed-direction tags are preserved exactly

The system SHALL preserve Hebrew, mixed Hebrew and English, and any other non-ASCII tag text
unchanged apart from the whitespace and spoofing-character rules. The system SHALL NOT transliterate,
fold to ASCII, or strip non-ASCII characters.

Tag text SHALL be displayed with automatic direction detection, so a Hebrew tag renders
right-to-left and an English tag renders left-to-right within the same list.

#### Scenario: Hebrew tags survive intact

- **WHEN** a comma-separated list of Hebrew tags is entered
- **THEN** each Hebrew tag is produced unchanged

#### Scenario: A multi-word Hebrew tag stays one tag

- **WHEN** a Hebrew tag contains a space and is not followed by a separator
- **THEN** it remains a single tag

#### Scenario: Mixed Hebrew and English in one list

- **WHEN** a list mixes Hebrew and English tags
- **THEN** every tag is produced unchanged and each is displayed in its own reading direction

### Requirement: A stored tag list is bounded

The system SHALL enforce a maximum number of tags per item and a maximum length per tag. A tag longer
than the maximum SHALL be truncated to the maximum and re-trimmed; tags beyond the maximum count
SHALL be discarded. The count limit SHALL apply to the tags actually kept, not to the raw segments
read, so discarded duplicates and blanks do not consume the allowance.

The system SHALL clamp rather than reject: an oversized tag list SHALL NOT cause the surrounding save
to fail, because the creator interface saves automatically and losing unrelated edits over a tag
would be worse than dropping a tag.

#### Scenario: Count limit at the boundary

- **WHEN** exactly the maximum number of distinct tags is entered
- **THEN** all of them are kept

#### Scenario: Count limit exceeded

- **WHEN** more than the maximum number of distinct tags is entered
- **THEN** exactly the maximum number is kept and the rest are discarded

#### Scenario: Over-long tag is truncated

- **WHEN** a tag longer than the maximum length is entered
- **THEN** it is kept truncated to the maximum length with no trailing whitespace

#### Scenario: Duplicates do not consume the allowance

- **WHEN** the entry contains duplicates followed by further distinct tags
- **THEN** the distinct tags after the duplicates are still kept up to the maximum count

### Requirement: The server never trusts a client-supplied tag list

The server SHALL normalize and bound every tag list it receives from a client before storing it, on
both game creation and game update, and SHALL do so for a task's tags as well as a game's tags. The
server SHALL NOT rely on the client having normalized the list first.

The server SHALL apply the same normalization when copying tags into world-readable gallery
documents, so a document written before this guard existed is cleaned the next time its game is
published rather than serving unbounded content indefinitely.

When updating tags that live inside a task within a stage list, the server SHALL write a newly
constructed list rather than updating an element of the stored array in place.

#### Scenario: A hostile tag count is clamped on the server

- **WHEN** a client submits thousands of tags
- **THEN** the stored game holds no more than the maximum number of tags

#### Scenario: A hostile tag length is clamped on the server

- **WHEN** a client submits a single tag far longer than the maximum length
- **THEN** the stored tag is no longer than the maximum length

#### Scenario: A malformed tag list does not break the save

- **WHEN** a client submits a tag list of the wrong type or containing non-text members
- **THEN** the save succeeds and the stored tag list is well-formed

#### Scenario: Publishing cleans a previously unbounded list

- **WHEN** a game whose stored tags predate the server guard is published
- **THEN** the tags written into the public gallery documents are normalized and bounded

### Requirement: A task can be tagged

The task editor SHALL provide a tags field for a task, so a task's tags can be authored directly
rather than only arriving when a task is copied out of the shared library. The field SHALL follow the
same separator, normalization and display rules as the game tags field.

#### Scenario: A creator tags a task

- **WHEN** a creator enters a comma-separated list in a task's tags field
- **THEN** the task stores those tags as distinct tags

#### Scenario: Tags survive copying a task from the library

- **WHEN** a tagged task is copied out of the shared library into a game
- **THEN** the copied task carries the same tags

### Requirement: Tags are displayed wherever a tagged item is shown

The system SHALL display an item's tags as discrete chips — one visual element per tag — everywhere
the tagged item is presented: the public game gallery card, the shared task library card, the game
details being edited, and the public game promo page.

When an item has no tags the system SHALL render nothing rather than an empty container. When an item
has more tags than fit, the system SHALL show a bounded number of chips and indicate how many further
tags exist.

All interface labels around tags SHALL come from the translated dictionaries in both Hebrew and
English; no tag-related interface text SHALL be hardcoded. The tag text itself is creator-authored
and is exempt from translation.

#### Scenario: Gallery game card shows tags

- **WHEN** a public game in the gallery has tags
- **THEN** its card shows one chip per tag

#### Scenario: Task library card shows tags

- **WHEN** a task in the shared library has tags
- **THEN** its card shows one chip per tag

#### Scenario: Public promo page shows tags

- **WHEN** a public game with tags is viewed on its promo page
- **THEN** its tags are shown as chips

#### Scenario: An untagged item shows no tag area

- **WHEN** an item has no tags
- **THEN** no tag chips and no empty tag container are rendered

#### Scenario: Overflow is indicated

- **WHEN** an item has more tags than the display limit
- **THEN** the limit is shown as chips and the number of remaining tags is indicated
