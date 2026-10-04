## ADDED Requirements

### Requirement: The flash panel shows current flashes in full and folds the rest

The Run Console SHALL show in full, with their actions, only flash missions that are still
running, that have a submission waiting for approval, or that ended less than 15 minutes ago
with nobody rewarded. Every other flash mission SHALL be folded into one closed "past" line.

#### Scenario: A flash with a submission waiting
- **WHEN** a flash ended an hour ago but a team's submission still waits for approval
- **THEN** it is shown in full with approve and reject

#### Scenario: A settled flash
- **WHEN** a flash ended an hour ago and a team won it
- **THEN** it appears only inside the folded past line, with its winner

#### Scenario: An announcement just ended
- **WHEN** an announcement-only flash ended five minutes ago and nobody was awarded
- **THEN** it is shown in full with the award picker

### Requirement: Past flashes say who won

A past flash SHALL show its title and the teams that won it, or that nobody did, and SHALL NOT
offer the award picker.

#### Scenario: Nobody won
- **WHEN** a past flash has no approved claim
- **THEN** its line says nobody won it
