## ADDED Requirements

### Requirement: Snapshot protection is on by default

The system SHALL start the snapshot loop for **every** emulator session, not only for playtest
sessions. Disabling snapshot protection SHALL require an explicit opt-out.

The system SHALL NOT start a second snapshot loop when one is already running against the same
emulator. Liveness of an existing loop SHALL be determined from its published heartbeat — a recent
update from a process that is still alive — so that a session which starts its own loop separately
does not end up with two loops exporting against one emulator.

A heartbeat left behind by a dead or long-stopped loop SHALL NOT suppress starting a new loop.

#### Scenario: Ordinary dev session is protected

- **WHEN** the emulator is started with no backup-related configuration
- **THEN** the snapshot loop is started alongside it

#### Scenario: Explicit opt-out

- **WHEN** the emulator is started with snapshot protection explicitly disabled
- **THEN** no snapshot loop is started

#### Scenario: No duplicate loop

- **WHEN** the emulator is started while a live loop's heartbeat is recent and its process is alive
- **THEN** no additional loop is started

#### Scenario: A stale heartbeat does not block protection

- **WHEN** a heartbeat file exists but is old, or names a process that is no longer alive
- **THEN** a new snapshot loop is started

### Requirement: Published loop health

The snapshot loop SHALL continuously publish its own state to a status file in the backups
directory, updated on every tick regardless of whether an export ran, containing at minimum: the
loop's process id, when it started, when it last updated, the timestamp and name of the last
SUCCESSFUL snapshot, the number of consecutive export failures, the configured interval, and the
loop's current self-assessed health level.

The status file's name SHALL NOT be mistakable for a snapshot folder, so that snapshot enumeration
and retention are unaffected by its presence.

#### Scenario: Status file written on every tick

- **WHEN** the loop completes a tick, whether or not an export was attempted
- **THEN** the status file's last-updated timestamp advances

#### Scenario: Last success is recorded

- **WHEN** an export succeeds
- **THEN** the status file records that snapshot's name and timestamp as the last success and resets the consecutive-failure count to zero

#### Scenario: Failures are counted

- **WHEN** an export attempt fails
- **THEN** the status file's consecutive-failure count increases and the last-success fields are left untouched

#### Scenario: Status file is not a snapshot

- **WHEN** snapshots are enumerated for retention or restore selection
- **THEN** the status file is not treated as a snapshot and is never a prune or restore candidate

### Requirement: Self-assessed health levels

The system SHALL derive the loop's health from how far the snapshot interval has been overshot since
the last success and how many exports have failed consecutively, using a pure function of those
inputs. The levels SHALL be:

- `starting` — no successful snapshot yet and the overshoot is still within tolerance,
- `ok` — the last success is within a small multiple of the interval and no recent failures,
- `degraded` — the interval has been moderately overshot, or at least one export has failed,
- `stalled` — the interval has been badly overshot, or several exports have failed in a row.

The assessment SHALL be monotonic in both inputs: a longer time since the last success SHALL NEVER
produce a healthier level, and more consecutive failures SHALL NEVER produce a healthier level.

#### Scenario: Fresh success is ok

- **WHEN** the last successful snapshot is younger than the tolerated multiple of the interval and no failures have occurred
- **THEN** the health level is `ok`

#### Scenario: Moderate overshoot is degraded

- **WHEN** the time since the last success exceeds the ok tolerance but not the stall threshold
- **THEN** the health level is `degraded`

#### Scenario: Badly overshot is stalled

- **WHEN** the time since the last success exceeds the stall threshold
- **THEN** the health level is `stalled`

#### Scenario: Repeated failures are stalled

- **WHEN** several consecutive export attempts have failed
- **THEN** the health level is `stalled` even if the last success is recent

#### Scenario: No success yet

- **WHEN** the loop has never taken a successful snapshot and has just started
- **THEN** the health level is `starting`, and it degrades and then stalls as the overshoot grows

#### Scenario: Health never improves with worse inputs

- **WHEN** the elapsed time since last success increases, or the consecutive-failure count increases
- **THEN** the resulting health level is never better than before

### Requirement: Loud, unmissable failure signalling

A `degraded` or `stalled` loop SHALL announce itself with a repeated, visually distinct multi-line
banner on the error stream — not a single ordinary log line — naming how long it has been since the
last successful snapshot and what to do about it. The banner SHALL keep repeating while the
condition persists, so that it cannot scroll away unnoticed.

#### Scenario: Stalled loop shouts

- **WHEN** the loop assesses itself as `stalled`
- **THEN** a multi-line banner is written to the error stream naming the age of the last successful snapshot
- **AND** the banner keeps being re-emitted while the condition persists

#### Scenario: Healthy loop stays quiet

- **WHEN** the loop assesses itself as `ok`
- **THEN** no banner is emitted and only the ordinary per-snapshot log line appears

### Requirement: The failure banner is rate-limited without losing news

The system SHALL decide whether to emit the health banner using a pure function of the current
health level, the level and time of the last banner, the current time, and a configurable minimum
gap — so that re-assessing health on a fast wall-clock cadence does not turn the banner into a
firehose that buries the surrounding emulator output a person needs in order to diagnose the very
failure being announced.

Assessing health and publishing it to the status file SHALL continue to happen at the full
re-assessment cadence; only the banner SHALL be rate-limited.

The banner SHALL be emitted immediately, regardless of the gap, when it has never been emitted
before and when the health level has CHANGED since the last banner — an escalation SHALL NEVER be
suppressed by the gap. Otherwise it SHALL be suppressed until the minimum gap has elapsed since the
last banner.

The minimum gap SHALL default to a value no smaller than one snapshot interval and no smaller than
one minute, and SHALL be overridable by configuration, documented alongside the loop's other
settings.

A clock that moves BACKWARDS SHALL NOT suppress the banner: a negative elapsed time SHALL be treated
as "emit now" rather than as "recently emitted". A missing, null or non-numeric last-banner time
SHALL be treated as "never emitted".

#### Scenario: Healthy loop never shouts

- **WHEN** the health level is `ok` or `starting`
- **THEN** no banner is emitted, whatever the elapsed time or last-banner state

#### Scenario: First unhealthy assessment is immediate

- **WHEN** the loop becomes `degraded` or `stalled` and no banner has been emitted yet
- **THEN** the banner is emitted immediately

#### Scenario: Repetition at the same level is throttled

- **WHEN** health is re-assessed at the same unhealthy level, less than the minimum gap after the last banner
- **THEN** no banner is emitted, while the health assessment and the status-file write still occur

#### Scenario: Repetition resumes after the gap

- **WHEN** the minimum gap has elapsed and the unhealthy condition still holds
- **THEN** the banner is emitted again

#### Scenario: An escalation is never swallowed

- **WHEN** the level changes (for example `degraded` to `stalled`) shortly after a banner
- **THEN** the banner is emitted immediately rather than waiting out the gap

#### Scenario: A backwards clock does not mute the banner

- **WHEN** the current time is earlier than the recorded time of the last banner
- **THEN** the banner is emitted rather than suppressed, and the last-banner time is re-stamped so ordinary throttling resumes

### Requirement: Queryable health with a failing exit code

The system SHALL provide a status command that reads the status file and reports the loop's health
in human-readable form, exiting **non-zero** when the health is `stalled` or when no status file
exists at all, so that a person or a supervising script can ask "is the safety net alive?" and get an
answer that a check can fail on.

#### Scenario: Status command reports a healthy loop

- **WHEN** the status command runs and the status file reports `ok`
- **THEN** it prints the last-success age and exits zero

#### Scenario: Status command fails on a stalled loop

- **WHEN** the status command runs and the loop is `stalled`
- **THEN** it prints the stall detail and exits non-zero

#### Scenario: Status command fails when no loop has ever run

- **WHEN** the status command runs and no status file exists
- **THEN** it reports that no snapshot loop state was found and exits non-zero

### Requirement: A hung export cannot silence the loop

The system SHALL bound each export attempt with a timeout and SHALL refuse to start a new export
while a previous one is still in flight. An export that exceeds its timeout SHALL be terminated and
counted as a failure, so that a wedged export degrades the loop's published health instead of
silently stopping it.

#### Scenario: Overlapping ticks are refused

- **WHEN** a tick fires while a previous export is still running
- **THEN** the re-entrancy gate reports that no new export may start, and no second export is spawned

#### Scenario: A hung export times out and is counted as a failure

- **WHEN** an export exceeds the configured timeout
- **THEN** it is terminated, recorded as a failure, and the loop continues ticking

#### Scenario: A wedged export becomes visible

- **WHEN** exports keep timing out
- **THEN** the consecutive-failure count grows, the health degrades to `stalled`, and the banner is emitted

### Requirement: A hung readiness probe cannot silence the loop

The system SHALL bound the emulator-readiness probe with a hard timeout, independent of the probe's
own implementation. A probe that never resolves, rejects, or throws SHALL be treated as an ordinary
"not ready" result rather than left pending, so that everything which normally runs after the
readiness check — the health assessment and the heartbeat write — always runs on every tick,
regardless of what the probe does.

#### Scenario: A hung probe does not block the tick

- **WHEN** the readiness probe never resolves
- **THEN** the tick treats it as not ready once the bound elapses, and still proceeds to assess health and write the heartbeat

#### Scenario: A rejecting or throwing probe does not block the tick

- **WHEN** the readiness probe rejects or throws synchronously
- **THEN** the tick treats it as not ready and still proceeds to assess health and write the heartbeat

#### Scenario: A healthy probe is unaffected

- **WHEN** the readiness probe resolves promptly with `true` or `false`
- **THEN** the tick uses that result directly, without waiting for the bound to elapse

#### Scenario: The bound never throws at its caller

- **WHEN** the bound's timer is supplied by a scheduler that fires its callback synchronously
- **THEN** the caller still receives a plain "not ready" answer, and no error escapes the bound

### Requirement: Heartbeat and health assessment are independent of a single tick

The system SHALL re-assert the heartbeat timestamp and the self-assessed health level on a wall-clock
cadence that does not depend on any single tick completing — so that a tick wedged on a slow export or
a slow probe can never, by itself, freeze the published heartbeat or suppress the stalled banner. The
health assessment SHALL remain a pure function of elapsed time and failure count, so it can be
re-evaluated at any moment without coordinating with the tick that is currently in flight.

#### Scenario: Heartbeat advances even while a tick is in flight

- **WHEN** a tick's export is still running (has not yet resolved)
- **THEN** the published heartbeat timestamp still advances before that tick completes

#### Scenario: An external checker can still detect a dead loop

- **WHEN** the loop process has stopped writing entirely (not merely a single tick running long)
- **THEN** the heartbeat goes stale and `--status` (or an equivalent external check) reports the loop as stalled and exits non-zero
