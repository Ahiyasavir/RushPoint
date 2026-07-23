## ADDED Requirements

### Requirement: Mission-library map coverage is classified, not inferred

The system SHALL classify a mission-library result set into exactly one map-coverage state before
rendering: no results, no result plottable, some results plottable, or every result plottable.

A mission SHALL be counted as plottable using the same published-area rule the map's markers use,
so the coverage classification and the plotted markers can never disagree about a mission.

A mission whose stored document carries only a deprecated exact coordinate, whose location is
hidden, which has no location at all, or whose published area is malformed, out of range, or the
unplaced placeholder, SHALL be counted as not plottable.

#### Scenario: Every result has a published area

- **WHEN** every mission in the result set carries a valid published area
- **THEN** the coverage state is "every result plottable"

#### Scenario: No result has a published area

- **WHEN** the result set is non-empty and no mission in it carries a valid published area
- **THEN** the coverage state is "no result plottable"

#### Scenario: A mixed result set is not reported as empty

- **WHEN** some missions in the result set carry a valid published area and others do not
- **THEN** the coverage state is "some results plottable"
- **AND** the state that reports nothing can be shown SHALL NOT apply

#### Scenario: An empty result set

- **WHEN** the result set contains no missions
- **THEN** the coverage state is "no results"

#### Scenario: Malformed entries do not throw

- **WHEN** the result set contains a missing entry, or an area with a non-numeric, out-of-range or
  unplaced-placeholder value
- **THEN** the classification completes and counts that entry as not plottable

### Requirement: An unplottable mission map explains itself

When a mission-library result set has results but none of them can be plotted, the map SHALL show,
in addition to the statement that no mission has a published area, an explanation of what produces
a published area and why an entry may lack one — namely that an area is produced when a game is
published, that entries published before the published-area rule existed do not have one until
their game is published again, and that a mission whose location is deliberately hidden never
appears on the map.

Both the statement and the explanation SHALL be served from the Hebrew and English dictionaries and
SHALL NOT be hardcoded in a component.

The explanation SHALL NOT be shown when at least one mission in the result set is plottable.

#### Scenario: Nothing plottable

- **WHEN** the mission-library map is shown for a result set in which no mission has a published
  area
- **THEN** the map states that no mission has a published area
- **AND** it also explains that an area is produced by publishing the game, that entries from
  before this rule need their game published again, and that hidden-location missions never appear

#### Scenario: Something plottable

- **WHEN** at least one mission in the result set has a published area
- **THEN** the map plots it and shows neither the statement nor the explanation

#### Scenario: Language

- **WHEN** the console is in Hebrew
- **THEN** both the statement and the explanation are rendered in Hebrew from the dictionary, and
  in English when the console is in English
