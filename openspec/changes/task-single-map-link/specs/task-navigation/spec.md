## ADDED Requirements

### Requirement: A located task leads with a walking-mode Google Maps navigation link

For a located task, the participant TaskRunner SHALL present navigation as a single primary
"navigate here" link that opens **Google Maps in walking mode**, with one subordinate secondary link
for the alternate provider (Waze), rather than two co-equal side-by-side provider links. Only the
primary link SHALL carry visual weight; the secondary provider SHALL be visibly demoted while
remaining reachable in a single tap.

The primary Google Maps URL SHALL request on-foot directions (a directions URL carrying a walking
travel mode, e.g. `.../maps/dir/?api=1&destination=<lat>,<lng>&travelmode=walking`) rather than a
bare pin, because RushPoint is a walking field game. Both providers SHALL stay reachable; the Waze
destination URL SHALL be unchanged. The rule that decides whether any navigation link may appear
SHALL be unchanged: a task whose location is the puzzle answer (hidden location) SHALL still show no
navigation link.

#### Scenario: One weighted primary (Google Maps, walking) and one demoted fallback

- **WHEN** a player views a located task with a resolvable navigation target
- **THEN** a single prominent "navigate here" link is shown as the primary control and opens Google Maps in walking mode
- **AND** the Waze provider is shown as a visibly subordinate secondary link, still one tap away

#### Scenario: Hidden-location tasks still get no navigation link

- **WHEN** a task's location is withheld as the puzzle answer
- **THEN** no navigation link is shown for either provider
