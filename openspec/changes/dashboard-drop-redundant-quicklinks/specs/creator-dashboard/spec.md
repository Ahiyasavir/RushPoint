## ADDED Requirements

### Requirement: The Dashboard next-steps section is not redundant with the top nav

The creator Dashboard SHALL NOT duplicate top-nav destinations as an additional grid of quick-action
cards. Where the top nav already links Build, Gallery, and Wallet, the Dashboard's "next steps"
section SHALL present at most one intentional nudge (the feature banner) rather than re-linking the
same destinations a second and third time.

Every destination SHALL remain reachable: Build, Gallery, and Wallet stay in the persistent top nav,
and the retained feature banner keeps its Gallery and (in paid mode) Wallet calls to action.

Removing the quick-action grid SHALL be presentation-only: the underlying quick-card identifiers and
their translation strings SHALL remain in the codebase so existing unit tests and dictionary parity
continue to pass; only their rendering on the Dashboard is removed.

#### Scenario: Dashboard shows a single next-step nudge

- **WHEN** a creator with at least one game views the Dashboard
- **THEN** the "next steps" section shows the feature banner and no redundant quick-action card grid

#### Scenario: All destinations stay reachable

- **WHEN** the quick-action grid has been removed
- **THEN** Build, Gallery, and Wallet are still reachable from the top nav, and the banner still
  links Gallery (and Wallet in paid mode)
