## ADDED Requirements

### Requirement: Call budgets are enforced from API process memory

The system SHALL enforce per-uid, per-bucket call budgets using state held in the API process,
and SHALL NOT read or write any Firestore document in order to reach a rate-limit decision.

The decision itself SHALL continue to be made by the existing pure `rateLimit` fixed-window
function in `@rushpoint/shared`, with the same `RATE_LIMITS` budgets — only the storage of
`WindowState` moves. A caller that stays inside its budget SHALL observe no difference from the
previous behavior.

#### Scenario: A call inside budget is admitted without touching Firestore
- **WHEN** a uid invokes a rate-limited callable for the first time in a window
- **THEN** the call is admitted
- **AND** no Firestore read or write is performed by the rate-limit enforcement

#### Scenario: Exceeding the budget trips the same error as before
- **WHEN** a uid exceeds its bucket's `max` calls inside `windowMs`
- **THEN** enforcement throws `resource-exhausted` with the existing bilingual message
- **AND** no Firestore read or write is performed

#### Scenario: The window resets on its own boundary
- **WHEN** a uid has tripped its budget and `windowMs` elapses from the window start
- **THEN** the next call from that uid is admitted

#### Scenario: Buckets and uids do not interfere
- **WHEN** one uid exhausts bucket A
- **THEN** that uid's budget for bucket B is unaffected
- **AND** a different uid's budget for bucket A is unaffected

### Requirement: An unknown bucket fails open and is reported

The system SHALL admit the call when a bucket has no configured budget, and SHALL emit a warning
naming the bucket, preserving today's fail-open behavior for a mistyped bucket name.

#### Scenario: Missing budget admits the call
- **WHEN** enforcement runs for a bucket absent from `RATE_LIMITS` and with no explicit budget
- **THEN** the call is admitted
- **AND** a warning identifying the bucket is emitted

### Requirement: Limiter memory is bounded

The system SHALL bound the memory used by rate-limit state so that a long-lived API process cannot
grow without limit as unique uids accumulate. State for a key whose window has already elapsed
SHALL be reclaimable, and reclaiming it SHALL NOT change any admission decision — a key with an
elapsed window is indistinguishable from a key that was never seen.

#### Scenario: Elapsed entries are reclaimed
- **WHEN** a key's window has fully elapsed and reclamation runs
- **THEN** that key's state is discarded
- **AND** the next call for that key is admitted exactly as a first-ever call would be

#### Scenario: Live entries survive reclamation
- **WHEN** reclamation runs while a key's window is still open and its budget already exhausted
- **THEN** that key's state is retained
- **AND** a further call in the same window is still refused

### Requirement: Budgets are per-process and do not survive a restart

The system SHALL treat rate-limit state as ephemeral. Restarting the API process SHALL clear all
budgets. This is an accepted consequence: the limiter exists to bound abuse, and admitting a small
number of extra calls immediately after a restart is preferable to a Firestore read and write on
every callable invocation.

#### Scenario: A restart clears budgets
- **WHEN** a uid has exhausted a bucket and the API process restarts
- **THEN** that uid's next call is admitted

## REMOVED Requirements

### Requirement: Rate-limit counters are persisted to Firestore

**Reason**: Persisting the counter cost one Firestore read and one write on *every* rate-limited
callable — approximately 1,516 reads and 1,516 writes during nine minutes of a single 29-person
run, against a 50,000 read / 20,000 write daily quota. The durability bought nothing: the API is a
single process, so no second reader ever consulted the document, and the only behavior the
persistence preserved was budget survival across a restart.

**Migration**: No caller action is required — `enforceRateLimit`'s signature and thrown error are
unchanged. Documents already written under `FIRESTORE_PATHS.rateLimit(bucket, uid)` become inert;
they are neither read nor updated and may be pruned separately. Anything that inspected those
documents to observe call volume MUST instead read the `rateLimit.tripped` log record.
