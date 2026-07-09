# Rate Limiting

## ADDED Requirements

### Requirement: A pure fixed-window limiter bounds calls per key
The platform SHALL provide a pure `rateLimit(state, max, windowMs, nowMs)` predicate that allows up
to `max` calls per `windowMs` for a given key's window state, denies further calls until the window
elapses, and resets once `nowMs` passes `windowStartMs + windowMs`. The clock is injected (`nowMs`),
so the predicate is deterministic and unit-testable without a real clock or emulator. Distinct keys
have independent windows.

#### Scenario: Calls are allowed up to the cap then denied
- **WHEN** a key has reached `max` calls within the current window
- **THEN** `rateLimit` returns `allowed: false` with a positive `retryAfterMs`
- **AND** calls below `max` return `allowed: true`

#### Scenario: The window resets after it elapses
- **WHEN** `nowMs` is past `windowStartMs + windowMs`
- **THEN** the count resets and calls are allowed again

#### Scenario: Independent keys do not interfere
- **WHEN** two distinct keys (uids) each make calls
- **THEN** each key is limited by its own window, not the other's

### Requirement: Sensitive callables enforce a per-uid call budget
The participant-facing callables SHALL enforce a per-uid fixed-window call budget via a race-safe
transactional counter and reject calls beyond the budget with a bilingual `resource-exhausted` error.
This covers every authenticated participant callable that mutates state or is poll-able —
`submitTaskAnswer`, `submitSequenceStep`, `verifyStationCode`, `submitStationPhoto`, `completeTask`,
`requestTaskHint`, `claimDiscoveryPoi`, `checkOutTask`, `joinRun`, `triggerSOS`,
`requestGuardianConsent`, `getMyTeamState`, `requestNextTask`, `getRecommendedTasks`,
`getRunDiscoveryPois`, `getJoinInfo`, and `updateLocation`. Budgets MUST be generous enough that
normal play never trips them. The counter documents are server-write-only (clients cannot read or
write them). (The unauthenticated `checkChallengeAnswer` cannot be uid-limited and is deferred to an
App Check gate — Appendix B #27.)

#### Scenario: Abusive volume is rejected
- **WHEN** a single uid calls `submitTaskAnswer` more than its per-window budget
- **THEN** the over-limit call fails with `resource-exhausted`

#### Scenario: Normal play cadence is unaffected
- **WHEN** a team calls `requestNextTask` at a normal play cadence (well under budget)
- **THEN** every call succeeds and play is not impeded

#### Scenario: Counter docs are not client-accessible
- **WHEN** a client attempts to read or write a `rateLimits` counter document
- **THEN** the Firestore rules deny it
