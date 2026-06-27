# input-validation Specification

## Purpose
TBD - created by archiving change auth-anticheat-hardening. Update Purpose after archive.
## Requirements
### Requirement: All callables enforce shared payload validation
Every v2 callable SHALL validate untrusted input through the shared `packages/shared/src/validation.ts`
validators (`requireString` and size caps), replacing ad-hoc `!x?.trim()` checks. `joinRun`
(`displayName`, `memberNames`, `registrationData`) and the live-ops callables (`message`, etc.) MUST
reject oversized or wrong-typed fields with a typed, bilingual `invalid-argument` error. The
validation module header MUST be corrected to drop dead v1 callable names.

#### Scenario: Oversized field is rejected
- **WHEN** a client calls `joinRun` with a `displayName` longer than the size cap
- **THEN** the call fails with `invalid-argument`
- **AND** the error message is bilingual (EN/HE)

#### Scenario: Valid payload passes
- **WHEN** a client submits a within-limits, correctly-typed payload
- **THEN** validation passes and the callable proceeds

### Requirement: Photo URLs are constrained to the caller's own Storage path
A new `requireStorageUrl(url, runId, uid)` validator SHALL accept only a URL that points at the
caller's own `runs/{runId}/teams/{uid}/…` Storage path (gs:// or a Firebase https download URL) and
MUST reject `javascript:` URLs, foreign paths, and oversized strings. `submitStationPhoto` MUST run
`photoUrl` through this validator before persisting it.

#### Scenario: Foreign or unsafe photoUrl is rejected
- **WHEN** `submitStationPhoto` receives a `javascript:` URL or a path under another team's folder
- **THEN** the call fails with `invalid-argument`
- **AND** no `photoUrl` is written to any team document

#### Scenario: Own-path photoUrl is accepted
- **WHEN** the `photoUrl` resolves to `runs/{runId}/teams/{uid}/…` for the calling team
- **THEN** the validator passes and the photo is recorded

