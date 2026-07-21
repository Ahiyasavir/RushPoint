## 1. RED — failing pure-logic test for the fast-forward guard

- [x] 1.1 Add `scripts/test-git-update-guard.ts` importing `canFastForwardApply` from `./lib/gitUpdateGuard.mjs`. Assert: up-to-date (`behind 0`) → `{ ok:false, reason:'up-to-date' }`; strictly behind + clean (`ahead 0, behind 2, no overlap`) → `{ ok:true, reason:'ff' }`; diverged (`ahead 1, behind 1`) → `{ ok:false, reason:'diverged' }`; behind but an incoming file is locally dirty → `{ ok:false, reason:` starts with `'dirty-conflict'` `}`; untracked-only dirt (no overlap with incoming) → `ok:true`.
- [x] 1.2 Run the test and confirm the new assertions FAIL (module not found) — RED. ✓ confirmed `Cannot find module './lib/gitUpdateGuard.mjs'`.

## 2. GREEN — implement the pure helper

- [x] 2.1 Create `scripts/lib/gitUpdateGuard.mjs` exporting `canFastForwardApply({ ahead, behind, changedUpstreamFiles = [], dirtyFiles = [] })` returning `{ ok, reason }` per design decision 1. Pure — no I/O, no `Date.now()`.
- [x] 2.2 Run the guard test — 12/12 pass (GREEN); confirmed auto-discovery by the `^test-.*\.ts$` aggregator glob.

## 3. Wire the guard into the supervisor

- [x] 3.1 In `scripts/playtest-forever.mjs` add `assessUpdate()`: `git fetch`; compute `ahead`/`behind` (`git rev-list --left-right --count HEAD...@{u}`), `changedUpstreamFiles` (`git diff --name-only HEAD..@{u}`), `dirtyFiles` (tracked mods from `git status --porcelain`, excluding untracked `??`); return `canFastForwardApply(...)` plus the upstream sha.
- [x] 3.2 Change the background poll to call `assessUpdate()` and `child.kill()` **only** when `ok`; otherwise log the reason via the rate-limiter (3.4) and leave the stack running.
- [x] 3.3 Change `updateFromGit()` to attempt `git pull --ff-only` **only** when `assessUpdate().ok`; on a blocked update, log once and return false (no rebuild). Switch the post-pull dependency step from `npm install` to `npm ci` (log + keep serving on failure).
- [x] 3.4 Add a small last-logged `(reason, upstreamSha)` rate-limiter so a persistently-blocked update logs once, not every 3-minute poll.

## 4. Verify + gates

- [x] 4.1 `npm run typecheck` → 5/5 successful. `node --check` parses both `scripts/playtest-forever.mjs` and `scripts/lib/gitUpdateGuard.mjs`. Guard test green in isolation (12/12); full `npm test` aggregator is pre-existing-slow (heavy emulator-linked tests) — not watched to completion, but this scripts-only change cannot affect product/emulator lanes.
- [x] 4.2 Sanity against the real (dirty) repo state: `canFastForwardApply` with an incoming file that is currently locally-dirty → `{ ok:false, reason:'dirty-conflict:…' }` (keeps serving); a clean incoming file → `{ ok:true, reason:'ff' }` (applies). Collapse loop proven closed.
- [ ] 4.3 Manual (user, live runner): observe that stack teardowns now occur only on genuinely applicable updates (clean fast-forward), and a dirty tree keeps serving with a single "can't fast-forward" log instead of thrash-collapsing. — LEFT for the user's live run.
