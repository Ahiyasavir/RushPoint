## ADDED Requirements

### Requirement: Blank template is first in the picker
The game-creation template picker SHALL present the blank template (`key: 'blank'`) as the first
item, before every niche or generic-starter template.

#### Scenario: Creator opens the template picker
- **WHEN** a creator opens the new-game template picker
- **THEN** the first template shown is the blank template ("תבנית ריקה" / its English label)

#### Scenario: Adding a new template does not disturb blank's position
- **WHEN** a new `GameTemplate` entry is added to `TEMPLATES`
- **THEN** the blank template SHALL still be first, regardless of where the new entry is inserted
  in source
