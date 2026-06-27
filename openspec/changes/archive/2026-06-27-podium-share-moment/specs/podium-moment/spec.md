# Podium Moment

## ADDED Requirements

### Requirement: The Final screen plays a podium reveal
On run finalization the Final screen SHALL play a top-3 podium reveal with confetti. When
`prefers-reduced-motion` is active it MUST render the final podium instantly with no motion.

#### Scenario: Top-3 podium reveal plays
- **WHEN** a run finalizes and the Final screen opens
- **THEN** the top 3 teams are shown on a 1-2-3 podium with a reveal animation

#### Scenario: Reduced motion shows a static podium
- **WHEN** `prefers-reduced-motion: reduce` is active
- **THEN** the podium renders instantly without animation

#### Scenario: Podium selection is correct
- **WHEN** `selectPodium` is given the final rankings
- **THEN** gold/silver/bronze map to ranks 1/2/3 and `myPlacement` is the caller's rank
- **AND** fewer than 3 teams leaves the unused slots empty without error

### Requirement: Podium can be shared as a branded image
A "Share podium" action SHALL generate a branded podium image (logo + app link + QR via the
`share-branding` stamp) and route it to the native share sheet or download.

#### Scenario: Share podium produces a branded image
- **WHEN** a participant taps "Share podium"
- **THEN** a podium image is generated carrying the brand stamp and opened in the share sheet
