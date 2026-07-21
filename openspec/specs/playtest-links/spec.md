# playtest-links Specification

## Purpose
TBD - created by archiving change playtest-shareable-links. Update Purpose after archive.
## Requirements
### Requirement: One command runs the full stack and prints a creator link and a join link
`npm run playtest` SHALL boot the full v2 stack (emulator + seed + creator-web + play-web) behind a
single public origin and MUST print two real, openable links: the creator console and a join-a-game
page. The join link MUST carry the seeded run's `?code=<accessCode>` so testers land on the join screen.

#### Scenario: Playtest prints two openable links
- **WHEN** the developer runs `npm run playtest` and the tunnel comes up
- **THEN** a creator-console URL and a join URL (with `?code=<accessCode>`) are printed

#### Scenario: A remote phone can open the join link
- **WHEN** a tester on a different network opens the printed join link
- **THEN** they reach the join screen for the seeded live run and can play

#### Scenario: Link building is correct
- **WHEN** `buildPlaytestLinks(baseUrl, accessCode)` is called
- **THEN** it returns `creatorUrl = baseUrl + '/creator'` and `joinUrl = baseUrl + '/?code=' + accessCode`
- **AND** with no access code the join URL is just the base play URL

### Requirement: The emulator host is configurable for remote clients
The clients SHALL resolve the Firebase emulator host from configuration (`resolveEmulatorHost`)
instead of a hardcoded address, defaulting to `127.0.0.1` for normal local dev and using the page
origin in playtest so remote devices reach the backend through the tunnel.

#### Scenario: Default local host is preserved
- **WHEN** `resolveEmulatorHost` is called with no override
- **THEN** it returns `127.0.0.1` (normal `dev:all` behavior unchanged)

#### Scenario: Playtest uses the tunnel origin
- **WHEN** `resolveEmulatorHost` is called in playtest mode with a page origin
- **THEN** it returns the origin's hostname so remote clients connect through the tunnel

### Requirement: The reverse proxy routes the v2 apps and emulator under one origin
`scripts/proxy.mjs` SHALL route requests under a single origin to the v2 `creator-web` and `play-web`
dev servers and to the emulator services, replacing the stale v1 mobile/admin routing.

#### Scenario: Proxy routing targets
- **WHEN** `resolveProxyTarget` is given a Firestore/Auth/Functions/Storage path
- **THEN** it returns the corresponding emulator port
- **WHEN** it is given a `/creator` prefixed path
- **THEN** it targets the creator-web dev server (5180)
- **WHEN** it is given any other path
- **THEN** it targets the play-web dev server (5181)

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

### Requirement: The always-on runner only restarts for an update it can apply

The always-on playtest supervisor (`scripts/playtest-forever.mjs`) auto-updates from git. It SHALL
tear down and relaunch the stack for a new upstream commit **only when that update can actually be
fast-forwarded** — the local branch is strictly behind (not diverged) and no file changed by the
incoming commits is locally modified. When a fast-forward is not safe, the supervisor SHALL keep
serving the current build and SHALL NOT tear down the stack. The supervisor SHALL also avoid
dirtying its own working tree in a way that would block future fast-forwards.

#### Scenario: A clean, applicable update restarts the stack

- **WHEN** the poll finds the branch strictly behind upstream and no incoming file is locally modified
- **THEN** the supervisor tears down and relaunches the stack, which fast-forwards and rebuilds on the new commit

#### Scenario: An update that cannot fast-forward does NOT collapse the stack

- **WHEN** the poll finds the branch behind upstream but a file changed by the incoming commits is locally modified (dirty), or the branch has diverged (local commits ahead)
- **THEN** the supervisor keeps the running stack up and does not kill it
- **AND** it logs the blockage once (rate-limited, not every poll) naming the reason so the operator can commit/stash to unblock

#### Scenario: The runner does not dirty its own lockfile

- **WHEN** a pulled update changes dependency manifests and the supervisor installs dependencies
- **THEN** it installs from the lockfile without rewriting it (`npm ci`), so the tree stays clean and the next fast-forward is not blocked by a self-modified `package-lock.json`

#### Scenario: The fast-forward-safety decision is pure and conservative

- **WHEN** `canFastForwardApply({ ahead, behind, changedUpstreamFiles, dirtyFiles })` is called
- **THEN** it returns `ok: true` only if `behind > 0`, `ahead === 0`, and no `changedUpstreamFiles` path is in `dirtyFiles`; otherwise `ok: false` with a reason (`up-to-date` / `diverged` / `dirty-conflict:<file>`)
- **AND** it performs no git, network, or clock access (pure — inputs computed by the caller)

