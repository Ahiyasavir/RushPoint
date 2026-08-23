## ADDED Requirements

### Requirement: A failed action is always reported
Any user-initiated action in `apps/play-web` or `apps/creator-web` that can be rejected SHALL, on
rejection, render a visible message in the active UI language. A rejection SHALL NOT be absorbed by
an empty `catch`, and SHALL NOT be reported only by the absence of a state change.

#### Scenario: Capture-zone claim is rejected
- **WHEN** a participant taps "capture" on a zone and the `captureZone` callable rejects
- **THEN** an inline failure message appears next to that zone
- **AND** the message is drawn from the translation map, not from the server's text

#### Scenario: Trackable pickup is rejected
- **WHEN** a participant taps "pick up" on a trackable and the callable rejects
- **THEN** an inline failure message appears next to that trackable

#### Scenario: Location is not yet available for a capture
- **WHEN** a participant taps "capture" before the device has produced a position fix
- **THEN** a message explains that the position is not ready yet
- **AND** no callable is invoked

#### Scenario: Chat message fails to send
- **WHEN** `sendTeamChatMessage` rejects
- **THEN** the composer keeps the typed draft
- **AND** a "could not send, tap to retry" line appears above the composer

#### Scenario: Publishing a game fails
- **WHEN** the creator toggles a game's visibility and `publishGame` rejects
- **THEN** a localized error notification appears
- **AND** the badge does not silently keep its previous state without explanation

### Requirement: Errors are distinguishable from progress
A surface that reports both progress and errors through the same region SHALL visually distinguish
them, and SHALL expose the region to assistive technology as a live region.

#### Scenario: Task card shows a server rejection
- **WHEN** a submission is rejected (for example "Too far from the spot")
- **THEN** the task card's message renders in the alert colour with a warning marker

#### Scenario: Task card shows progress
- **WHEN** a photo upload is in flight, or a submission was approved
- **THEN** the task card's message renders in the neutral colour with no warning marker

#### Scenario: Assistive technology is notified
- **WHEN** the task card's message changes for any reason
- **THEN** the message region carries `role="status"` and `aria-live="polite"`

### Requirement: No surface renders a raw server message
User-facing copy SHALL come from the translation maps. A rejection's `message` or `code` MAY be
written to the console, but SHALL NOT be rendered.

#### Scenario: Staff console receives a permission error
- **WHEN** a Firestore snapshot or a staff callable rejects with `permission-denied`
- **THEN** the console shows the localized "your staff session expired" copy
- **AND** the raw English text "Missing or insufficient permissions" is not rendered

#### Scenario: A credit purchase is rejected
- **WHEN** `purchaseCredits` or `subscribePro` rejects
- **THEN** the dialog shows copy selected by the rejection's error code, falling back to localized
  generic copy for an unrecognized code
- **AND** the underlying error is written to the console

### Requirement: A failed state always offers a way forward
No screen SHALL be reachable in which an action has failed and the only remaining affordance is
irrelevant to recovery.

#### Scenario: The team has no active stage
- **WHEN** the participant's team state contains no active stage and no pending stage release
- **THEN** the screen shows an icon, an explanation that the host may still be setting up, and a
  retry control that re-fetches the team state

#### Scenario: Routing takes a long time
- **WHEN** the app has been waiting for a next-task assignment for more than about 12 seconds
- **THEN** an animated indicator is visible for the whole wait
- **AND** a retry control appears that re-issues the routing request

#### Scenario: Instant play fails for a first-time visitor
- **WHEN** `startInstantPlay` rejects on the public game page
- **THEN** an error line appears with a retry control and a pointer to the "I have a code" path

#### Scenario: A public leaderboard fails to load
- **WHEN** `getPublicLeaderboard` rejects
- **THEN** the unavailable state offers a retry control that re-runs the load

#### Scenario: The staff session has expired
- **WHEN** the staff console maps a rejection to an expired session
- **THEN** a control is offered that clears the stored staff session and returns to the PIN screen

#### Scenario: Wallet status fails to load
- **WHEN** `getWalletStatus` rejects
- **THEN** the page leaves its loading state and shows a localized error with a retry control
- **AND** the page does not remain on a spinner indefinitely

#### Scenario: Creating a game from a template fails
- **WHEN** the creator picks a template and `createGame` or `updateGame` rejects
- **THEN** a localized error is shown
- **AND** the template picker is re-opened so the creator's choice is not lost

### Requirement: A stale error clears on recovery
An error line driven by a live data subscription SHALL be cleared when that subscription next
delivers data successfully.

#### Scenario: Staff snapshot recovers
- **WHEN** the staff console has shown a read error and a subsequent snapshot delivers successfully
- **THEN** the error line is removed

### Requirement: Broadcast is gated on content in either language
The staff announcement composer SHALL treat Hebrew as the primary field and English as optional,
SHALL enable its send control when either field has content, and SHALL never dispatch an
announcement whose participant-visible body is empty.

#### Scenario: A Hebrew-only volunteer broadcasts
- **WHEN** the volunteer fills only the Hebrew field
- **THEN** the broadcast control is enabled
- **AND** the dispatched announcement carries the Hebrew text in both the Hebrew field and the
  default body, so a participant in either language sees text

#### Scenario: An English-only organizer broadcasts
- **WHEN** the organizer fills only the English field
- **THEN** the broadcast control is enabled and the announcement carries the English text

#### Scenario: Both fields are empty
- **WHEN** neither field has content
- **THEN** the broadcast control is disabled

#### Scenario: A broadcast is rejected
- **WHEN** `pushAnnouncement` rejects
- **THEN** a localized error appears
- **AND** both drafts are preserved for a retry
