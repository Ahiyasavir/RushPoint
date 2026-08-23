## Why

The always-on playtest runner (`scripts/playtest-forever.mjs`) tears the **entire** stack down and
relaunches it far too often — dropping the public tunnel, the emulator, and both app servers for
~10–20s each time. Log evidence from the live runner over 9 days (2026-07-12 → 2026-07-21):

- **~1,020** full stack teardowns; **858** of them were `SIGTERM` (a deliberate kill, not a crash).
- The only thing that SIGTERMs the stack is the supervisor's **git auto-update poll**:
  ```
  poll: 1 new commit(s) upstream — restarting stack to apply.   ← child.kill()  (whole stack dies)
  git pull --ff-only failed: Your local changes to apps/creator-web/src/services/firebase.ts
                             would be overwritten by merge
  ```
- **997** `git pull --ff-only` failures. The poll kills the stack **first**, *then* tries to pull —
  but the runner's working tree is dirty, so the fast-forward fails, `HEAD` never advances, the
  branch stays "1 behind", and the **next** poll kills the stack again. An unbreakable collapse
  loop for as long as any tracked file blocks the fast-forward.

Two things feed the loop: (1) the poll collapses the stack for an update it can't verify it can
apply, and (2) the runner keeps **self-dirtying** its own tree — notably `package-lock.json`, which
the supervisor's post-pull `npm install` rewrites, which then blocks the *next* fast-forward.

(An earlier hypothesis — the ngrok session stalling — was investigated and rejected: ngrok stalls
never exit the process, so they account for **zero** of the 1,020 teardowns. Real but minor;
out of scope here.)

## What Changes

- **Guard the git-update poll**: before killing the stack, the supervisor SHALL verify a
  fast-forward will actually apply — the branch is strictly behind (behind > 0, not diverged) **and**
  no file changed in the incoming commits is locally modified. If a fast-forward is **not** safe,
  it logs (rate-limited) and **keeps serving the current build** instead of collapsing. This makes
  the thrash loop impossible regardless of tree state.
- **Stop the self-inflicted dirtying**: replace the supervisor's post-pull `npm install` with
  `npm ci`, which installs from the lockfile without rewriting it — so a dependency update never
  leaves `package-lock.json` dirty to block the next fast-forward.
- **Pure, unit-tested decision helper** (`scripts/lib/gitUpdateGuard.mjs`) so the "is a
  fast-forward safe to apply?" logic is covered by `npm test` without any git/network/spawn.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `playtest-links`: strengthen the always-on runner requirement — the supervisor's git auto-update
  SHALL NOT tear down the stack unless the pulled update can actually fast-forward, and SHALL avoid
  dirtying its own tree in a way that blocks future updates.

## Impact

- `scripts/playtest-forever.mjs` — the git poll and `updateFromGit()` gain the fast-forward-safety
  guard (compute ahead/behind + incoming-vs-dirty overlap; only `child.kill()` when safe); the
  post-pull dependency install switches `npm install` → `npm ci`. Crash-restart, `--stop`/`.stop`,
  SIGINT/SIGTERM, single-instance guard, and the prod build path are unchanged.
- `scripts/lib/gitUpdateGuard.mjs` (new) — pure `canFastForwardApply(...)`.
- `scripts/test-git-update-guard.ts` (new) — pure-logic assertions (auto-picked up by the
  `run-unit-tests.mjs` aggregator).
- Dev-tooling only: affects the always-on playtest runner's stability. No product code, callables,
  client, or Firestore rules.
- Follow-up noted, not in scope: `.claude/settings.local.json` is tracked but machine-local and
  churns; untracking it would further reduce tree dirtiness. Left out to avoid a repo-wide
  `git rm --cached` in this change — the poll guard already tolerates it.
