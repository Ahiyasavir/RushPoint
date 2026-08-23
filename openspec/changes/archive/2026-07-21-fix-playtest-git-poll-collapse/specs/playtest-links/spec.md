## ADDED Requirements

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
