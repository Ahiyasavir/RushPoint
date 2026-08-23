## ADDED Requirements

### Requirement: The Builder's back-to-games control meets a 44px minimum touch target on mobile
Below the `sm` breakpoint, the Builder header's back-to-games button SHALL present a hit area
of at least 44×44px, even though its text label stays hidden at that width.

#### Scenario: The back button is large enough to tap on mobile
- **WHEN** a creator measures the back-to-games button's hit area on a 375px-wide viewport
- **THEN** it is at least 44px on both axes

#### Scenario: The back button still navigates correctly
- **WHEN** a creator taps the back-to-games button, on mobile or desktop
- **THEN** the Builder leaves to the game list exactly as before this change

#### Scenario: The desktop button is unchanged
- **WHEN** a creator views the back-to-games button at or above the `sm` breakpoint
- **THEN** its geometry (padding, visible label) is identical to before this change
