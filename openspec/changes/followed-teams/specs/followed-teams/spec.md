## ADDED Requirements

### Requirement: A person can follow a few teams
The run console and the staff app SHALL let the person using them mark up to 8 teams as followed
with one tap wherever a team is shown, and unmark them the same way. The list SHALL be kept per run
and per person on that device, and SHALL survive a reload. A team that leaves the run SHALL drop
out of the list.

#### Scenario: Following a team
- **GIVEN** a marshal looking at the staff app's team list
- **WHEN** they tap the star next to "הלביאות"
- **THEN** "הלביאות" appears in the "הקבוצות שלי" strip
- **AND** it is still there after the page is reloaded

#### Scenario: The list is full
- **GIVEN** a person already following 8 teams
- **WHEN** they tap the star on a ninth team
- **THEN** the team is not added and they are told the list is full

### Requirement: Followed teams are visible at a glance
The top of the console's "עכשיו" screen and of the staff app SHALL show one card per followed team
with the team's name, what it is doing now, and a status. A status that needs attention (SOS, out of
bounds, waiting for approval, stuck, paused) SHALL be coloured and stated in words; any other status
SHALL be neutral. Tapping a card SHALL open that team's page.

#### Scenario: A followed team sends a photo for approval
- **GIVEN** a person following "הלביאות"
- **WHEN** "הלביאות" sends a photo that needs approval
- **THEN** its card shows that it is waiting for approval and for how long
- **AND** the card offers "לאשר" if the person may review

### Requirement: Quick movement and filtering
A followed team's page SHALL offer previous and next buttons that move between followed teams. The
team list, the map and the "now" list SHALL offer a "mine only" filter, and items of followed teams
SHALL be listed first even when the filter is off.

#### Scenario: Moving between followed teams
- **GIVEN** a person following three teams, on the page of the first
- **WHEN** they press "הבאה"
- **THEN** the page of the second followed team opens

### Requirement: Following never offers an action the person may not take
An action on a followed team's card SHALL be shown only when the person's permissions allow it; the
card SHALL still open the team page otherwise.

#### Scenario: A marshal without scoring rights
- **GIVEN** a staff code without the review permission
- **WHEN** a followed team is waiting for approval
- **THEN** the card shows the waiting status without an approve button

### Requirement: Followed teams stand out on the map
On the console's live map and the staff app's map, a followed team's position SHALL be drawn in a
distinct colour with its name, above the other teams, so it can be found at a glance; the colour
SHALL NOT be one of the warning colours (amber, red) that mean something is wrong.

#### Scenario: Finding my team on the map
- **GIVEN** a marshal following "הלביאות" among twelve teams
- **WHEN** they open the map
- **THEN** "הלביאות" is drawn in the "followed" colour with its name, on top of the other teams
