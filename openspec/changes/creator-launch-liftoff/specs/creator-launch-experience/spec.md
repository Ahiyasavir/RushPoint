## ADDED Requirements

### Requirement: The launch-run wait shows an advancing "liftoff" indicator

While a run launch is in flight, the creator console SHALL display an engaging, visibly advancing
multi-step "liftoff" indicator instead of an unchanged screen or a bare spinner, so the creator
perceives forward motion toward a live run rather than a frozen wait.

The indicator SHALL rotate through a short sequence of pre-translated status lines (preparing the
run, creating the join code, opening the gates) over a bar that reads as forward motion, in the
creator's dark theme. It SHALL be shown at BOTH launch entry points — the Builder header launch
(and test run) and the Dashboard launch — driven by the SAME copy so the two cannot drift. The
launch button(s) SHALL also reflect the in-flight state (disabled + busy) while the indicator is up.

#### Scenario: Launch is in flight

- **WHEN** the creator triggers a run launch and the save/`launchRun` round-trip has not yet resolved
- **THEN** the liftoff overlay is shown with a rotating status line and an advancing bar, and the
  launch button is disabled and marked busy

#### Scenario: Both launch sites behave identically

- **WHEN** the launch is triggered from the Builder header versus the Dashboard
- **THEN** both show the same liftoff indicator with the same rotating step copy

#### Scenario: Launch resolves or fails

- **WHEN** the launch succeeds (navigates to the run) or fails (error/billing dialog)
- **THEN** the liftoff overlay is cleared — it never remains on screen after the launch settles

### Requirement: The indicator is honest about being indeterminate

The liftoff indicator SHALL NOT imply measured or precise progress. Because `launchRun` is a single
opaque round-trip, the rotating steps are reassurance only, not telemetry: the bar SHALL be an
indeterminate sweep (or a static fill under reduced motion) and SHALL NOT display a numeric
percentage, and the copy SHALL NOT claim that any individual step has completed.

#### Scenario: No fake precision

- **WHEN** the liftoff indicator is visible
- **THEN** it shows rotating reassurance lines and a motion bar, and never a precise percentage or a
  "step complete" claim tied to real backend state

### Requirement: Reduced motion degrades gracefully

Under the user's reduced-motion preference the indicator SHALL degrade to a static presentation: a
single static status label and a static bar fill, with no rotating text and no sweeping animation,
mirroring the participant-side `Working` behaviour. The status line SHALL be exposed to assistive
technology via a live region.

#### Scenario: Reduced-motion user launches a run

- **WHEN** the creator has `prefers-reduced-motion: reduce` set and triggers a launch
- **THEN** the indicator shows a single static line plus a static bar fill (no rotation, no sweep),
  while still announcing the status via an `aria-live` region

### Requirement: The rotation is a pure, total function

The step-selection logic SHALL be a pure helper (`liftoffStepIndex(tick, count)`) that is total and
never throws for any input, returning index `0` for a single or empty step set and otherwise wrapping
the tick into `[0, count)`. This helper SHALL be unit-tested in the pure lane, since the creator app
has no component test runner.

#### Scenario: Wrapping and degenerate inputs

- **WHEN** `liftoffStepIndex` is called with any integer, negative, or non-finite `tick`, and any
  `count` including `0` and `1`
- **THEN** it returns a defined index in `[0, count)` (or `0` when `count <= 1`) without throwing

### Requirement: No backend, dependency, or bundle regression

The change SHALL be confined to creator-web presentation while the existing launch promise is in
flight. It SHALL NOT modify the `launchRun` callable or its client wrapper, SHALL NOT add a runtime
dependency, and SHALL NOT import the participant-side `Working` component. New user-facing strings
SHALL route through the i18n dictionary in both Hebrew and English in parity.

#### Scenario: Surface stays contained

- **WHEN** the change is implemented
- **THEN** `launchRun` (server and `services/calls.ts` wrapper) is unchanged, no new dependency is
  added, and every new launch string exists in both the HE and EN dictionaries
