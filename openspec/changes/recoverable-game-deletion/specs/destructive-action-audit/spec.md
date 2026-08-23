## ADDED Requirements

### Requirement: Destructive game actions are recorded in the audit trail
Every creator-initiated destructive action on a game SHALL write one immutable `auditLogs` entry
recording at minimum the acting uid, the action type, the target game id, the game title at the time
of the action, and a server timestamp. The entry SHALL be written by Cloud Functions only and SHALL
remain unreadable and unwritable by clients.

#### Scenario: Soft delete is recorded
- **WHEN** a game is deleted
- **THEN** an `auditLogs` entry SHALL exist with the delete action type, the acting uid, the game id
  and a timestamp

#### Scenario: Restore is recorded
- **WHEN** a deleted game is restored
- **THEN** an `auditLogs` entry SHALL exist with the restore action type and the acting uid

#### Scenario: Permanent destruction is recorded
- **WHEN** a tombstoned game is permanently destroyed, whether by the owner or by the scheduled
  sweep
- **THEN** an `auditLogs` entry SHALL exist naming the action and identifying the actor, using a
  distinct system actor identifier when the sweep performed it

#### Scenario: Refused deletion is not recorded as a deletion
- **WHEN** a deletion is refused because the game has a live run
- **THEN** no delete audit entry SHALL be written

#### Scenario: Audit failure never blocks the action
- **WHEN** the audit write fails
- **THEN** the destructive action SHALL still complete and the failure SHALL be logged

### Requirement: The audit trail is readable by platform administrators
Audit entries for destructive game actions SHALL be retrievable through the existing administrator
audit-log listing, ordered newest first.

#### Scenario: Administrator lists recent destructive actions
- **WHEN** a platform administrator lists audit logs
- **THEN** the game delete, restore and permanent-destroy entries SHALL appear among the results

#### Scenario: A non-administrator is refused
- **WHEN** a signed-in creator who is not a platform administrator lists audit logs
- **THEN** the call SHALL fail with `permission-denied`
