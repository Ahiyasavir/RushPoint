## ADDED Requirements

### Requirement: The teams poll surfaces a stale board instead of freezing silently
The Run Console's periodic teams poll SHALL handle its own failure. When a poll fails, the console
SHALL keep the last-known teams data on screen and SHALL mark the board as stale with a visible,
unobtrusive indicator, rather than freezing last-known state with no signal. A subsequent successful
poll SHALL clear the stale indicator. The poll cadence and the teams data shape SHALL NOT change.

The stale decision SHALL be a pure, total function so it is testable without rendering: an explicit
poll error SHALL count as stale; otherwise the board SHALL be stale once the last good sync is older
than the tolerance; a board that has never synced yet without an error SHALL NOT be reported as stale
(the initial load owns that); and a non-finite clock or timestamp SHALL NOT throw.

#### Scenario: A failed teams poll marks the board stale but keeps last-known data
- **WHEN** a teams poll rejects while the console is live
- **THEN** the previously loaded teams, scores and attention badges stay on screen
- **AND** a stale indicator is shown on the teams panel so the operator knows the board is not current
- **AND** the poll cadence is unchanged

#### Scenario: A recovered poll clears the stale indicator
- **WHEN** a later teams poll succeeds after a failure
- **THEN** the teams data is refreshed and the stale indicator is removed

#### Scenario: The stale decision is pure and total
- **WHEN** the stale verdict is computed with an explicit error, or with a last-sync age past the
  tolerance, or from a null timestamp, or from a non-finite clock
- **THEN** it returns a well-formed boolean without throwing, treating an explicit error as stale and
  a never-synced no-error board as not stale

### Requirement: The alerts stream exposes a degraded state
The Run Console's unacknowledged-alerts listener SHALL surface its own error instead of swallowing it.
On a listener error the console SHALL set a visible "alerts unavailable" signal in an always-rendered
region, so an operator can distinguish "no SOS" from "cannot tell". The signal SHALL clear on the next
successful snapshot. The audible cue, the tab-title flash and the alerts panel rendering SHALL be
unchanged.

#### Scenario: A dead alerts stream shows an interrupted notice even at zero alerts
- **WHEN** the alerts listener errors while no alerts are currently active
- **THEN** an "alerts feed interrupted" notice is shown in the always-visible pinned region
- **AND** the notice clears once the listener delivers a fresh snapshot

### Requirement: The SOS audio cue works for a console opened on an already-live run
The Run Console SHALL unlock its audio context on the creator's first interaction with the page, so an
operator who opens an already-live run and never starts teams or invites staff still hears the SOS cue.
The unlock SHALL be idempotent and SHALL be a silent no-op where Web Audio is unavailable. The existing
gesture-based unlocks and the cue itself SHALL be unchanged.

#### Scenario: An already-live run still plays the SOS cue
- **WHEN** a creator opens the console of a run that is already live, interacts with the page once, and
  a team then raises an SOS
- **THEN** the audible alert cue plays

#### Scenario: First-interaction unlock is a safe no-op where audio is unavailable
- **WHEN** the console runs where Web Audio is unavailable or already unlocked
- **THEN** the first-interaction unlock does nothing and never throws
