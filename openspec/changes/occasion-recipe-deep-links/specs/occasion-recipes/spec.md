## ADDED Requirements

### Requirement: A recipe is a named partial answer set that composes a real game

The system SHALL maintain a registry of named recipes. Each recipe SHALL declare an id, display copy
in every supported language, and a PARTIAL set of composer answers.

Partial is normative. A recipe SHALL declare only the answers its own name settles, and SHALL leave
every other answer undeclared rather than filling it with a default. An undeclared answer is a
question still to ask; a defaulted one is a guess presented to the creator as their own choice.

Every recipe in the registry SHALL compose a launch valid game from the real mission bank. A recipe
that cannot SHALL fail the build rather than reaching a creator.

#### Scenario: Every recipe composes

- **WHEN** each registered recipe's answers are passed to the composer against the real mission bank
- **THEN** a game is produced, and it satisfies the same structural validation the server enforces
  on save

#### Scenario: A recipe declares only what it settles

- **WHEN** a recipe's declared answers are inspected
- **THEN** every declared key is one the recipe's own name or subject determines, and no key is
  present merely to avoid asking

#### Scenario: Display copy exists in every language

- **WHEN** the registry is compared against the supported language set
- **THEN** every recipe has a name and a short description in each language, and none is a fallback
  to another language

### Requirement: The questionnaire asks only what the recipe left open

When the creator arrives holding a recipe, the questionnaire SHALL present only the questions that
recipe did not answer, in their existing relative order.

A recipe that answers every question SHALL compose immediately, presenting no questionnaire at all.

Navigation SHALL operate over the remaining questions only: moving forward from the last remaining
question SHALL finish, and moving back from the first SHALL leave the questionnaire, exactly as they
do when no recipe is held.

The creator SHALL retain the ability to change a recipe's answers after the game is composed. A
recipe pre-answers a question; it does not remove the creator's authority over it.

#### Scenario: Only the open questions are shown

- **WHEN** a creator arrives holding a recipe that declares occasion, audience, area, difficulty,
  preparation and activity preferences
- **THEN** the questionnaire shows only the questions for group size and duration, and shows them in
  that order

#### Scenario: A fully specified recipe asks nothing

- **WHEN** a creator arrives holding a recipe that declares every answer
- **THEN** no questionnaire is shown and the game is composed directly

#### Scenario: Navigation respects the reduced set

- **WHEN** the creator moves forward past the last remaining question
- **THEN** the questionnaire finishes, and **WHEN** they move back from the first remaining question
- **THEN** the questionnaire is left, with no skipped question ever becoming reachable by navigation

### Requirement: The recipe deep link fails closed

The creator console SHALL accept a recipe identifier as a URL parameter and open holding that
recipe.

Resolution SHALL be total and fail closed. An absent, empty, malformed, or unrecognised identifier
SHALL yield the ordinary wizard with no recipe held. It SHALL NOT throw, SHALL NOT resolve to a
different recipe, and SHALL NOT block the page from rendering.

#### Scenario: A known id is honoured

- **WHEN** the console is opened with a recipe identifier present in the registry
- **THEN** it opens holding that recipe

#### Scenario: An unknown id degrades to the ordinary wizard

- **WHEN** the console is opened with an identifier that is not in the registry
- **THEN** the ordinary wizard opens, no error is shown, and no recipe is held

#### Scenario: A malformed query string cannot break the page

- **WHEN** the console is opened with a query string that is not parseable, or with a non string
  value
- **THEN** resolution yields no recipe and the page renders normally

### Requirement: The composer knows the occasions the doors offer

The composer's occasion registry SHALL contain an occasion for every occasion the marketing doors
present, so that a visitor's stated occasion is carried into composition rather than discarded.

Specifically it SHALL carry an education occasion and a home occasion, each with a declared profile
of favoured activity tags and a stage blueprint, chosen for that occasion rather than copied from
another.

The neutral occasion SHALL remain available and SHALL remain unbiased.

#### Scenario: Every door's occasion exists

- **WHEN** the occasions named by the recipe registry are compared against the composer's occasion
  registry
- **THEN** every one of them is present

#### Scenario: The new occasions are profiled, not neutral copies

- **WHEN** the education and home profiles are inspected
- **THEN** each declares its own favoured activity tags and its own stage blueprint, and neither is
  identical to the neutral profile or to an existing occasion's profile

#### Scenario: The neutral occasion is unchanged

- **WHEN** the neutral occasion's profile is inspected after this change
- **THEN** it still favours no tags and still imposes no blueprint
