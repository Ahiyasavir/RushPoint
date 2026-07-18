# hidden-location-leak-guard Specification (delta)

## ADDED Requirements

### Requirement: The location-leak helper only flags hidden-location tasks

The pure helper `locationLeakWarnings(task)` SHALL return an empty result for any task whose
`hideLocation` is falsy (absent or `false`), regardless of what the `title` or `description`
contains. Only when a task's location is actually hidden can its participant-visible text defeat the
mechanic, so a visible-location task never produces a leak warning.

#### Scenario: Visible task with a place name is not flagged
- **WHEN** `locationLeakWarnings` runs on a task with `hideLocation` absent/false and a title that
  names a place ("Meet at Jaffa Gate")
- **THEN** it returns an empty list (no warning)

#### Scenario: Hidden flag is required to warn
- **WHEN** the identical title/description is set on a task with `hideLocation: true`
- **THEN** the helper evaluates the text and may return a warning (hidden tasks are in scope)

---

### Requirement: Place-naming text in title or description is flagged per field

For a hidden-location task, `locationLeakWarnings` MUST return the participant-visible text field(s)
(`'title'` and/or `'description'`) that contain an obvious place-naming token, using a curated
bilingual (English + Hebrew) token set. The check SHALL be applied independently to each field so the
Builder can tell the creator exactly which field leaks. The result is advisory only and MUST NOT
block saving or mutate the creator's text.

#### Scenario: English place token in the title
- **WHEN** a hidden-location task has the title "Meet at the Old City fountain"
- **THEN** the helper's result includes `'title'`

#### Scenario: Hebrew place token in the description
- **WHEN** a hidden-location task has a description containing "ברחוב יפו"
- **THEN** the helper's result includes `'description'`

#### Scenario: Both fields leak
- **WHEN** a hidden-location task names the spot in both its title and its description
- **THEN** the helper's result includes both `'title'` and `'description'`

---

### Requirement: Neutral text and the clue field do not produce false warnings

`locationLeakWarnings` SHALL return an empty result for a hidden-location task whose `title` and
`description` carry no place-naming token, and SHALL NOT consider the `locationClue` /
`locationClueHe` fields (the clue is meant to describe the spot). Matching MUST respect word
boundaries for English tokens so a token appearing only as a fragment inside a larger word does not
trigger a warning.

#### Scenario: Bare instruction is not flagged
- **WHEN** a hidden-location task has the title "Find the secret spot" and no place token in its
  description
- **THEN** the helper returns an empty list

#### Scenario: Clue text is exempt
- **WHEN** a hidden-location task puts the place name only in its `locationClue`, with a neutral
  title/description
- **THEN** the helper returns an empty list (the clue is not checked)

#### Scenario: Fragment inside a longer word does not match
- **WHEN** a hidden-location task's title contains a location token only as a substring of an
  unrelated word (e.g. "apartment")
- **THEN** the helper does not flag that field on the fragment alone

---

### Requirement: The Builder warns the creator without blocking

The Builder SHALL display a non-blocking caution whenever a creator has `hideLocation` enabled on a
task and `locationLeakWarnings` returns one or more fields; the caution names the offending field(s)
and advises moving the place name into the location clue. The warning MUST NOT prevent saving or
launching and MUST NOT alter the authored text. All warning strings SHALL route through
`t.*` (i18n) with both Hebrew and English values and pass the i18n correctness gate.

#### Scenario: Caution appears when the title leaks
- **WHEN** a creator enables hide-location and types a place-naming title
- **THEN** a non-blocking caution is shown pointing at the title, and the task can still be saved

#### Scenario: Caution clears when text is fixed
- **WHEN** the creator rewrites the title/description to remove the place token
- **THEN** the caution disappears and nothing about the save flow was blocked in the meantime
