## ADDED Requirements

### Requirement: Admin-only platform user activity report

The system SHALL provide an admin-only callable that reports, for every real (non-anonymous)
Firebase Auth account, their signup/last-sign-in timestamps, the games they created, the runs they
launched, and a derived last-active timestamp. Anonymous participant accounts SHALL NOT appear in
this report.

#### Scenario: Admin lists platform users

- **WHEN** a caller whose ID token carries `admin: true` invokes `listPlatformUsers`
- **THEN** the response includes one entry per real Auth account, each with uid, email,
  displayName, Auth createdAt/lastSignInAt, its games (id, title, createdAt, deleted flag), its
  runs (id, gameId, gameTitle, status, createdAt, finishedAt, participantCount), and a derived
  `lastActiveAt`

#### Scenario: Non-admin is denied

- **WHEN** a caller without the `admin` claim (unauthenticated, a plain creator, a participant, or
  run-scoped staff) invokes `listPlatformUsers`
- **THEN** the call is rejected with `permission-denied`, exactly as `listAuditLogs` already
  behaves for the same population

#### Scenario: Anonymous accounts are excluded

- **WHEN** the platform's Auth user pool includes anonymous participant accounts (no email, no
  provider data)
- **THEN** none of them appear in the `listPlatformUsers` response

#### Scenario: Result set is bounded and says so

- **WHEN** the number of real Auth accounts exceeds the callable's `limit` (default 100, max 300)
- **THEN** the response returns at most `limit` entries and sets `truncated: true`

### Requirement: The Auth scan is bounded regardless of how many participants exist

Because one anonymous account is created per participant session, the account pool grows without
limit while the creators being reported stay few. The scan SHALL therefore stop as soon as it has
enough accounts to answer the request, SHALL never read more than a fixed maximum number of Auth
pages in one invocation, and SHALL report a list cut short by that maximum as not-everything rather
than as complete.

#### Scenario: Enough creators found early in a large account pool

- **WHEN** more than `limit` creator accounts are found before the Auth pages are exhausted
- **THEN** the scan stops immediately rather than reading the remaining pages
- **AND** the returned rows are the same ones an exhaustive scan would have returned

#### Scenario: The page ceiling is reached

- **WHEN** the scan reaches its maximum page count while Auth still reports further pages
- **THEN** it stops and the response sets `truncated: true`, so the report never implies it saw
  every account
- **AND** the cause is recorded in the server log, distinct from an ordinary over-`limit` truncation

#### Scenario: A complete scan is never mislabelled as truncated by the ceiling

- **WHEN** the scan already has enough creator accounts to satisfy the request at the moment it
  reaches the page ceiling
- **THEN** the result is reported as complete, not as ceiling-truncated

### Requirement: `lastActiveAt` is derived, never a new stored field

The system SHALL compute each user's `lastActiveAt` as the maximum of their Auth
`lastSignInAt`, and the `createdAt`/`updatedAt` of every game and `createdAt`/`finishedAt` of every
run attributable to them, without writing any new persisted field to accomplish this.

#### Scenario: A creator who only ever signed in

- **WHEN** a creator has an Auth account but has created no games and launched no runs
- **THEN** their `lastActiveAt` equals their Auth `lastSignInAt`

#### Scenario: A creator with only game/run activity and no sign-in timestamp

- **WHEN** the Auth record for a creator has no `lastSignInAt` (e.g. never re-authenticated since
  creation)
- **THEN** `lastActiveAt` is derived purely from their games' and runs' timestamps

### Requirement: Admin console page renders the report, gated on the admin claim

The system SHALL provide a creator-web route (`/admin/users`, outside the primary navigation) that
renders the `listPlatformUsers` report as a sortable table, and SHALL show an access-denied state
rather than any data when the signed-in user's ID token lacks the `admin` claim.

#### Scenario: Admin opens the page

- **WHEN** a signed-in user whose ID token carries `admin: true` navigates to `/admin/users`
- **THEN** the page calls `listPlatformUsers` and renders one row per user, with each user's game
  count and run count expandable to the underlying list

#### Scenario: Non-admin opens the page

- **WHEN** a signed-in user without the `admin` claim navigates to `/admin/users`
- **THEN** the page shows an access-denied state and never calls `listPlatformUsers`

### Requirement: A first-party path exists to grant the admin claim

The system SHALL provide an operator script that sets the `admin: true` custom claim on a target
Firebase Auth account by uid or email, defaulting to a dry run and requiring an explicit
`--execute --confirm-project=<id>` to mutate a real project, without ever collecting or handling
the target account's password.

#### Scenario: Dry run reports intent without mutating

- **WHEN** the script is invoked without `--execute`
- **THEN** it prints the resolved target account and the claim change that would be made, and makes
  no call to `setCustomUserClaims`

#### Scenario: Execute requires the project id to match

- **WHEN** the script is invoked with `--execute` but `--confirm-project` does not match the
  connected project
- **THEN** it refuses to run and makes no mutation
