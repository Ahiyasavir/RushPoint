## ADDED Requirements

### Requirement: Browser smoke for the participant legal documents
The browser smoke lane (`npm run test:ui`) SHALL cover play-web's `/terms` and `/privacy` routes
with render-level assertions that require no emulator and no backend, so a white-screen or
mis-routed regression on either legal document fails CI. The assertions SHALL be chosen so they
cannot pass on a blank page, on a stuck lazy-chunk fallback, or on a truncated document.

#### Scenario: the terms document renders its own content
- **WHEN** the smoke opens `/terms` on the participant origin with no emulator running
- **THEN** the document title, its "last updated" line and its section-1 heading are visible,
  the page carries several document headings rather than a single stub, and no uncaught page
  error or crash boundary is present

#### Scenario: the privacy document renders its own content
- **WHEN** the smoke opens `/privacy` on the participant origin with no emulator running
- **THEN** the privacy policy's own title, "last updated" line and section-1 heading are visible,
  the page carries several document headings, and no uncaught page error or crash boundary is
  present

#### Scenario: a legal path does not render the player screen
- **WHEN** the smoke opens `/terms` or `/privacy`
- **THEN** the participant Join UI (the access-code entry) is NOT present on the page

#### Scenario: the language switch swaps the document
- **WHEN** the smoke activates the English option on the terms page
- **THEN** the English title and English section-1 heading are visible

### Requirement: Browser smoke for the run console section rail
The browser smoke lane SHALL cover the creator run console's section rail with render-level
assertions proving the rail and the always-on-screen pinned zone both render and that selecting a
section changes the rendered pane. Because the console requires an authenticated creator and a live
run, this coverage MAY require the Firebase emulator; when the emulator is not running the spec
SHALL SKIP rather than fail, so the no-emulator configuration of the lane stays green.

#### Scenario: the rail and the pinned zone render for a live run
- **WHEN** the smoke signs in as a self-provisioned creator and opens the console of a run it
  launched, with the emulator running
- **THEN** the section navigation is visible with at least two destinations, the pinned join/share
  information is on screen although it belongs to no section, and no crash boundary is present

#### Scenario: the active rail entry and the rendered pane agree
- **WHEN** the console is showing a section
- **THEN** exactly one rail entry is marked current and its label matches the heading of the
  rendered pane

#### Scenario: selecting another section changes the pane
- **WHEN** the smoke activates a rail entry other than the current one
- **THEN** the rendered pane's heading becomes that entry's label and the current marker moves to it

#### Scenario: no emulator means skip, not fail
- **WHEN** the lane runs with no Firebase emulator reachable
- **THEN** the run-console spec is reported as skipped and the lane's overall result is unaffected
