# desktop-layouts-play-staff Specification

## Purpose
TBD - created by archiving change desktop-layouts-play-staff. Update Purpose after archive.
## Requirements
### Requirement: The phone layout does not change

Below 1024 CSS pixels of window width, the staff app and the player's game screen SHALL render
exactly as before: one column, the same section order.

#### Scenario: A phone
- **WHEN** a marshal opens the staff app on a 375px phone
- **THEN** the sections appear in the same order as before this change, with the quick bar

### Requirement: The staff app uses a computer's width

At 1024 CSS pixels and wider, the staff app SHALL lay its sections out in three columns ("עכשיו",
teams, map and communication), every section appearing exactly once, and SHALL NOT show the quick
bar.

#### Scenario: A laptop
- **WHEN** a marshal opens the staff app on a 1440px window
- **THEN** help calls and photos to review, the team list, and the map and chats are all visible side by side

### Requirement: The player's game screen puts map and mission side by side

At 1024 CSS pixels and wider, the player's game screen SHALL show the map and the mission side by
side, the mission in its own scrolling column with no drawer, and the map SHALL NOT reserve space for
a sheet.

#### Scenario: Playing from a computer
- **WHEN** a team plays a located mission on a 1440px window
- **THEN** the map fills one side and the mission is fully readable in the other, without dragging anything

