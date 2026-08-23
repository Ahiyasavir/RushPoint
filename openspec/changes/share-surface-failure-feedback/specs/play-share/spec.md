# play-share spec delta

## ADDED Requirements

### Requirement: Recap and challenge share buttons always give feedback
The recap and challenge-teaser share buttons SHALL always give the user
feedback and never end as a silent no-op. They SHALL read the outcome returned
by their share ladder and act on it. A genuine share failure SHALL fall back to
copying the share link to the clipboard and showing a "couldn't share, link
copied" confirmation, so the tap always yields either the share sheet or a
copied link. A user-cancellation of the native share sheet SHALL end quietly
with no confirmation and no false "shared" message. A successful share, download,
or clipboard copy SHALL show a positive confirmation. All feedback copy SHALL be
routed through `t.*` in both Hebrew and English.

#### Scenario: A failed share falls back to copy and feedback
- **WHEN** a participant taps Share on the recap or challenge teaser and the
  native share sheet or image build fails (outcome `failed`)
- **THEN** the share link is written to the clipboard and a transient "couldn't
  share, link copied" confirmation is shown
- **AND** the button is re-enabled, never left as a silent no-op

#### Scenario: A user-cancellation ends quietly with no false success
- **WHEN** a participant opens the native share sheet and dismisses it (outcome
  `cancelled`, an `AbortError` from `navigator.share`)
- **THEN** no confirmation is shown and no "shared" message appears
- **AND** the button is re-enabled

#### Scenario: A successful share confirms
- **WHEN** a share, download, or clipboard copy succeeds (outcome `shared`,
  `downloaded`, or `copied`)
- **THEN** a transient positive confirmation is shown and auto-clears
