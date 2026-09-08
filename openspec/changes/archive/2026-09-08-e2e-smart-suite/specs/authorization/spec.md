# authorization Specification (delta)

## ADDED Requirements

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
