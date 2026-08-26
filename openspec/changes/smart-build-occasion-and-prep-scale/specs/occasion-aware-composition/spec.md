## ADDED Requirements

### Requirement: The occasion biases which missions are chosen
The composer SHALL take the occasion as an input and SHALL bias mission fit toward the activity
kinds that suit that occasion. The bias SHALL be a soft scoring term only: it SHALL NOT exclude
any mission, and a mission carrying none of the occasion's favoured tags SHALL remain eligible.
The neutral occasion SHALL apply no bias.

#### Scenario: A favoured mission outranks an equal unfavoured one
- **WHEN** two missions are identical on every other scoring term and one carries an activity tag
  the occasion favours
- **THEN** the favoured mission scores strictly higher

#### Scenario: The bias never empties a pool
- **WHEN** no mission in the bank carries any tag the chosen occasion favours
- **THEN** a complete game is still composed

#### Scenario: The neutral occasion changes nothing
- **WHEN** the occasion is "something else / not sure"
- **THEN** every mission scores exactly what it scored before the occasion term existed

### Requirement: The occasion selects the stage structure
Each occasion SHALL declare a preferred stage blueprint — how many stages the game has, how
missions are distributed across them, and the difficulty curve. The composer SHALL use the
occasion's preferred blueprint when the mission budget can hold it, and SHALL fall back to the
existing eligibility-filtered random choice when it cannot. Blueprint selection SHALL consume the
same number of random draws in both cases, so a given seed stays reproducible.

#### Scenario: The preferred blueprint is used when it fits
- **WHEN** an occasion declaring a 5-stage blueprint is composed with a budget large enough for it
- **THEN** the composed game has that blueprint's stage count and per-stage mission counts

#### Scenario: A budget too small falls back
- **WHEN** the mission budget cannot hold the occasion's preferred blueprint
- **THEN** a blueprint that does fit is chosen
- **AND** every stage still holds at least the minimum number of missions

#### Scenario: Two occasions with the same answers compose differently
- **WHEN** the same answers are composed twice under two occasions with different preferred
  blueprints
- **THEN** the two games differ in stage count or in how missions are spread across stages

### Requirement: The occasion names the stages
Stage titles SHALL come from the occasion's own set of titles when the occasion declares them, and
from the existing generic titles otherwise. Titles SHALL be supplied by the caller as localized
copy, SHALL be Hebrew in Hebrew and English in English, and a missing or malformed set SHALL fall
back to the generic titles rather than leaving a stage untitled.

#### Scenario: Occasion titles are used
- **WHEN** a wedding game is composed
- **THEN** its stages carry the wedding titles rather than the generic ones

#### Scenario: Missing occasion copy falls back
- **WHEN** the caller supplies no titles for the chosen occasion
- **THEN** every stage still receives a non-empty title from the generic set

#### Scenario: No stage is left nameless
- **WHEN** the copy callback throws or returns a malformed value
- **THEN** composition still succeeds and every stage has a non-empty title

### Requirement: The 5-point preparation level maps onto the existing prep tiers
The composer SHALL translate the 1–5 preparation level into the existing three mission prep tiers:
levels 1 and 2 tolerate no-prep missions only, levels 3 and 4 additionally tolerate
self-preparation, and level 5 additionally tolerates outside-partner missions. The tolerance SHALL
remain a hard exclusion. Level 4 SHALL differ from level 3 only by biasing toward missions pinned
to real spots, never by unlocking a mission level 3 could not receive. An absent or malformed
level SHALL behave as a level that excludes outside-partner missions.

#### Scenario: Outside-partner missions require level 5
- **WHEN** the preparation level is 1, 2, 3 or 4
- **THEN** no mission requiring an outside partner is composed into the game

#### Scenario: Levels 3 and 4 admit the same missions
- **WHEN** the same answers are composed at level 3 and at level 4
- **THEN** neither game contains a mission the other's tolerance would have excluded

#### Scenario: An absent level is safe
- **WHEN** the composer is handed answers with no preparation level at all
- **THEN** it composes a game containing no outside-partner mission
