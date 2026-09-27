## MODIFIED Requirements

### Requirement: The per-team device ceiling follows the team

The number of devices a team may attach SHALL be derived from the size that team
declared, rather than being a single constant for every team.

A team that declared more members than the previous fixed ceiling SHALL be able to
attach a device for each of them, up to a bound the run as a whole can afford. A team
that declared fewer, or none, SHALL keep at least the previous allowance, so no team
loses capacity it has today.

The run-wide device ceiling SHALL continue to apply, and SHALL continue to be the
authority when the two disagree.

#### Scenario: A large team can attach a device each

- **WHEN** a team declared six members
- **THEN** six devices may attach to it

#### Scenario: A small team keeps today's allowance

- **WHEN** a team declared one member, or none
- **THEN** it may still attach as many devices as it could before this change

#### Scenario: The run ceiling still wins

- **WHEN** a run has reached its total device ceiling
- **THEN** no further device attaches, whatever the team's own allowance says

### Requirement: A non-controller device may contribute

A device attached to a team but not holding control SHALL be able to record a
contribution to a mission that requires contributors.

This SHALL remain the only state-changing action available to a non-controller device.
Submitting, answering, checking in and every other mutation SHALL continue to require
control, so a contribution is an additive act and never a second route to completing a
mission.

#### Scenario: A teammate can contribute without taking control

- **WHEN** a non-controller device contributes to a mission that requires contributors
- **THEN** the contribution is recorded
- **AND** control does not change hands

#### Scenario: A teammate still cannot submit

- **WHEN** a non-controller device attempts any other mutation
- **THEN** it is refused exactly as before
