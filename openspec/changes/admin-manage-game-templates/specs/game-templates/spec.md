## ADDED Requirements

### Requirement: Admin can flag a game as a template
Only a user with the `admin` custom claim SHALL be able to set or clear a `Game`'s `isTemplate`
flag, via the `setGameTemplateFlag` callable. A non-admin caller SHALL be rejected with
`permission-denied`. When `templateGroupKey` is provided and other documents already share that
key, the new document's `templateEmoji` and `templateOrder` MUST match the group's existing
values or the call SHALL be rejected with `invalid-argument`.

#### Scenario: Admin flags their own game as a template
- **WHEN** an admin calls `setGameTemplateFlag` with `{ gameId, isTemplate: true, templateEmoji,
  templateOrder }` for a game they own
- **THEN** the game document is updated with those fields and subsequently appears in
  `listGameTemplates`

#### Scenario: Non-admin cannot flag a template
- **WHEN** a non-admin creator calls `setGameTemplateFlag`
- **THEN** the call is rejected with `permission-denied` and no document is modified

#### Scenario: Mismatched sibling rejected
- **WHEN** an admin calls `setGameTemplateFlag` with a `templateGroupKey` already used by another
  template whose `templateEmoji` or `templateOrder` differs from the payload
- **THEN** the call is rejected with `invalid-argument` and no document is modified

### Requirement: Template list is a sanitized, grouped projection
Any authenticated user SHALL be able to call `listGameTemplates` and receive one entry per
`templateGroupKey` (a document with no group key is its own group of one), each entry containing
`{ groupKey, templateEmoji, templateOrder, variants }` where `variants` maps a language code to a
lightweight projection `{ id, ownerUid, title, description, mode, scoringPreset, stageCount,
taskCount }`. The response SHALL NOT include `stages` or `tasks` content. Soft-deleted
(tombstoned) template games SHALL NOT appear. Entries SHALL be ordered by the minimum
`templateOrder` across each group's variants.

#### Scenario: Grouped entry with two language variants
- **WHEN** two template games share a `templateGroupKey` with `templateLang: 'he'` and
  `templateLang: 'en'` respectively
- **THEN** `listGameTemplates` returns one entry for that group with both `'he'` and `'en'` keys
  populated in `variants`

#### Scenario: Template with a single language variant
- **WHEN** a template game has no sibling sharing its `templateGroupKey`
- **THEN** `listGameTemplates` returns an entry whose `variants` contains only that one language

#### Scenario: Deleted template excluded
- **WHEN** an admin soft-deletes (trashes) a template game
- **THEN** it no longer appears in subsequent `listGameTemplates` calls

#### Scenario: No template content leaked
- **WHEN** any authenticated user calls `listGameTemplates`
- **THEN** the response contains no `stages`, `tasks`, or any field not in the documented
  projection, for every variant of every entry

### Requirement: Creator can instantiate a game from a template
Any authenticated creator SHALL be able to call `createGameFromTemplate` with
`{ templateGameId, title, scoringPreset? }` to create a new `Game` under their own `ownerUid`,
whose `stages`/`tasks` are cloned from the template with freshly generated ids. Every reference to
a stage or task id within the cloned content (`unlockAfterTaskIds`, `exclusiveGroups[].taskIds`)
SHALL be rewritten to point at the corresponding NEW id, not the source template's id. An unknown
or non-template `templateGameId` SHALL be rejected with `invalid-argument`. The source template
game SHALL be unmodified by instantiation.

#### Scenario: Successful instantiation preserves the unlock graph
- **WHEN** a creator calls `createGameFromTemplate` with a `templateGameId` whose stages include a
  task with `unlockAfterTaskIds` referencing another task in the same template
- **THEN** the new game's corresponding task has `unlockAfterTaskIds` pointing at the NEW cloned
  id of that other task (not the source template's id), and every stage/task id in the new game
  differs from every id in the source template

#### Scenario: Exclusive groups preserved
- **WHEN** a template's stage has an `exclusiveGroups` entry referencing task ids in that stage
- **THEN** the cloned stage's `exclusiveGroups[].taskIds` reference the cloned tasks' new ids

#### Scenario: Unknown template rejected
- **WHEN** a creator calls `createGameFromTemplate` with a `templateGameId` that does not exist or
  is not flagged `isTemplate: true`
- **THEN** the call is rejected with `invalid-argument` and no game is created

#### Scenario: Source template untouched
- **WHEN** a creator instantiates a game from a template
- **THEN** the source template game's `stages`, `tasks`, and all other fields remain unchanged

### Requirement: Admin manages templates via the normal Builder
An admin SHALL be able to reach a dedicated management view (`/admin/templates`, gated the same
way as `/admin/users`) listing their own template-flagged games, from which they can create a new
template (which opens directly in the standard Builder for stage/task authoring), edit an existing
template's stages/tasks in that same Builder, adjust its `templateEmoji`/`templateOrder`, and
delete it via the existing soft-delete flow. A non-admin SHALL be denied access to this view.

#### Scenario: Non-admin denied
- **WHEN** a signed-in user without the `admin` custom claim navigates to `/admin/templates`
- **THEN** they see an access-denied state and no template data is fetched

#### Scenario: Admin creates and edits a template like a regular game
- **WHEN** an admin creates a new template from `/admin/templates`
- **THEN** they are taken to the standard Builder for that game, and edits made there are saved
  through the existing `updateGame` callable exactly as for any other game
