## ADDED Requirements

### Requirement: A template has a visibility state

A game flagged `isTemplate: true` SHALL carry a visibility state that decides
whether creators are offered it. The state SHALL have exactly two values,
`visible` and `hidden`, and SHALL be stored on the game document.

A template whose document carries no stored state SHALL be treated as `visible`.
Absence MUST NOT be read as `hidden`, and no migration, backfill or default write
may be required for an existing template to keep behaving as it does today.

#### Scenario: An existing template with no stored state

- **WHEN** a template document that predates this change is read by any listing
- **THEN** it is treated as `visible`
- **AND** it appears to creators exactly as it did before the change

#### Scenario: A template explicitly marked hidden

- **WHEN** a template document stores the `hidden` state
- **THEN** it is treated as `hidden` by every consumer of the state

### Requirement: The creator-facing catalogue excludes hidden templates

`listGameTemplates` SHALL NOT return a template whose state is `hidden`.

The exclusion SHALL be evaluated on a value the query actually returns. Where the
listing projects fields through a field mask, the field carrying the state MUST be
part of that mask.

The exclusion MUST NOT be expressed as a Firestore equality filter against the
non-hidden value, because such a filter does not match documents that lack the
field and would silently drop every pre-existing template.

#### Scenario: A hidden template is not offered

- **WHEN** an authenticated creator lists the templates
- **THEN** no hidden template appears in the result

#### Scenario: Pre-existing templates survive the filter

- **WHEN** an authenticated creator lists the templates
- **AND** some template documents carry no visibility field at all
- **THEN** every one of those templates appears in the result

#### Scenario: The state survives the projection

- **WHEN** the listing reads templates through a field mask
- **THEN** the field carrying the visibility state is included in that mask
- **AND** the filter therefore decides on a real value rather than `undefined`

### Requirement: The admin builder lists hidden templates and says so

`listAdminTemplates` SHALL return hidden templates alongside visible ones, and
SHALL report each template's visibility state to the caller.

An admin MUST be able to tell the two apart without opening a template.

#### Scenario: Hidden templates remain in the admin list

- **WHEN** an admin lists their templates
- **THEN** hidden templates appear in the result
- **AND** each returned template carries its visibility state

#### Scenario: The admin page distinguishes them

- **WHEN** the admin templates page renders a hidden template
- **THEN** that row is visibly marked as not offered to creators

### Requirement: An admin can change a template's visibility

`setGameTemplateFlag` SHALL accept the visibility state and persist it.

The field SHALL be optional. A call that omits it MUST leave the stored state
untouched, so that editing a template's emoji or order cannot change whether
creators can see it.

An unrecognised value SHALL be rejected with an invalid-argument error rather than
stored or coerced.

#### Scenario: Hiding a template

- **WHEN** an admin sets the visibility state to `hidden` on a template
- **THEN** the state is persisted
- **AND** the template stops appearing in the creator-facing catalogue
- **AND** it continues to appear in the admin builder

#### Scenario: Unhiding a template

- **WHEN** an admin sets the visibility state to `visible` on a hidden template
- **THEN** the template is offered to creators again

#### Scenario: An unrelated edit does not change visibility

- **WHEN** an admin updates a hidden template's emoji or order and sends no
  visibility value
- **THEN** the template remains hidden

#### Scenario: A malformed value is refused

- **WHEN** a caller sends a visibility value that is neither `visible` nor
  `hidden`
- **THEN** the call fails with an invalid-argument error
- **AND** nothing is written

### Requirement: A hidden template cannot be instantiated

`createGameFromTemplate` SHALL refuse to instantiate a template whose state is
`hidden`, regardless of how the caller obtained the template's identifier.

Removal from a listing is not an access control. The refusal SHALL be made by the
callable itself, against the stored document.

#### Scenario: A creator holds an id from before it was hidden

- **WHEN** a creator calls `createGameFromTemplate` with the id of a template that
  is now hidden
- **THEN** the call fails
- **AND** no game is created in the caller's account

#### Scenario: The admin who owns it is not exempt

- **WHEN** the template's owner calls `createGameFromTemplate` on their own hidden
  template
- **THEN** the call fails for the same reason
- **AND** the owner may still open and edit the template directly

#### Scenario: A visible template is unaffected

- **WHEN** a creator instantiates a template that is visible
- **THEN** the game is created exactly as before this change

### Requirement: A cached catalogue does not outlive a visibility change

Any client-side cache of the creator-facing template catalogue SHALL NOT serve a
hidden template after the cache would otherwise have been refreshed.

A creator who has a cached menu MUST NOT be able to start a game from a template
that has since been hidden — the refusal at instantiation is what guarantees this,
independently of cache freshness.

#### Scenario: A stale cached menu

- **WHEN** a creator's cached template menu still lists a template that has since
  been hidden
- **AND** the creator selects it
- **THEN** the instantiation is refused
- **AND** the creator is not left with a partially created game
