# run-history Specification

## ADDED Requirements

### Requirement: listMyRuns returns the caller's runs, live and finished
A new `listMyRuns` callable SHALL return the runs owned by the caller — regardless of status —
optionally narrowed to one `gameId`, newest first, with a bounded result count. Each row SHALL carry
enough to render a card and route onward: run id, game id, game title, access code, status,
launched/finished instants, participant count, whether it was a test drive, and the top score when a
leaderboard exists. Runs belonging to a tombstoned game SHALL be omitted.

#### Scenario: Owner sees finished runs, not just live ones
- **WHEN** an owner with one live and two finished runs calls `listMyRuns`
- **THEN** all three rows are returned, newest first

#### Scenario: Filtering to one game
- **WHEN** `listMyRuns` is called with a `gameId`
- **THEN** only that game's runs are returned

#### Scenario: Another owner's runs are never returned
- **WHEN** a creator calls `listMyRuns`
- **THEN** no run owned by any other creator appears, whatever `gameId` was passed

#### Scenario: A trashed game's runs are hidden
- **WHEN** a game has been soft-deleted
- **THEN** its runs are absent from the result

### Requirement: A creator can reach a past run from where the runs are counted
The creator console SHALL make its runs total a link into a run-history surface, and SHALL offer the
same route from a game's own card and from the Builder for that game. A finished run's row SHALL lead
to its report; a live run's row SHALL lead to the live console, so the two are never confused.

#### Scenario: The runs tile opens the history
- **WHEN** the creator activates the total-runs statistic on the dashboard
- **THEN** the run-history surface opens

#### Scenario: One game's history is reachable from that game
- **WHEN** the creator opens run history from a game card or from the Builder
- **THEN** the surface is filtered to that game's runs

#### Scenario: Live and finished runs route differently
- **WHEN** the history lists a live run and a finished run
- **THEN** the live row opens the run console and the finished row opens the run report

#### Scenario: A creator with no runs yet is told what to do
- **WHEN** the surface has no runs to show
- **THEN** an empty state explains that runs appear here after a game is launched
