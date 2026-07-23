## ADDED Requirements

### Requirement: The Builder Settings feature toggles are grouped under one collapsed section
The Builder Settings panel SHALL present its four game feature switches — instant play, live photo
feed, power ups and manual leaderboard reveal — inside a single collapsed section, consistent with
the other collapsed sections of the panel, rather than as flat always expanded controls.

Every one of the four switches SHALL remain reachable and settable, and SHALL continue to control the
same run behavior it controls today. Grouping the switches SHALL NOT change what the Builder saves for
any of them.

#### Scenario: The four feature toggles live in one collapsed section
- **WHEN** a creator opens the Builder Settings panel
- **THEN** the instant play, live photo feed, power ups and manual leaderboard reveal switches are
  presented together under one collapsed, labelled section
- **AND** each switch is reachable by expanding that section and can be turned on or off there

#### Scenario: Grouping does not change what is saved
- **WHEN** a creator toggles any of the four feature switches inside the grouped section
- **THEN** the same game field is written that would have been written by the previous flat control
- **AND** no field that was saved before is dropped, and no new field is introduced

### Requirement: The grouped section shows how many features are on without being expanded
The collapsed feature section SHALL display a count of how many of its four features are currently on,
so an enabled feature stays visible while the section is closed. The count SHALL honor each feature's
real default: the live photo feed counts as on when its field is absent, and the other three count as
off when absent.

#### Scenario: A new game shows one feature on
- **WHEN** the section renders for a game that has set none of the four fields
- **THEN** the count reports one feature on, reflecting the live photo feed default

#### Scenario: The count reflects the effective toggles
- **WHEN** instant play and power ups are on, the live photo feed is turned off, and manual reveal is
  unset
- **THEN** the count reports two features on

#### Scenario: A malformed game never breaks the count
- **WHEN** the count is computed from a null, a non object, a number or an empty value
- **THEN** the computation does not throw and reports zero features on

### Requirement: Settings disclosure tiers are normalized to Essentials plus collapsed sections
The Builder Settings panel SHALL keep only the game's essentials — its mode and its short description
— always visible, and SHALL present every other field, including tags, as a consistently collapsed,
labelled section. No field currently editable in Settings SHALL become unreachable.

#### Scenario: Tags folds in with the other sections
- **WHEN** a creator opens the Builder Settings panel
- **THEN** mode and short description are shown flat
- **AND** tags is presented as a collapsed labelled section like the others, still reachable in one
  click

### Requirement: Every new Settings string is switchable between Hebrew and English
Every user facing string introduced by this grouping SHALL come from the creator console translation
maps in both Hebrew and English, and SHALL NOT be hardcoded in a component.

#### Scenario: The grouping adds no hardcoded string
- **WHEN** the creator console i18n check runs in strict mode
- **THEN** it reports no new hardcoded string in the Settings panel
- **AND** the new section title and count label are defined in both the Hebrew and the English map
