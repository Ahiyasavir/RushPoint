## ADDED Requirements

### Requirement: The organizer can publish contact numbers for a run
The platform SHALL let the run's owner set up to five contact numbers for the run, each with a label
and an audience (players, staff or both), and SHALL refuse a number it cannot turn into a call link.
Participants SHALL receive only the contacts meant for players; staff SHALL receive only those meant
for staff.

#### Scenario: Players can call the organizer
- **GIVEN** a run whose owner published an "organizer" number visible to players
- **WHEN** a participant opens the SOS sheet
- **THEN** a control that calls that number is shown

#### Scenario: A staff-only number stays with staff
- **GIVEN** a contact visible to staff only
- **WHEN** a participant loads its team state
- **THEN** that contact is not included

### Requirement: A team can be called from its page
When a game's registration collects a phone number, the team page and the staff app SHALL offer to
call and to message that team on WhatsApp, for operators allowed to contact teams.

#### Scenario: Call a team
- **GIVEN** a team that registered the phone number 050-1234567
- **WHEN** the organizer opens that team's page
- **THEN** a call control dials +972501234567

### Requirement: The organizer chooses the console's quick actions
The Run Console SHALL show a bar of up to six quick actions chosen by the organizer from a fixed
catalogue, SHALL remember the choice on the organizer's profile across devices, and SHALL show a
default set until the organizer customises it. The staff app SHALL offer the same bar limited to
actions its capabilities allow.

#### Scenario: Customise and keep
- **WHEN** the organizer adds "add points" to the bar on a laptop
- **THEN** the bar on their phone's console also shows "add points"

#### Scenario: A removed catalogue entry does not break the bar
- **GIVEN** a saved bar that includes an action no longer in the catalogue
- **WHEN** the console loads
- **THEN** the bar shows the remaining actions and nothing fails
