## ADDED Requirements

### Requirement: Dense Task Wizard form fields have an adequate minimum tap height
The `dense` variant of the shared `Input` and `Textarea` components SHALL render with enough
vertical padding to be comfortably tappable, while remaining visibly more compact than the
non-dense variant so a field-heavy Task Wizard step still fits without introducing new
scrolling.

#### Scenario: A dense field is taller than before
- **WHEN** a creator measures a dense `Input` or `Textarea` field's rendered height after this
  change
- **THEN** it is taller than the pre-change height by roughly 5-6px

#### Scenario: A field-dense step still fits without new scrolling
- **WHEN** a creator opens the Task Wizard's Details/Execution steps for a field-heavy task
  type (e.g. `quiz`) on a 375px-wide viewport
- **THEN** the step does not require scrolling where it did not require scrolling before this
  change
