## ADDED Requirements

### Requirement: The mission bank is editable from an admin page, and reachable from the templates tab
The platform SHALL serve an admin-only page at `/admin/mission-bank`, gated on the `admin` custom
claim exactly as `/admin/templates` and `/admin/users` are. `/admin/templates` SHALL carry a link
to it, because the mission bank and the game templates are two different systems and the templates
tab is where people go looking for the bank.

The page SHALL list every entry of the authored bank — including entries an admin has deleted, so a
deletion is reversible — showing for each one its title, key, tags, difficulty, family, and whether
it is currently edited or deleted.

#### Scenario: A non-admin opens the page
- **WHEN** a signed-in user without the `admin` claim navigates to `/admin/mission-bank`
- **THEN** the access-denied state is rendered and no callable is invoked

#### Scenario: A deleted mission is still listed
- **WHEN** an admin has deleted a mission and reloads the page
- **THEN** the mission appears marked as deleted, with an action that puts it back

### Requirement: Editing and deleting, but not creating
An admin SHALL be able to change a mission's title, description, tags, difficulty, minimum age and
walking minutes, and to remove a mission from the pool or put it back. The page SHALL NOT offer
creation of a new mission: a new entry requires a `build()` factory (task type, verification,
capacity, quick-setup steps), which is authoring and remains in `apps/creator-web/src/taskBank.ts`.

Tags SHALL be chosen from the closed `BankTagId` registry through a picker, never typed as free
text, because every composer filter keys on that registry and a free-text tag is a tag no filter
can match.

#### Scenario: Tags cannot be emptied
- **WHEN** an admin deselects every tag and saves
- **THEN** the save is refused, because a mission with no tags is unreachable by the composer

### Requirement: Edits are stored as overrides, and any mission can be reset to its authored content
Each edited or deleted mission SHALL be stored as one document at `missionBankOverrides/{key}`.
The authored content SHALL remain in `taskBank.ts` and SHALL NOT be migrated, so resetting a
mission to its source content is the deletion of one document.

`setMissionBankOverride` SHALL carry the WHOLE edited state of one mission and SHALL replace the
stored document rather than merging into it, so a field the admin cleared disappears. An explicit
`null` on `minAge` or `transitMinutes` SHALL mean "clear this field"; an absent key SHALL mean
"leave the source value alone". A call carrying no usable content SHALL be rejected with
`invalid-argument` rather than storing a row that marks an unedited mission as edited.

#### Scenario: Clearing an optional field
- **WHEN** an admin clears the minimum age and saves
- **THEN** the stored override carries `minAge: null` and the merged mission has no age floor

#### Scenario: Reset
- **WHEN** an admin resets a mission
- **THEN** its override document is deleted and the mission returns to its authored content
- **AND** resetting a mission that has no override is a no-op, not an error

### Requirement: Only admins may write the bank, and every write leaves a trail
`listMissionBankOverrides`, `setMissionBankOverride` and `clearMissionBankOverride` SHALL all
require the `admin` custom claim server-side and SHALL reject any other caller with
`permission-denied`. The `missionBankOverrides` collection SHALL be readable by any authenticated
user (the composer merges it in the browser) and SHALL NOT be client-writable.

Both mutations SHALL write an `auditLogs` record carrying the operator, the mission key and the
before/after state: they change what every creator on the platform is offered, and the previous
content is gone the moment it is overwritten.

#### Scenario: An ordinary creator attempts a write
- **WHEN** a signed-in creator without the `admin` claim calls `setMissionBankOverride`
- **THEN** the call is rejected with `permission-denied` and nothing is written

### Requirement: The merge is total and cannot strand the composer
`applyBankOverrides` SHALL be a total function: an override naming an unknown key, a malformed
field, or a malformed row SHALL be ignored rather than applied or thrown on. A `difficulty`
override SHALL patch both the entry's `difficulty` and the mission its `build()` produces, so the
invariant `scripts/test-task-bank.ts` enforces cannot be broken from the UI.

A stored deletion that would leave the bank with no `start`-tagged or no `finish`-tagged mission
SHALL NOT be applied, and SHALL be reported so the admin page can say why. The composer cannot
build a game without a bookend at each end, and this read is the last place that can stop one bad
row turning "compose one for me" into a permanent dead end.

The client read of the overrides SHALL fail OPEN: if it fails for any reason, the composer receives
the authored bank unchanged and the new-game flow keeps working.

#### Scenario: Deleting the last opener
- **WHEN** the only remaining `start`-tagged mission has a stored `deleted: true`
- **THEN** the mission remains in the merged bank and its key is reported as a refused deletion

#### Scenario: The override read fails
- **WHEN** the Firestore read of `missionBankOverrides` throws
- **THEN** the composer is handed the authored `TASK_BANK` and composing succeeds
