# Live Emoji Reactions

## ADDED Requirements

### Requirement: Viewers can broadcast ephemeral emoji reactions
A viewer of a live run's leaderboard / TV screen SHALL be able to tap an emoji from a closed set and
broadcast a floating reaction to all current viewers in near-real-time. Reactions MUST be ephemeral —
written to RTDB and never persisted to Firestore.

#### Scenario: A reaction floats for all viewers
- **WHEN** a viewer taps an emoji on the live screen
- **THEN** a floating reaction animates for all current viewers via RTDB
- **AND** nothing is written to Firestore

#### Scenario: Only the closed emoji set is allowed
- **WHEN** a reaction is broadcast
- **THEN** it is one of the predefined `REACTION_EMOJI` values (no free text)

### Requirement: Reactions are rate-limited per viewer
A per-viewer throttle SHALL suppress reactions sent within a minimum gap to prevent spam.

#### Scenario: Rapid taps are throttled
- **WHEN** `shouldThrottleReaction` is called within `minGapMs` of the last reaction
- **THEN** it returns true (the reaction is suppressed)

#### Scenario: Spaced taps are allowed
- **WHEN** `shouldThrottleReaction` is called after `minGapMs` has elapsed (or with no prior reaction)
- **THEN** it returns false (the reaction is allowed)

#### Scenario: Reduced motion fades instead of floating
- **WHEN** `prefers-reduced-motion: reduce` is active
- **THEN** incoming reactions fade in place rather than animating up the screen
