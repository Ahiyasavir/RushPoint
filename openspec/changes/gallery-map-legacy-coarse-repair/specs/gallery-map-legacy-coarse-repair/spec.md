## ADDED Requirements

### Requirement: A legacy coarse-only mission is repaired to its exact point at read time

When `searchTaskLibrary` serves a mission whose stored document carries no exact coordinate and whose stored published area is still the coarse ~1 km cell written by an earlier location contract, the library SHALL look up that mission's exact authored coordinate from its source game template and serve a published area recomputed from that coordinate via the same rule the publish path uses, rather than serving the stale coarse area.

A mission whose stored document already carries an exact coordinate, or whose stored published area
is already exact, SHALL NOT trigger this lookup — it is served by the existing read-path recompute
unchanged.

#### Scenario: A coarse-only legacy mission resolves to its exact point
- **WHEN** the library serves a mission whose stored document has no coordinate field and whose
  stored published area is coarse
- **THEN** the served published area is recomputed from that mission's source game template's
  authored coordinate, not the stale stored coarse area

#### Scenario: A mission with a stored coordinate is unaffected
- **WHEN** the library serves a mission whose stored document carries a coordinate field
- **THEN** no game-template lookup is performed for that mission

#### Scenario: A mission already served an exact stored area is unaffected
- **WHEN** the library serves a mission whose stored document has no coordinate field but whose
  stored published area is already exact (not coarse)
- **THEN** no game-template lookup is performed for that mission and the stored area is served
  unchanged

### Requirement: A hidden-location mission stays coarse even through the template lookup

Recomputing a legacy mission's location from its source game template SHALL apply the same hidden-location coarsening rule the publish path applies, so a mission whose authored task is hidden-location is never served its exact point through this lookup.

#### Scenario: A hidden-location task in the template is still coarsened
- **WHEN** the template lookup resolves a mission whose authored task is flagged hidden-location
- **THEN** the served published area is the coarse ~1 km area derived from the authored point, not
  the exact point

### Requirement: The template lookup is bounded and batched, not per-mission

Resolving the template lookup for a batch of missions SHALL issue at most one Firestore read per distinct source game across the whole batch, regardless of how many missions in the batch share that source game, and SHALL issue no lookup at all for missions that do not need it.

#### Scenario: Multiple missions sharing one source game cost one read
- **WHEN** a batch contains several missions needing the lookup that share the same source game
- **THEN** that source game is fetched exactly once for the whole batch

#### Scenario: A batch with no missions needing the lookup performs no fetch
- **WHEN** every mission in a batch already has a stored coordinate or an exact stored area
- **THEN** no game-template fetch is issued

### Requirement: The template lookup fails open and never writes back to Firestore

If the source game, or the mission's task within it, cannot be resolved for any reason — including the game/task being deleted, inaccessible, or the underlying fetch throwing — the mission SHALL be served its existing stored published area unchanged, and the search SHALL NOT throw or drop the mission from its results. The lookup SHALL be read-only: it SHALL NOT persist any repaired value back to the `publicTasks` document.

#### Scenario: A deleted or inaccessible source game falls back to the stored area
- **WHEN** the template lookup cannot find the mission's source game
- **THEN** the mission is served its existing stored published area, unchanged
- **AND** the search does not throw and does not omit the mission from its results

#### Scenario: A task removed from an otherwise-present game falls back to the stored area
- **WHEN** the template lookup finds the source game but the mission's task is no longer present in
  it
- **THEN** the mission is served its existing stored published area, unchanged

#### Scenario: A fetch failure falls back to the stored area for the whole batch
- **WHEN** the underlying batched fetch of source games fails
- **THEN** every mission in the batch is served its existing stored published area, unchanged, and
  the search does not throw

#### Scenario: The lookup never writes to Firestore
- **WHEN** the template lookup successfully resolves a repaired location for a mission
- **THEN** only the response served to this caller reflects the repaired value; no write is made to
  the mission's stored `publicTasks` document
