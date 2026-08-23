## ADDED Requirements

### Requirement: User-facing copy uses "mission," never "task," for a field mission
All user-facing strings shipped by the apps (translation-map leaf values in `apps/creator-web/src/i18n.ts` and `apps/play-web/src/i18n.ts`, plus visible JSX text) SHALL refer to a `Task` object as "mission" (or its Hebrew equivalent), not "task," when the string is describing that object to a creator or participant. Internal code identifiers (`Task`, `addTask`, `taskId`, `TaskType`, Firestore field/collection names, callable parameter names) are exempt — this requirement governs rendered copy only, not source-level naming.

#### Scenario: Translation maps contain no "task" vocabulary for the mission concept
- **WHEN** every string leaf in both apps' `translations` maps is scanned for the case-insensitive
  substring "task"
- **THEN** no value uses "task" to refer to the field-mission concept (a value may still contain
  "task" only if explicitly marked as an intentional exception inline, mirroring the
  `// i18n-ignore` convention used for PART B)

#### Scenario: Regression is caught by the test lane
- **WHEN** a developer adds or edits a translation value that reintroduces "task" as user-facing
  vocabulary for the mission concept without an inline exception marker
- **THEN** `npm test` fails via `scripts/test-no-task-copy.ts`, naming the offending key

#### Scenario: Stage-delete confirmation dialog uses consistent wording
- **WHEN** a creator triggers the stage-delete confirmation dialog for a stage containing N missions
- **THEN** the dialog text refers to the contained items as "missions," not "tasks," e.g. "Delete
  the stage "X" and the N missions inside it?"
