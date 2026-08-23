## ADDED Requirements

### Requirement: The finish reveal surfaces earned badges under eventual consistency

The FinalScreen SHALL display the player's earned cross-run badges once the run is finalized, even
though badges are written asynchronously after finalize completes.

When the run is finalized and the fetched badge list is empty, the screen SHALL retry fetching the
player's profile a bounded number of times, spaced a short delay apart, and SHALL stop as soon as
badges arrive or the attempt cap is reached. The retry SHALL NOT be unbounded and SHALL NOT continue
after the badge list is non-empty.

When the run is not finalized, the screen SHALL NOT retry — a single fetch behaves as before.

A pending retry SHALL be cancelled if the screen unmounts or its finalized state changes, so no state
is set after unmount and no timer runs on.

The existing per-player "already seen" tracking and newly-unlocked highlighting SHALL be preserved
unchanged.

#### Scenario: Solo instant-play finish where badges lag the leaderboard

- **WHEN** the run is already finalized at first render and the first profile fetch returns no badges
- **THEN** the screen fetches the profile again a bounded number of times and renders the badges once
  they appear

#### Scenario: Badges present on the first fetch

- **WHEN** the first profile fetch already returns the earned badges
- **THEN** the screen renders them and does not schedule any further fetch

#### Scenario: Badges never arrive

- **WHEN** the run is finalized but the profile keeps returning no badges
- **THEN** the screen stops fetching at the attempt cap and does not fetch indefinitely

### Requirement: A genuine native share is confirmed

The FinalScreen result-share action SHALL show its success confirmation when the share is delivered
by the platform's native share as well as when the result is downloaded or copied.

A cancelled or failed share SHALL NOT show a success confirmation.

The confirmation SHALL reuse the existing translated "saved" label and SHALL NOT introduce a new
translation string.

#### Scenario: The player shares via the native share sheet

- **WHEN** the share completes through the platform native share
- **THEN** the button shows the same success confirmation shown for a download or copy

#### Scenario: The player cancels the native share sheet

- **WHEN** the native share is cancelled
- **THEN** the button shows no success confirmation

### Requirement: The finish reveal fires its audio and haptic climax once

At the finish reveal the FinalScreen SHALL fire the existing celebratory "rank up" sound-and-haptic
cue in step with the confetti, so the biggest celebration in the app is not silent.

The cue SHALL respect the persistent mute toggle: when sound is muted, no sound and no vibration
fire. The change SHALL NOT introduce a new sound; it SHALL reuse the existing cue.

The cue SHALL fire exactly once per reveal, not on every re-render of the screen.

The existing confetti burst SHALL continue to fire once, unchanged.

#### Scenario: Reveal with sound enabled

- **WHEN** the finish reveal plays and sound is enabled
- **THEN** the existing rank-up cue fires once alongside the confetti

#### Scenario: Reveal with sound muted

- **WHEN** the finish reveal plays and sound is muted
- **THEN** neither the sound nor the haptic fires

#### Scenario: The screen re-renders during the finish

- **WHEN** the FinalScreen re-renders for live leaderboard updates or survey steps
- **THEN** the cue does not fire again
