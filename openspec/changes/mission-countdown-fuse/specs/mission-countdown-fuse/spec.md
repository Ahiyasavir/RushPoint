## ADDED Requirements

### Requirement: A mission's time limit is a live fuse
A player on a mission with a time limit SHALL see a strip with the time left in large digits and a bar
that drains in proportion to the time already used. The strip SHALL keep a constant height while it
counts and SHALL never cover the answer controls or the SOS button.

#### Scenario: Half the time is gone
- **GIVEN** a 4 minute mission
- **WHEN** 2 minutes have passed
- **THEN** the bar is half drained, it turns amber and says "תזדרזו!"

#### Scenario: The final seconds
- **GIVEN** a mission with 10 seconds left
- **WHEN** each second passes
- **THEN** the digits pop and the phone gives a short tick, if sound is on

### Requirement: The countdown marks moments, not every second
Crossing half time, the final stretch and the last 10 seconds SHALL each be marked once (sound, haptic,
and a screen reader announcement). A refresh that adds time back SHALL NOT mark a moment again.

#### Scenario: A refresh after a hold
- **GIVEN** a team whose countdown already crossed half time
- **WHEN** a staff hold is resumed and the countdown jumps back up
- **THEN** no half time moment is marked again

### Requirement: The fuse respects the player's settings
Sounds and haptics SHALL follow the existing mute. With reduced motion requested, the fuse SHALL show
phases by colour and text only, without pulsing, popping or shaking.

#### Scenario: Muted
- **WHEN** sound is off and the last 10 seconds run
- **THEN** no sound plays and the phone does not vibrate, and the digits still count down
