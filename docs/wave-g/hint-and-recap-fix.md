# Wave-G fix — requestTaskHint stage-scope + getRunRecap hidden-photo filter

SDD for the two findings in [hidden-content-surfaces.md](hidden-content-surfaces.md):
#1 (confirmed live leak) and #2 (latent trap). Spec-driven + test-first.

---

## #1 — `requestTaskHint` future-stage hint oracle (P0, confirmed live)

### What & why
`requestTaskHint` (`functions/src/runs/index.ts`, callable @ ~2923) resolved a hint
from `game.stages` by `taskId` ALONE and charged to reveal it, with **no**
`assertStageActiveForTask(team, taskId)` guard. Every sibling grading/interaction
callable — `submitTaskAnswer` (@3165), `submitSequenceStep`, `verifyStationCode`
(@3286), `reportArrival` (@3018) — carries that guard. The outlier let a participant
pay to reveal the hint TEXT of **any task in any stage**, including a hidden-location
task's sealed find-the-spot hint in a **future/locked stage they had not reached** —
a future-content / location oracle and a general scout-ahead cheat.

### Intended behavior (preserved)
Revealing the hint for the team's **current active-stage** task pre-arrival IS by
design (the sanitizer keeps `hasHint` while a hidden task is sealed — a treasure-hunt
hint is meant to help you find the spot). The guard blocks **other/future** stages,
not the active one. `assertStageActiveForTask` treats `'active'` AND `'completed'`
stages as allowed (matching the answer callables), so auto-skipped siblings and
idempotent duplicates on a just-completed stage still work.

### How (the fix)
After `resolveCallerTeam` (which already returns `team`), destructure `team` and call
`assertStageActiveForTask(team, taskId)` **before** the game load / hint lookup — same
error (`failed-precondition`, `STAGE_NOT_ACTIVE_MSG`), same placement relative to the
top-of-callable rate-limit and the in-transaction idempotency check as the siblings.
No new callable ⇒ the e2e callable-coverage guard stays satisfied (66/66).

### Test (TDD, RED first) — e2e wire-level
Extend `scripts/e2e-verify.mjs` with a scenario:
- A participant whose team is on **stage 1** calls `requestTaskHint` for a **stage-2**
  task → asserted **DENIED** at the wire with `failed-precondition`.
- The same participant calls `requestTaskHint` for a task in their **active stage 1**
  (which carries a hint) → **reveals** the hint text.
RED before the guard (stage-2 call would return the hint); GREEN after.

---

## #2 — `getRunRecap` recap photos lack a hidden-location filter (latent, proactive)

### Risk
`buildRunRecap` (`packages/shared/src/runRecap.ts` @57-67) collects `rec.photoUrl`
for **every** approved/correct task record, with **no** hidden-location filter.
`getRunRecap` is participant-reachable and gated only on `leaderboard.published`,
which an organizer can flip true mid-run (staged TV reveal). If recap ever carried a
hidden-spot photo, teams still hunting could read it via the access code.

### Why not live today
No server code writes `photoUrl`/`verificationOutcome` onto `stages[].tasks[]`
records — photos live on `team.taskSubmissions[taskId]` — so `recap.photos` is
currently always empty. Pure latent coupling. But it is cheap to close, and the
default is to close it so the two surfaces (feed + recap) cannot diverge the moment
recap is wired to real photos.

### Decision — filter at the call site, keep `buildRunRecap` pure
`buildRunRecap` lives in `packages/shared` and **cannot** import the server-side
`shouldFeedTask` (`functions/src/feedVisibility.ts`), nor does it have the game's
per-task `hideLocation` in scope. Two options were considered:

1. **Resolve `hideLocation` at the `getRunRecap` call site** (in `functions/`, where
   the game doc is already loaded) using the existing `shouldFeedTask` predicate, and
   pass the set of hidden task ids into `buildRunRecap`, which filters by id.
2. Pass the whole game into `buildRunRecap` and filter there — but that drags a heavy
   `Game` type + the `hideLocation` semantics into shared and duplicates the
   predicate.

**Chosen: option 1.** It keeps `buildRunRecap` pure and trivially unit-testable (it
takes a plain `ReadonlySet<string>` of ids, no Firestore, no `Game`), and it reuses
the **single source of truth** `shouldFeedTask` at the call site so recap mirrors the
live-feed exclusion exactly (both fail-closed on an unresolvable task). `buildRunRecap`
gains an optional `hiddenTaskIds?: ReadonlySet<string>` param — omitted ⇒ old behavior
(no filter), so no other caller changes.

### Test (TDD, RED first) — pure unit
Extend `scripts/test-run-recap.ts`: a team with an approved photo on a **hidden**
task id and an approved photo on a **normal** task id; `buildRunRecap(teams, run,
new Set(['hiddenTaskId']))` must include the normal photo and **exclude** the hidden
one; `photoCount` reflects the exclusion. RED before the filter (hidden photo leaks),
GREEN after.

### Call-site wiring
In `getRunRecap` (`functions/src/runs/index.ts` @~1836), after loading `game`, build
`hiddenTaskIds` = the set of `task.id` across `game.stages[].tasks[]` where
`!shouldFeedTask({ hideLocation: task.hideLocation })` (i.e. hidden), and pass it as
the third arg to `buildRunRecap`. When `game` is null (pruned/missing), pass an empty
set — recap is already photo-empty there.
