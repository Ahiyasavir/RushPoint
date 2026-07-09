## ADDED Requirements

### Requirement: The public tunnel survives a dropped connection

The single-origin tunnel used by `npm run playtest:ngrok` SHALL treat an unexpected exit of the
tunnel process as a transient drop and restart it (with bounded backoff) on the same fixed domain,
rather than exiting and tearing down the rest of the playtest stack. The tunnel wrapper SHALL exit
only on an intentional stop signal (SIGINT/SIGTERM), so Ctrl+C still stops the whole stack.

#### Scenario: A dropped tunnel reconnects instead of collapsing the stack

- **WHEN** the tunnel child process exits unexpectedly (e.g. a transient session drop) and no stop signal was received
- **THEN** the wrapper does not exit and schedules a restart of the tunnel on the same fixed domain
- **AND** the concurrently stack (emulator, proxy, apps) keeps running

#### Scenario: Intentional stop tears everything down

- **WHEN** the wrapper receives SIGINT or SIGTERM
- **THEN** it kills the tunnel child and exits without restarting

#### Scenario: Backoff grows on rapid repeated failures and resets after a healthy run

- **WHEN** `restartDelayMs(consecutiveQuickFailures, opts)` is called
- **THEN** it returns a capped exponential delay (`min(maxMs, baseMs * 2 ** consecutiveQuickFailures)`)
- **WHEN** `isQuickFailure(uptimeMs, thresholdMs)` is called with an uptime at or above the threshold
- **THEN** it returns false, so a healthy-then-dropped tunnel reconnects immediately rather than inheriting a grown delay
