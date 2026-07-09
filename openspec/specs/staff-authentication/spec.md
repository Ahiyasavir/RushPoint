# staff-authentication Specification

## Purpose
TBD - created by archiving change auth-anticheat-hardening. Update Purpose after archive.
## Requirements
### Requirement: Staff-PIN sign-in is rate-limited with lockout
`staffSignIn` SHALL limit failed PIN attempts per `(runId, callerUid)` and MUST lock out further
attempts once a threshold is reached, even if a subsequently-supplied PIN is correct. Attempt state
is persisted at `runs/{runId}/staffAttempts/{callerUid}` as `{ count, lastFailedAt }` and MUST be
reset on a successful sign-in. Defaults: 5 failed attempts trigger a 10-minute cooldown. The lockout
decision is a pure predicate (`shouldLockout(failedAttempts, limit)`, `isWithinCooldown(...)`) so it
is unit-testable without the emulator.

#### Scenario: Lockout after repeated wrong PINs
- **WHEN** a caller submits 5 wrong PINs for the same run
- **THEN** the next attempt is rejected as locked out
- **AND** supplying the correct PIN during the cooldown window is still refused

#### Scenario: Success resets the counter
- **WHEN** a caller signs in successfully before reaching the limit
- **THEN** the persisted attempt count for that `(runId, callerUid)` is cleared

### Requirement: PINs and access codes use a cryptographic RNG
Staff PINs (`staffSignIn`) and run access codes (`generateCode` in `runs/index.ts`) SHALL be
generated with `crypto.randomInt` rather than `Math.random()`, behind an injectable RNG seam so the
generator can be asserted in tests.

#### Scenario: Generated secrets are not Math.random-derived
- **WHEN** a PIN or access code is generated
- **THEN** it is produced via the cryptographic RNG seam, not `Math.random()`

