## ADDED Requirements

### Requirement: Creator pages compose focused units under a size ceiling
A creator-web page or top-level component SHALL act as a composition root that wires together
focused, single-responsibility units, rather than inlining many independent stateful
sub-components and long render bodies in one file. When a page accumulates multiple independent
panels/steps, each such unit SHALL live in its own co-located file (a per-page folder), and the
page file SHALL retain only orchestration (data wiring, action handlers, layout). This is a
maintainability invariant only — it MUST NOT change any rendered output, layout, copy, styling, or
user-facing behavior, and it MUST NOT alter the prop contract seen by each extracted unit.

#### Scenario: A god-component is decomposed into a folder of units
- **WHEN** a creator-web page inlines many independent stateful sub-components in a single file
  (for example the Run Console's join/broadcast/hot-zone/trackables/zones/feed/chat/heatmap/
  analytics/feedback/survey panels)
- **THEN** each sub-component is moved to its own co-located file and the page becomes a thin
  composition root that imports and arranges them, with every panel receiving the same props it
  received before

#### Scenario: Draft/persistence state is extracted from the view
- **WHEN** a builder-style page owns document-draft mechanics (undo/redo history, debounced
  autosave, unsaved-changes guard, load/save) intermixed with its render logic
- **THEN** that state machine is extracted into a dedicated hook the page consumes, leaving the
  page to hold only view-navigation state and render the panels

#### Scenario: Behavior is preserved across a decomposition
- **WHEN** a page or component is decomposed into co-located units or a shim re-export
- **THEN** the production builds (`creator:build` and `play:build`) stay green, the screen renders
  and behaves identically in preview verification, and no callable, route path, Firestore shape,
  security rule, or shared type is changed

### Requirement: Long-form legal copy lives in data, not JSX
The bilingual Privacy Policy and Terms of Service prose SHALL be stored as data (a typed content
module or markdown assets), separate from the React component that renders it. The rendering
component SHALL read the copy from that data source and render it through the shared markdown
helpers, rather than inlining the full document bodies as literals in the `.tsx` render module.
Relocating the copy MUST preserve it character-for-character and MUST keep its existing bilingual
handling — the legal prose is not re-routed through the app translation dictionaries (`t.*`), and
the relocation introduces zero new i18n findings.

#### Scenario: Legal bodies are moved out of the render module
- **WHEN** the Legal page inlines the full Hebrew and English document bodies as template literals
  inside its component module
- **THEN** those bodies are moved verbatim into a separate legal-content data module, and the page
  imports and renders them via the existing markdown renderer, with the he/en toggle and RTL/LTR
  direction unchanged

#### Scenario: The legal move keeps i18n correctness
- **WHEN** the bilingual legal literals are relocated to the data module
- **THEN** `npm run i18n:check` stays clean, with no Hebrew string landing in an English position
  (or vice versa) and no new hardcoded-string findings introduced by the move

### Requirement: A screen uses a single stated live-data paradigm
A creator-web screen that displays live run/team data SHALL use one consistent data-freshness
paradigm across the entities it shows, rather than mixing a reactive `onSnapshot` listener for
some entities with a timer-based poll for others without justification. Where a listener is
feasible (the data is directly readable under the security rules), the screen SHALL use the
listener; where a poll is deliberately retained, the reason SHALL be documented inline at the poll
site. Converging paradigms MUST preserve the displayed data exactly (same rows, same values).

#### Scenario: The Run Console teams table stops polling when a listener is available
- **WHEN** the Run Console reads the run document and alerts via `onSnapshot` but fetches the teams
  table via a `setInterval` poll of a callable, and the teams subcollection is owner-readable under
  the security rules
- **THEN** the teams table is converted to an `onSnapshot` listener producing the same row shape
  and order, and the poll is removed — the screen's live sources are uniformly push-based

#### Scenario: A retained poll is justified
- **WHEN** a listener cannot reproduce a callable's server-side shaping and the poll must stay
- **THEN** the poll remains as the single stated paradigm for that entity with an inline comment
  explaining why a listener is not used, and the displayed rows are verified identical to before
