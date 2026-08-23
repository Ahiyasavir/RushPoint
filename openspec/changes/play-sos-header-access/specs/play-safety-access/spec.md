## ADDED Requirements

### Requirement: SOS is reachable without scrolling during active play

While a team is actively racing, the participant screen SHALL present an emergency SOS control that
is on-screen without scrolling, in addition to any SOS control lower on the page.

The always-reachable control SHALL live in the sticky play header alongside the existing header
controls, so a player in trouble does not have to scroll past standings, feed, chat, or other
panels to summon help.

The header SOS control SHALL trigger the exact same SOS action as the existing bottom control — the
same confirmation prompt, the same best-effort location resolve, the same alert callable, and the
same success and failure messages. Both entry points SHALL share one in-flight guard so a rapid
double tap across them fires the alert only once.

The existing bottom SOS control SHALL remain present and unchanged; this requirement is additive.

The header SOS control SHALL expose an accessible name via a translated label, SHALL present at
least a 44px touch target, and SHALL use logical (RTL-safe) spacing so it lays out correctly in
Hebrew and English.

#### Scenario: A racing player needs help without scrolling

- **WHEN** a team is actively racing and the page has scrolled secondary panels below the fold
- **THEN** an SOS control is visible in the sticky header, and activating it opens the same confirm →
  send-alert flow as the bottom SOS button

#### Scenario: The header and bottom SOS drive one action

- **WHEN** the player activates SOS from the header
- **THEN** the same confirmation, location resolve, and alert callable run as when activating the
  bottom button, and a concurrent tap on the other control does not send a second alert

#### Scenario: The pre-start screen is unaffected

- **WHEN** the team is on the short pre-start screen (SOS already above the fold)
- **THEN** the header shows no additional SOS control and the pre-start SOS button is unchanged
