## Context

`scripts/playtest-forever.mjs` keeps the playtest stack up forever and auto-updates from git. Two
code paths pull:

1. **Background poll** (`gitTimer`, every `GIT_POLL_MS` = 3 min): `git fetch`; if
   `git rev-list --count HEAD..@{u}` > 0, it logs and immediately `child.kill()` — SIGTERM'ing the
   whole `concurrently` stack — expecting the main loop to then pull and relaunch.
2. **Main-loop `updateFromGit()`** (runs on each relaunch): `git fetch`; if behind, `git pull
   --ff-only`; on success, if manifests changed, `npm install`, then rebuild+relaunch.

The failure: the poll kills the stack *before* confirming the pull can apply. When the runner tree
is dirty on a file the incoming commits also touch (observed:
`apps/creator-web/src/services/firebase.ts`; and `package-lock.json` after the loop's own
`npm install`), `pull --ff-only` fails, `HEAD` never advances, and every subsequent poll re-kills
the stack. 858 SIGTERM teardowns / 997 failed pulls over 9 days.

## Goals / Non-Goals

**Goals:**
- Never tear down the stack for an update that cannot fast-forward — degrade to "keep serving the
  current build" instead of thrash-collapsing.
- Eliminate the supervisor's self-inflicted dirtying of `package-lock.json`.
- Keep the fast-forward-safety decision pure and unit-tested (no git, no spawn, no clock in the
  helper).
- Preserve all other behavior: crash-restart, prod rebuild, `--stop`/`.stop`/SIGINT teardown,
  single-instance guard, fixed ngrok domain.

**Non-Goals:**
- Not removing git auto-update (a well-kept runner should still auto-apply pushes).
- Not touching the ngrok tunnel wrapper / cloudflared path (separate concern; ngrok stalls cause
  no teardowns).
- Not untracking `.claude/settings.local.json` here (repo-wide change; the guard tolerates a dirty
  tree, so it's a follow-up, not a prerequisite).

## Decisions

**1. A pure fast-forward-safety predicate drives every kill/pull decision.**
`scripts/lib/gitUpdateGuard.mjs`:
```
canFastForwardApply({ ahead, behind, changedUpstreamFiles, dirtyFiles }) -> { ok, reason }
```
- `ok` is true iff `behind > 0` **and** `ahead === 0` (strictly behind, not diverged) **and** no
  path in `changedUpstreamFiles` appears in `dirtyFiles` (nothing the pull would overwrite is
  locally modified).
- `reason` is a short string for logging: `'ff'` (ok), `'up-to-date'`, `'diverged'`,
  `'dirty-conflict:<file>'`. Pure — takes already-computed numbers/arrays, no I/O.

**2. The `.mjs` computes the inputs and consults the predicate before any `child.kill()`.**
A shared helper in the supervisor (`assessUpdate()`):
- `git fetch --quiet origin`
- `ahead`/`behind` from `git rev-list --left-right --count HEAD...@{u}`
- `changedUpstreamFiles` from `git diff --name-only HEAD..@{u}`
- `dirtyFiles` from `git status --porcelain` (tracked modifications; ignore untracked `??` that
  can't block an ff)
- returns `canFastForwardApply(...)`.
The **poll** calls `assessUpdate()` and only `child.kill()`s when `ok`; otherwise it logs the
reason (rate-limited — see 4) and leaves the stack running. `updateFromGit()` likewise only
attempts `git pull --ff-only` when `ok`, so a blocked update is reported once, not retried into a
failure every relaunch.

**3. `npm ci` instead of `npm install` on the post-pull dependency step.**
`npm ci` installs strictly from `package-lock.json` and never rewrites it, so a dependency update
can't leave the lockfile dirty to block the next fast-forward. It also matches "reproducible
runner" intent. (If `npm ci` fails because the lockfile is out of sync, log it and keep serving —
same availability-first stance as a failed build.)

**4. Rate-limit the "can't fast-forward" log.**
Because the poll runs every 3 min, a persistently-blocked update would otherwise log every cycle.
Track the last-logged `(reason, upstreamSha)` and only re-log when it changes, so the log states
the blockage once and stays quiet until the situation changes.

## Risks / Trade-offs

- **A genuinely dirty runner never auto-updates** — by design: availability over freshness. The
  rate-limited log tells the operator exactly which file to commit/stash to unblock it. Strictly
  better than collapsing every 3 minutes.
- **`git diff --name-only HEAD..@{u}` vs the real merge**: comparing incoming changed-files against
  locally-dirty files is a conservative superset of what `pull --ff-only` would reject — it can
  occasionally decline an update that *might* have applied, but it will **never** greenlight a kill
  that then fails the pull. Erring toward "don't collapse" is the correct bias.
- **`npm ci` is stricter than `npm install`** — it fails hard if the lockfile and manifest
  disagree. Handled the same as a failed build (log + keep serving the current build), so it can't
  black out the site.
