## ADDED Requirements

### Requirement: Staff SOS location link opens Google Maps in walking mode

The Staff console SOS / alert "open location" link SHALL open Google Maps in walking mode — a
directions URL carrying a walking travel mode (e.g.
`https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>&travelmode=walking`) — rather than a
bare map pin, because a staff member responding to an SOS on foot needs walking directions.

The link SHALL continue to appear only when the alert carries coordinates, SHALL open in a new tab
with `rel="noreferrer"`, and SHALL use the existing staff "open location" label. Its coordinates
SHALL come only from the alert document, and no second map provider SHALL be added.

#### Scenario: SOS alert with coordinates opens walking directions

- **WHEN** a staff member views an SOS alert that carries a latitude and longitude
- **THEN** an "open location" link is shown that opens Google Maps in walking mode to those coordinates

#### Scenario: Alert without coordinates shows no location link

- **WHEN** an alert has no latitude or longitude
- **THEN** no "open location" link is shown
