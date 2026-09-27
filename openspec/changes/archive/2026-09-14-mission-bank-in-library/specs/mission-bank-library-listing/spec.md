## ADDED Requirements

### Requirement: Bank missions appear in the task library

The task library SHALL list the effective mission bank alongside the
`publicTasks` results returned by `searchTaskLibrary`, in both the in-Builder
`TaskLibrary` modal and the task tab of the public Gallery. The effective mission
bank is the authored `TASK_BANK` merged with the live `missionBankOverrides`
admin edits, as returned by `loadMissionBank()`.

A bank row SHALL be projected field-by-field into the library's row shape and
MUST NOT carry any server-secret value — no `smart.secretCode`, no quiz
`answers`, no `numericAnswer`, no `hint` text, no `steps[].answer`, and no exact
`coordinates`. The projection MUST NOT be produced by spreading `entry.build()`.

A bank row that the merge left `deleted` by an override MUST NOT appear.

#### Scenario: Empty gallery still shows the bank

- **WHEN** a creator opens the task library and `searchTaskLibrary` returns zero
  `publicTasks`
- **THEN** the library lists the effective mission bank
- **AND** each row shows a title, description, task type and difficulty in the
  active UI language

#### Scenario: Secret values are never in a bank row

- **WHEN** a bank entry whose `build()` sets `smart.secretCode`, `answers`,
  `numericAnswer`, `hint`, or `steps[].answer` is listed
- **THEN** none of those keys are present on the library row or anything derived
  from it for display

#### Scenario: An admin-deleted mission is hidden

- **WHEN** `missionBankOverrides` marks a mission `deleted: true` and the merge
  honours it
- **THEN** that mission does not appear in the task library

### Requirement: The library stays in sync with the bank

Bank rows SHALL be derived at read time from `loadMissionBank()`. The feature
MUST NOT write bank missions into `publicTasks` / `publicGames`, and MUST NOT
depend on a seed or backfill.

An edit to the bank source file SHALL be reflected on the next production build.
An admin edit through `setMissionBankOverride` / `clearMissionBankOverride` SHALL
be reflected the next time `loadMissionBank()` refreshes its data (its existing
memo window), and immediately within the session that made the edit (the
existing in-session invalidation).

If `loadMissionBank()` cannot read the overrides, the library SHALL fall back to
the authored `TASK_BANK` and remain usable — a failed override read MUST NOT
empty the bank section or block the library.

#### Scenario: Admin edit reaches every creator's library

- **WHEN** an admin changes a mission's title via the admin mission-bank console
- **AND** another creator opens the task library after `loadMissionBank()` next
  refreshes
- **THEN** the library shows the mission with its new title

#### Scenario: Override read failure degrades gracefully

- **WHEN** the `missionBankOverrides` read fails
- **THEN** the task library still lists the authored `TASK_BANK`
- **AND** the `publicTasks` results are unaffected

### Requirement: Bank rows are de-duplicated against published tasks

The library SHALL show only the published `publicTasks` row and suppress the bank
row when the two represent the same mission. "Same mission" means the same
normalized title (case- and whitespace-insensitive) and the same task `type`.

#### Scenario: A published harvested template does not double up

- **WHEN** a creator has published a game containing a mission that also exists in
  the bank
- **AND** both would otherwise appear in the library for the same query
- **THEN** only the published task is listed

### Requirement: Interleaved ranking

Bank rows and `publicTasks` rows SHALL be ranked as one list: relevance to the
search query first (reusing `rankGalleryResults` from `@rushpoint/shared`), then
popularity as the tiebreak. With an empty query, published tasks — which carry
real `copyCount` / `likeCount` / `popularity` — rank ahead of bank rows, which
carry none; a query that matches a bank row's title MUST be able to lift it above
a weaker-matching published row.

#### Scenario: Query lifts a matching bank row

- **WHEN** the creator searches a term that appears in a bank mission's title but
  only in the description of a published task
- **THEN** the bank mission ranks above that published task

#### Scenario: Empty query favours real usage

- **WHEN** the creator opens the library with no query
- **THEN** published tasks with copies/likes appear before bank rows

### Requirement: Picking a bank row builds a fresh task

Selecting a bank row (one-tap insert or via the mission-detail view) SHALL insert
a new `Task` produced by that entry's `build()` factory, with a fresh id. It MUST
NOT reconstruct the task from the projected library row, and MUST NOT call
`incrementTaskCopyCount` or any `publicTasks` mutation.

Selecting a real `publicTasks` row SHALL behave exactly as today (reconstruct via
`libraryTaskToTask`, bump `copyCount`).

#### Scenario: Insert a bank mission

- **WHEN** the creator picks a bank row in the Builder's task library
- **THEN** a new task built by that entry's `build()` is added to the stage
- **AND** no `incrementTaskCopyCount` call is made

#### Scenario: Insert a published mission is unchanged

- **WHEN** the creator picks a `publicTasks` row
- **THEN** the task is reconstructed via `libraryTaskToTask` and `copyCount` is
  bumped as before
