## ADDED Requirements

### Requirement: A permanent tunnel failure is diagnosed, not retried in silence

The playtest tunnel supervisor SHALL classify a tunnel child's captured output into a failure kind
(`domain-contention`, `auth`, `network`, `unknown`) rather than treating every exit as an ordinary
drop. Kinds that retrying can never resolve — `domain-contention` and `auth` — SHALL be treated as
**permanent**, and a permanent failure SHALL be re-announced on **every** retry for as long as it
persists, never announced once and allowed to scroll away. The supervisor SHALL NOT exit or
otherwise collapse the playtest stack on any failure kind, permanent or not.

A `domain-contention` announcement SHALL state all three of: the cause (another ngrok agent holds
this reserved domain), the consequence (**the public URL is serving a different computer's data, not
this machine's**), and the corrective action (stop the tunnel on the other machine; this one
reclaims the domain on its next retry).

Classification SHALL be a pure function of the captured text, SHALL never throw on empty or
non-string input, and SHALL rank a permanent cause above transient noise that co-occurs in the same
output.

#### Scenario: A second machine holds the reserved domain

- **WHEN** the tunnel child exits with output containing `ERR_NGROK_334` / "is already online"
- **THEN** the failure is classified `domain-contention`, flagged permanent, and a block naming the
  domain, the wrong-machine consequence, and the fix is printed — and printed again on every
  subsequent retry while the conflict lasts

#### Scenario: An ordinary transient drop

- **WHEN** the tunnel child exits with connectivity noise (`ECONNREFUSED`, `dial tcp`) or output
  matching no known signal
- **THEN** the failure is classified `network` / `unknown`, is not flagged permanent, and the terse
  single reconnect line is used

#### Scenario: Classification never throws

- **WHEN** the captured output is empty, `null`, or `undefined`
- **THEN** the kind is `unknown` and no error is raised

### Requirement: A playtest stack identifies which machine and dataset it is

The emulator launcher SHALL print a machine-identity line at boot naming the hostname and the
dataset actually imported, and the tunnel supervisor SHALL embed that identity in every permanent
failure announcement, so "is the shared URL serving this computer?" is answerable from the terminal
without external forensics. The identity builder SHALL be pure — hostname and resolved import are
injected — and SHALL tolerate a missing or unparseable import timestamp without throwing.

#### Scenario: Boot with an imported dataset

- **WHEN** the emulator starts and resolves an import source
- **THEN** a line naming the hostname and that dataset (with its timestamp) is printed

#### Scenario: Boot with no dataset

- **WHEN** no snapshot or backup exists and the emulator starts fresh
- **THEN** the identity line is still printed, without error, indicating no import

### Requirement: Import-source selection compares a single clock

Selection between the primary export and the newest periodic backup SHALL compare timestamps drawn
from the **same** clock. When both export-metadata mtimes are readable, both sides SHALL be compared
by metadata mtime. A backup's folder-name timestamp SHALL be used only as a fallback for the backup
side when its metadata mtime cannot be read, and SHALL NOT be compared against an available mtime on
the other side. Absent sources SHALL yield non-finite timestamps so existing single-source and
no-source handling continues to apply.

#### Scenario: A crash backup finishes writing after the last planned export

- **WHEN** the primary export's metadata mtime is 12:00, and a backup whose folder name says 11:58
  has a metadata mtime of 12:05
- **THEN** the backup is selected as the freshest import source

#### Scenario: A backup's metadata mtime is unreadable

- **WHEN** the backup metadata mtime is unavailable
- **THEN** the backup's folder-name timestamp is used as the fallback for that side

### Requirement: Snapshot retention spans days, and never prunes everything

Periodic snapshot retention SHALL keep a dense recent window plus sparser hourly and daily keepers,
so recovery remains possible for a loss noticed hours or days later rather than only minutes. The
newest snapshot SHALL always be retained, unconditionally. A snapshot folder whose name cannot be
parsed SHALL never be pruned. Retention SHALL remain bounded, and the policy SHALL be a pure
function of the name list and an injected current time. An explicitly configured flat keep-count
SHALL retain its original meaning.

#### Scenario: Ten days of two-minute snapshots

- **WHEN** the policy is applied to a set spanning ten days at two-minute spacing
- **THEN** every snapshot inside the recent window is retained, at most one is retained per distinct
  UTC hour outside it, the newest overall is retained, and the retained total stays bounded

#### Scenario: An unrecognised folder is present

- **WHEN** the snapshot directory contains a name that does not parse as a snapshot
- **THEN** that name is never selected for pruning

#### Scenario: Only one snapshot exists

- **WHEN** the policy is applied to a single snapshot
- **THEN** nothing is pruned

### Requirement: Ordinary development sessions are snapshot-protected

`npm run dev:all` SHALL run the crash-safe snapshot loop alongside the emulator, so a development
session is protected by default rather than by opt-in. A failure of the snapshot loop SHALL NOT tear
down the development stack.

#### Scenario: Starting a normal dev session

- **WHEN** `npm run dev:all` is started
- **THEN** the snapshot loop runs and writes periodic snapshots, and the session's other processes
  continue running if the loop fails
