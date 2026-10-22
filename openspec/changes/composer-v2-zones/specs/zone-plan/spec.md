## ADDED Requirements

### Requirement: A game spread over areas can be arranged one stage per area
When a game's pins fall into two or more areas that its stages mix, the Builder SHALL offer to
regroup it one stage per area, in walking order, without asking the creator anything.

#### Scenario: No walking back and forth
- **WHEN** the creator arranges a game whose stages mix three areas
- **THEN** every stage holds the pins of one area, and the stages follow a walking route

#### Scenario: A far area is reached first
- **WHEN** an area is more than 400 m from the previous one
- **THEN** its stage opens with an arrival mission, and its other missions unlock after it

#### Scenario: The creator's own logic is untouched
- **WHEN** the game has an authored unlock gate or exclusive group
- **THEN** no offer is shown

#### Scenario: Undo
- **WHEN** the creator undoes the arrangement
- **THEN** the game is exactly as it was
