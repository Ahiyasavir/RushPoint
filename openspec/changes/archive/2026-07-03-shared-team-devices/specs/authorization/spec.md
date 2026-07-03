# authorization Specification (delta)

## MODIFIED Requirements

### Requirement: Station callables act only on the caller's own team
The station callables `submitStationPhoto` and `verifyStationCode` SHALL derive the acting team
from the authenticated token (`context.auth.uid`) — resolving the team the caller is **attached
to** (founding uid or a uid listed in the team's `deviceUids`) — and MUST NOT trust a `teamId`
supplied in the request payload. When the payload carries a `teamId` that differs from the
caller's resolved team id, the call MUST be rejected with `permission-denied` and no team state
may change. Callers attached to no team in the run MUST be rejected with `permission-denied`.
Additionally, these callables mutate team state and therefore MUST require the caller to be the
team's current controller (see `shared-team-devices`).

#### Scenario: Mismatched payload teamId is rejected
- **WHEN** team A (uid_A) calls `submitStationPhoto` or `verifyStationCode` with `teamId = uid_B`
- **THEN** the call fails with `permission-denied`
- **AND** team B's progress, score, and `activeTaskId` are left unchanged

#### Scenario: Caller acts on its own team
- **WHEN** team A's controller calls `submitStationPhoto`/`verifyStationCode` with no `teamId` or `teamId` equal to its resolved team id
- **THEN** the call is processed against team A's own document
- **AND** an `autoApprove` photo task advances only team A

#### Scenario: Attached viewer resolves to the team but cannot mutate
- **WHEN** a uid attached to team A as a viewer calls `verifyStationCode`
- **THEN** the team resolves to team A (not to a team named in the payload)
- **AND** the call fails with `permission-denied` because the caller is not the controller
