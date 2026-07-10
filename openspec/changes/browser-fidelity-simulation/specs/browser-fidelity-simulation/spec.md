## ADDED Requirements

### Requirement: Browser-level multi-team run simulation
The system SHALL provide a script `scripts/simulate-browser-run.mjs`, runnable as `npm run simulate:browser` (accepting `--teams=N`, default a small fleet), that drives N virtual teams through the **real play-web UI** in headless Chromium via Playwright — one isolated `BrowserContext` per team with its own anonymous auth, device emulation, and simulated GPS — playing a full run from join to finish. It SHALL NOT drive game/run mutations by calling callables directly from the driver; every participant action MUST go through the rendered UI (taps, form fills, task controls).

#### Scenario: N teams complete a full run through the UI
- **WHEN** the script runs against a booted emulator with `--teams=N`
- **THEN** it launches N independent browser contexts, each joins the run via the Join screen, plays every assigned task through the on-screen controls, and each team's UI reaches the `finished`/Final state
- **AND** the script exits non-zero if any team fails to reach `finished` within its turn budget

#### Scenario: participant actions go through the UI, not raw callables
- **WHEN** a virtual team completes a task
- **THEN** the completion is triggered by interacting with the rendered control (button/form/map) for that task type, exercising the same code path a real phone would

### Requirement: Realistic streamed GPS with jitter and drift
The simulation SHALL inject each team's position as a **live geolocation stream** (not a single teleport), interpolating movement between task stops along the game route and applying per-fix jitter/drift, so that `watchPosition` consumers in the UI observe motion. Positions MUST be delivered via the browser geolocation override (Playwright `context.setGeolocation` with `geolocation` permission granted), updated on a ticking timer.

#### Scenario: geofence auto-check-in against a moving fix
- **WHEN** a team walks into a geofenced task's radius over successive GPS ticks
- **THEN** the UI's geofence auto-check-in fires from the streamed position and the task completes without a manual submit
- **AND** while the team is outside the radius, the geofence task does NOT complete

#### Scenario: GPS jitter does not break check-ins
- **WHEN** positions arrive with realistic accuracy jitter around a task's coordinates
- **THEN** field/geofence check-ins that are genuinely in-range still succeed, and the run's integrity audit still passes

### Requirement: Injected network conditions exercise offline hardening
The simulation SHALL toggle degraded/offline network conditions (via CDP) for at least one team at scripted points during play, then restore connectivity, and assert the team recovers. The offline UI affordances (offline banner presence, no white-screen crash) SHALL be observed while offline.

#### Scenario: a team survives an offline blip
- **WHEN** a team is taken offline mid-run and later brought back online
- **THEN** the offline banner is shown while offline, no uncaught page error or white-screen crash occurs, and the team still converges to `finished` after reconnecting

### Requirement: Mobile device emulation
Each virtual team's context SHALL emulate a mobile device (phone viewport, touch, mobile userAgent) so the run is exercised at real handset dimensions, including the RTL Hebrew-first layout and the lazily-loaded map chunk.

#### Scenario: play at phone dimensions
- **WHEN** a team plays the run
- **THEN** its context uses a mobile device profile (touch-enabled, phone-sized viewport) and the critical task controls remain reachable and operable at that size

### Requirement: All task types covered end-to-end
The seeded game template SHALL include at least one task of every supported type — `field`, `geofence`, `self_report`, `smart_station`, `photo`, `quiz`, `numeric`, `sequence` — and the per-team driver SHALL know how to satisfy each type's control from the DOM.

#### Scenario: every task type is played through its own control
- **WHEN** the simulation runs
- **THEN** each task type is completed by driving its specific UI control (e.g., choose a quiz answer, type a numeric answer, enter a station code, order sequence steps, upload/confirm a photo, self-report, check in for field/geofence)
- **AND** the script fails loudly if any seeded task type is never exercised

### Requirement: Run-integrity audit at end of simulation
After all teams finish, the simulation SHALL run the same integrity audit as `npm run simulate` plus browser-only assertions, and exit non-zero on any violation. The audit MUST include: a leaderboard oracle (exactly one entry per team, contiguous ranks from 1, finite non-increasing scores), live/final ordering parity, per-team score conservation, every `run.taskCounts` station counter returned to 0 (no leaked slots) and none negative, zero uncaught page errors across all contexts, and zero white-screen crashes.

#### Scenario: leaderboard and station invariants hold
- **WHEN** the run completes and the audit runs
- **THEN** the live and final leaderboards each have one entry per team with contiguous ranks and non-increasing finite scores, live/final ordering matches, and every station counter is back to 0 with none negative

#### Scenario: no browser-level failures went unnoticed
- **WHEN** the audit runs
- **THEN** it fails if any team's context recorded an uncaught page error or a white-screen crash at any point during the run

### Requirement: Stable DOM selectors for the driver
The play-web task controls the driver must target SHALL expose stable `data-testid` attributes (task card, per-task-type submit/answer control, join CTA, offline banner). These attributes are render-only hooks and MUST NOT change user-visible behavior or introduce hardcoded user-facing strings; the i18n correctness gate SHALL remain clean.

#### Scenario: selectors are resilient to copy changes
- **WHEN** UI copy or translations change
- **THEN** the driver still locates controls via `data-testid` rather than visible text, and `npm run i18n:check` remains clean

### Requirement: Opt-in, not part of the blocking gate
The simulation SHALL be opt-in — invokable standalone (`npm run simulate:browser`) and via a convenience script that self-boots the emulator (e.g. `verify:browser`), but SHALL NOT be added to the blocking `npm run verify` gauntlet, since it requires a Chromium install and a running emulator.

#### Scenario: verify gauntlet stays browser-free
- **WHEN** a developer runs `npm run verify`
- **THEN** the browser simulation does not run as part of it, and the existing gates are unaffected
