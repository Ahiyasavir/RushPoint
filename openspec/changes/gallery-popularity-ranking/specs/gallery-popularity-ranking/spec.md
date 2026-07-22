## ADDED Requirements

### Requirement: Public gallery results are ordered most popular first

The public game gallery and the public task library SHALL return results ordered by a single
descending popularity score when no search query is supplied. The score SHALL be stored on the
gallery document so Firestore can order by it, and SHALL never be written by a client.

#### Scenario: Unfiltered gallery is popularity-ordered

- **WHEN** a signed-in creator calls `searchGallery` with an empty query
- **THEN** the returned games are in non-increasing popularity order
- **AND** a game with more real usage and more likes appears before one with less

#### Scenario: Unfiltered task library is popularity-ordered

- **WHEN** a signed-in creator calls `searchTaskLibrary` with an empty query
- **THEN** the returned tasks are in non-increasing popularity order

#### Scenario: A client cannot write the ordering field

- **WHEN** a signed-in client attempts to write `popularity` or `likeCount` directly to a
  `publicGames` or `publicTasks` document
- **THEN** Firestore security rules reject the write

### Requirement: Popularity is a pure function of usage, likes, and publication age

Popularity SHALL be computed by a single pure function exported from `@rushpoint/shared`, used by
both the server that stores the score and any client that displays or re-sorts it, so the two can
never drift. The function SHALL combine a usage count and a like count on a logarithmic scale with
a monotonic newness allowance derived from the item's creation time, and SHALL be total:
non-finite, negative, or missing inputs are clamped rather than producing `NaN`.

#### Scenario: Usage outweighs likes at equal magnitude

- **WHEN** two items have identical creation times, one with N usages and zero likes and one with
  N likes and zero usages
- **THEN** the item with N usages scores strictly higher

#### Scenario: Engagement is compressed, not linear

- **WHEN** an item's weighted engagement grows by a factor of ten
- **THEN** its engagement term grows by exactly one unit, so a runaway incumbent cannot make every
  other item's differences vanish

#### Scenario: Newer content can outrank an older incumbent

- **WHEN** an item published significantly later has meaningfully less than the incumbent's lifetime
  engagement
- **THEN** it can still score higher, because the newness allowance offsets a bounded multiple of
  engagement

#### Scenario: Scores are stable without recomputation

- **WHEN** no signal changes on an item
- **THEN** its score is unchanged no matter how much time passes, so no scheduled job is required to
  keep the ordering correct

#### Scenario: Hostile inputs do not produce NaN

- **WHEN** the function is given `NaN`, `Infinity`, a negative count, or a missing creation time
- **THEN** it returns a finite number, treating the offending input as its neutral value

### Requirement: Ranking has a deterministic total order

Ordering SHALL be a total order with explicit tiebreaks, so two callers ranking the same set always
produce the same sequence and pagination cannot repeat or skip an item.

#### Scenario: Equal scores fall through to declared tiebreaks

- **WHEN** two items have the same popularity score
- **THEN** the one with more usages is ordered first; if usages are equal the one with more likes;
  if those are equal, ascending item id

### Requirement: Search relevance takes precedence over popularity

When a search query is active, relevance SHALL be the primary sort key and popularity SHALL only
break ties within a relevance tier. A more popular weaker match SHALL NOT be ordered above a
stronger match.

#### Scenario: A title match beats a popular description match

- **WHEN** a creator searches for a term that appears in item A's title and only in item B's
  description, and B is far more popular than A
- **THEN** A is returned before B

#### Scenario: Popularity breaks ties inside one relevance tier

- **WHEN** two items match the query in the same field with the same strength
- **THEN** the more popular of the two is returned first

#### Scenario: Search does not lose candidates to a small limit

- **WHEN** a creator searches with a small `limit`
- **THEN** the server still considers the full per-call candidate cap before text filtering, and only
  trims to `limit` after ranking

### Requirement: Every usage signal keeps the stored score consistent

Any server action that changes a usage or like count on a gallery document SHALL update the counter
and recompute the stored popularity score in the same atomic operation, so the score can never be
stale relative to the counters it is derived from and concurrent bumps cannot lose an update.

#### Scenario: Launching a run counts as a play for the public game

- **WHEN** a creator launches a non-test-drive run of a published game
- **THEN** the public gallery document's play count increases and its popularity score is
  recomputed from the new count

#### Scenario: Copying a public task counts as usage

- **WHEN** a creator copies a public task into their own game
- **THEN** the public task's copy count increases and its popularity score is recomputed

#### Scenario: Concurrent signals do not lose an update

- **WHEN** several signal changes are applied to the same gallery document concurrently
- **THEN** the final counter equals the number of applied changes and the stored score equals the
  pure function applied to the final counters

#### Scenario: Re-publishing preserves accumulated signals

- **WHEN** a creator re-publishes a game that already has likes and copy counts in the gallery
- **THEN** those accumulated counts survive the re-publish rather than resetting to zero
