## ADDED Requirements

### Requirement: A signed-in creator can like and unlike public content

The platform SHALL let an authenticated user record a like on a public game or a public task, and
withdraw it. The mutation SHALL be a Cloud Function callable; clients SHALL NOT write the like
record or the like counter directly.

#### Scenario: Liking a public game

- **WHEN** a signed-in creator likes a public game
- **THEN** the call succeeds and reports the game's new like count as one higher

#### Scenario: Unliking a public game

- **WHEN** a creator who has liked a game unlikes it
- **THEN** the call succeeds and reports the like count back at its previous value

#### Scenario: Unauthenticated callers are rejected

- **WHEN** an unauthenticated caller attempts to like a public item
- **THEN** the call is rejected as unauthenticated and no counter changes

#### Scenario: Liking something that is not published

- **WHEN** a creator attempts to like an item id that has no public gallery document
- **THEN** the call is rejected as not-found and no like record is created

#### Scenario: A client cannot write a like record directly

- **WHEN** a signed-in client attempts to create, modify, or read a like record in Firestore directly
- **THEN** security rules reject the operation

### Requirement: One like per user per item, enforced by data shape

A user's like on a given item SHALL be represented by a single document whose identity is derived
deterministically from the item and the user, so a second like by the same user cannot create a
second record regardless of what the client sends.

#### Scenario: Repeating a like does not double-count

- **WHEN** a creator likes the same item twice in a row
- **THEN** the like count is one higher than before the first call, not two

#### Scenario: Repeating an unlike does not go negative

- **WHEN** a creator unlikes an item they have not liked, or unlikes twice in a row
- **THEN** the like count is unchanged and never drops below zero

#### Scenario: Concurrent duplicate likes settle at one

- **WHEN** the same user fires several like calls for the same item concurrently
- **THEN** the like count ends exactly one higher than it started

#### Scenario: Two different users each count once

- **WHEN** two different signed-in users each like the same item
- **THEN** the like count is two higher than before

### Requirement: Like activity is metered

The like callable SHALL be rate limited per user through the platform's existing callable
rate-limiting wrapper rather than a bespoke mechanism, so that a script cannot inflate rankings or
bill the project through unbounded calls.

#### Scenario: Excessive like calls are throttled

- **WHEN** a single user exceeds the configured like budget within the rate-limit window
- **THEN** further calls are rejected until the window resets

### Requirement: Like counts and the caller's own like state are visible

Gallery search results SHALL carry each item's like count, and SHALL tell the calling user which of
the returned items they have already liked, so the UI can render the correct state on first paint
without a second round trip and without querying the like records directly.

#### Scenario: Counts and own-state come back with search results

- **WHEN** a signed-in creator searches the gallery or the task library
- **THEN** each returned item carries its like count
- **AND** the response identifies which of the returned items the caller has liked

#### Scenario: Another user's likes are not attributed to the caller

- **WHEN** a creator searches for an item that a different user has liked but they have not
- **THEN** the item's like count includes the other user's like, and the response does not mark the
  item as liked by the caller

### Requirement: The gallery card exposes the like affordance

The creator console's gallery SHALL show, on every public game card and public task card, the
item's like count and a control to like or unlike it, reflecting the current user's own state. All
of its text SHALL come from the translation dictionaries in both Hebrew and English.

#### Scenario: Card shows count and own state

- **WHEN** a creator opens the gallery
- **THEN** each card shows its like count and whether the creator has liked it

#### Scenario: Toggling from the card is safe to repeat

- **WHEN** a creator taps the like control repeatedly
- **THEN** the displayed count moves by at most one from its starting value and settles on the
  server's reported count
