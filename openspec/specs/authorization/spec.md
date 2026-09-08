# authorization Specification

## Purpose
TBD - created by archiving change auth-anticheat-hardening. Update Purpose after archive.
## Requirements
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

### Requirement: Access codes cannot be enumerated
A client SHALL be able to read a single access-code document by its known code id (`get`) but MUST
NOT be able to list the `accessCodes` collection. The `firestore.rules` for `/accessCodes/{code}`
MUST split `allow get` (authenticated) from `allow list` (denied), so the join lookup keeps working
while collection-wide harvesting of every run's `{ownerUid, gameId, runId}` is impossible.

#### Scenario: Direct get by known code succeeds
- **WHEN** an authenticated client calls `getDoc(doc('accessCodes', CODE))` for a code it knows
- **THEN** the document is returned (join flow unaffected)

#### Scenario: Listing the collection is denied
- **WHEN** any client calls `getDocs(collection('accessCodes'))`
- **THEN** the read is denied by the security rules

#### Scenario: Server-side lookups are unaffected
- **WHEN** `getJoinInfo` or `getPublicLeaderboard` resolves a code by id via the Admin SDK
- **THEN** the lookup still succeeds (rules apply to clients, not Cloud Functions)

### Requirement: No emulator authorization bypass
Authorization guards (`assertStaffOrOwner`, `assertAdmin`, the `inviteStaff` owner check) SHALL
apply identically in the emulator and in production — no `FUNCTIONS_EMULATOR` escape hatch. Test
suites obtain privileged identities the same way production does: the owner is the game's real
uid, staff sign in via `staffSignIn` custom tokens, and platform-admin tests mint a custom token
with the `admin` claim against the Auth emulator.

#### Scenario: A participant cannot run staff/owner live-ops in any environment
- **WHEN** a joined participant calls `adjustTeamScore`, `inviteStaff`, `reviewStationSubmission`,
  or `pushAnnouncement` against a run it plays in — in the emulator or in production
- **THEN** the call fails with `permission-denied` and no run/team state changes

#### Scenario: Admin-only maintenance requires the admin claim everywhere
- **WHEN** the game OWNER (a non-admin) calls `pruneRunNow` or `listAuditLogs`
- **THEN** the call fails with `permission-denied`

### Requirement: Staff tokens are scoped to their run
Staff/owner-gated callables SHALL verify the staff token's `runId` claim against the run named
in the payload (the custom token carries `ownerUid`, `gameId`, and `runId`). A staff PIN minted
for one run MUST NOT grant live-ops power (score adjustment, photo review, announcements, alert
acknowledgement) over any other run — including other runs of the same owner.

#### Scenario: Staff of run B cannot act on run A
- **WHEN** a staff member signed in with a PIN for run B calls `adjustTeamScore`,
  `reviewStationSubmission`, or `pushAnnouncement` naming run A of the same owner
- **THEN** the call fails with `permission-denied` and run A is unchanged

#### Scenario: Staff acts within their own run
- **WHEN** the same staff member calls `reviewStationSubmission` naming run B
- **THEN** the call is processed normally

