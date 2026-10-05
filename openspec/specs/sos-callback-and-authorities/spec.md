# sos-callback-and-authorities Specification

## Purpose
TBD - created by archiving change sos-callback-and-authorities. Update Purpose after archive.
## Requirements
### Requirement: SOS offers every emergency service

The SOS sheet SHALL offer a "contact the authorities" action that shows call links for Magen David
Adom (101), the police (100) and fire and rescue (102).

#### Scenario: A team in danger
- **WHEN** a player opens SOS and taps "פנייה לרשויות"
- **THEN** three call links appear, and tapping one dials that number without closing the sheet

### Requirement: An SOS alert carries a number to call back

The SOS sheet SHALL ask for a phone number of one of the team, and the alert SHALL carry it to the
console and the staff app as a call link. Sending SHALL NOT require it.

#### Scenario: Sending with a number
- **WHEN** a player types 050-1234567 and sends
- **THEN** the organizer's SOS row shows that number as a call link

#### Scenario: Sending without a number
- **WHEN** a player sends with the field empty
- **THEN** the alert is sent

