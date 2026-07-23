## ADDED Requirements

### Requirement: The Builder Analytics tab signposts where analytics live instead of promising them in place
The Builder's Analytics tab SHALL present an honest description of where run analytics live and a
control that navigates the creator to the runs overview, from which a run's console and its analytics
are opened. The tab SHALL NOT claim that run analytics render inside the tab itself.

The tab SHALL remain in the Builder's tab strip, so no navigation entry is removed. The ability to
view per run and per task analytics is unchanged: it is provided by the run console, and this change
neither adds nor removes any analytics rendering.

#### Scenario: The Analytics tab points to the runs overview
- **WHEN** a creator opens the Builder's Analytics tab
- **THEN** it shows a description stating that a run's analytics live with the run
- **AND** it offers a control that navigates to the runs overview where analytics are opened

#### Scenario: The tab no longer makes a promise it cannot keep
- **WHEN** a creator reads the Analytics tab body
- **THEN** it does not claim that run analytics will appear in the tab after a first live run

#### Scenario: Run analytics remain available in the run console
- **WHEN** a creator opens a finished run's console
- **THEN** its post run analytics render exactly as before this change

### Requirement: Every Analytics tab string is switchable between Hebrew and English
Every user facing string on the revised Analytics tab SHALL come from the creator console translation
maps in both Hebrew and English, and SHALL NOT be hardcoded in a component.

#### Scenario: The signpost adds no hardcoded string
- **WHEN** the creator console i18n check runs in strict mode
- **THEN** it reports no new hardcoded string on the Analytics tab
- **AND** the revised body copy and the new navigation button label are defined in both the Hebrew and
  the English map
