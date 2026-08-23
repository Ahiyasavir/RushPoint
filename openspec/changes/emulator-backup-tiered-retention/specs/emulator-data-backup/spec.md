## MODIFIED Requirements

### Requirement: Bounded snapshot retention

The system SHALL decide which snapshots to keep and which to prune using a **tiered
(grandfather-father-son) retention policy** computed by a pure, total function of the snapshot
timestamps and the policy alone — no clock reads, no filesystem access.

The policy SHALL define three tiers, each independently configurable:
- a **recent** tier retaining the N newest snapshots outright (preserving today's fine-grained
  behavior at the configured interval),
- an **hourly** tier retaining the newest snapshot of each of the most recent H distinct hour
  buckets,
- a **daily** tier retaining the newest snapshot of each of the most recent D distinct day buckets.

A snapshot SHALL be kept when it qualifies for **any** tier; only snapshots qualifying for no tier
are pruned. Hour and day buckets SHALL be derived from the snapshot's absolute epoch timestamp, not
from a local-calendar rendering, so that the result is independent of the host timezone and of
daylight-saving transitions.

Tier occupancy SHALL be counted over the **buckets that snapshots actually occupy**, never over
wall-clock windows measured from the present moment. A long period with no snapshots SHALL NOT
cause previously retained snapshots to be pruned.

The system SHALL bias every ambiguity toward retention. Specifically it SHALL NEVER prune the newest
snapshot, and SHALL NEVER prune a snapshot whose timestamp cannot be determined from its name.

The system SHALL additionally enforce an absolute total-footprint cap. When the retained set exceeds
the cap, the system SHALL evict the oldest retained snapshots first — thereby draining the coarsest,
oldest tier before touching recent snapshots — until the retained set fits the cap or only the
newest snapshot remains.

The function SHALL be total: for any input, every supplied snapshot appears in exactly one of the
returned keep and prune sets, and the two sets SHALL NOT overlap.

#### Scenario: Recent tier keeps the newest N outright

- **WHEN** more snapshots exist than the configured recent count and all fall inside the same hour
- **THEN** the retention logic keeps the N newest snapshots
- **AND** older snapshots in that hour are kept only if they are the newest of an hour or day bucket that still has tier capacity

#### Scenario: Hourly tier preserves one snapshot per hour

- **WHEN** many snapshots span several hours and exceed the recent count
- **THEN** for each of the most recent retained hour buckets exactly the newest snapshot of that bucket is kept

#### Scenario: Daily tier preserves one snapshot per day

- **WHEN** snapshots span several days and exceed both the recent and hourly capacities
- **THEN** for each of the most recent retained day buckets exactly the newest snapshot of that bucket is kept

#### Scenario: A session from hours ago is still recoverable

- **WHEN** snapshots exist from an earlier session several hours before the newest snapshot
- **THEN** at least one snapshot from that earlier session is in the keep set

#### Scenario: Empty input

- **WHEN** no snapshots exist
- **THEN** the retention logic returns an empty keep set and an empty prune set

#### Scenario: Single snapshot is never pruned

- **WHEN** exactly one snapshot exists, however old, and every tier capacity is zero
- **THEN** the retention logic keeps it and prunes nothing

#### Scenario: Exactly-at-boundary timestamps

- **WHEN** a snapshot's timestamp falls exactly on an hour or day boundary
- **THEN** it is assigned to the bucket that starts at that boundary, and the snapshot immediately preceding it by one millisecond is assigned to the previous bucket

#### Scenario: Snapshots supplied out of order

- **WHEN** the snapshot list is supplied in arbitrary order
- **THEN** the keep and prune sets are identical to those produced for any other ordering of the same snapshots

#### Scenario: Clock moved backwards

- **WHEN** a snapshot carries a timestamp earlier than an already-existing snapshot
- **THEN** the retention logic orders it by its own timestamp without error and still never prunes the snapshot with the greatest timestamp

#### Scenario: A long gap with no snapshots preserves history

- **WHEN** the newest snapshot is many days newer than the rest and no snapshots were taken in between
- **THEN** the older snapshots are still evaluated against tier capacity and are not pruned merely for being old

#### Scenario: Unparseable snapshot name is never pruned

- **WHEN** a snapshot folder name does not encode a parseable timestamp
- **THEN** it appears in the keep set and never in the prune set

#### Scenario: Disk cap evicts oldest first

- **WHEN** the tier-retained set exceeds the configured total-byte cap
- **THEN** the oldest retained snapshots are moved to the prune set until the retained total fits the cap

#### Scenario: Disk cap never empties the safety net

- **WHEN** the cap is smaller than a single snapshot
- **THEN** the newest snapshot is still retained and the retained set is never empty

#### Scenario: Keep and prune partition the input

- **WHEN** any set of snapshots is evaluated
- **THEN** every input snapshot appears in exactly one of the keep or prune sets and neither set contains a name absent from the input

## ADDED Requirements

### Requirement: Event-triggered snapshot

The system SHALL provide a one-shot snapshot mode that captures the current emulator state
immediately and exits, so that an operation about to destroy or overwrite emulator data can take a
snapshot at that exact moment rather than relying on the next timer tick.

A one-shot snapshot MAY be marked **pinned**. A pinned snapshot SHALL be exempt from tier-based
pruning and SHALL only ever be removed by the absolute disk cap, so that a deliberately captured
pre-destruction state is not rotated away by ordinary retention.

#### Scenario: One-shot snapshot outside the loop

- **WHEN** the one-shot snapshot mode is invoked while the emulator is ready
- **THEN** a single snapshot is written and the process exits without starting the interval loop

#### Scenario: One-shot snapshot refuses a not-ready emulator

- **WHEN** the one-shot snapshot mode is invoked and the emulator is not fully ready
- **THEN** no export is attempted and the command reports failure

#### Scenario: Pinned snapshots survive tier pruning

- **WHEN** a pinned snapshot qualifies for no retention tier
- **THEN** the retention logic still keeps it

#### Scenario: Pinned snapshots are still subject to the disk cap

- **WHEN** the retained set including pinned snapshots exceeds the byte cap
- **THEN** oldest-first eviction may prune a pinned snapshot rather than allow the cap to be exceeded
