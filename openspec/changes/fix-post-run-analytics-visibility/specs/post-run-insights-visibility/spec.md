# post-run-insights-visibility Specification (delta)

## ADDED Requirements

### Requirement: Post-run analytics loads automatically
The finished-run analytics panel SHALL fetch its data on mount, so a creator viewing a finished run
sees the per-task analytics (or an explicit empty state) without a manual load action.

#### Scenario: Analytics appears on a finished run
- **WHEN** the creator opens the console of a finished run
- **THEN** the analytics panel fetches and displays the per-task table (or "No data yet." when there
  is nothing to show) without requiring a button click

### Requirement: Post-run panels surface load failures
Each post-run insight panel (analytics, heatmap, feedback) SHALL show a visible, retryable error when
its data load fails, and MUST NOT leave a permanently blank panel with no explanation.

#### Scenario: A failed analytics load shows an error
- **WHEN** the analytics data load fails (e.g. the network is down)
- **THEN** the panel shows an error message with a retry action, not an empty card

#### Scenario: A failed feedback load shows an error
- **WHEN** the feedback summary load fails
- **THEN** the panel shows an error message instead of silently rendering nothing
