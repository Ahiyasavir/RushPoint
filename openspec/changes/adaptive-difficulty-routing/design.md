# Design — adaptive-difficulty-routing

## Part 1 — Adaptive difficulty routing (functions/src/routing/assignNextTask.ts)

### Current behavior (to change)
```ts
function skillMatch(skillRatio, difficulty) {
  const normalizedDifficulty = (difficulty - 5) / 5;   // 1→-0.8 … 5→0 … 10→+1
  return 1 - Math.abs(skillRatio - normalizedDifficulty);
}
// applied ONLY when skillAware (smart_weighted):
//   0.5·load − 0.3·transit + 0.2·skillMatch + zoneBonus
// else (fixed_points / time):
//   0.6·load − 0.4·transit + zoneBonus
```
`skillRatio ∈ [-1,1]`: **negative = faster than estimate (strong)**, positive =
slower (weak). Today `skillMatch` rewards the task whose `normalizedDifficulty`
≈ `skillRatio`, so a strong team (ratio ≈ −0.8) is pulled to difficulty ≈ 1
(easiest) — the wrong direction — and only under `smart_weighted`.

### New behavior
The team's **strength target** is `−skillRatio`: strong (ratio<0) ⇒ positive
target ⇒ wants high `normalizedDifficulty`; weak (ratio>0) ⇒ negative target ⇒
wants low difficulty; neutral (ratio==0) ⇒ target 0 ⇒ indifferent to difficulty.
That is exactly the existing formula with the sign of `skillRatio` flipped:

```ts
// Adaptive difficulty: route a team toward tasks whose difficulty matches its
// measured strength. strength = −skillRatio (fast/strong ⇒ +, slow/weak ⇒ −).
// A team with no history (skillRatio 0) has no preference — the term is a
// constant across all candidates and cancels.
function adaptiveDifficultyMatch(skillRatio: number, difficulty: number): number {
  const normalizedDifficulty = (difficulty - 5) / 5;      // 1→-0.8 … 10→+1
  return 1 - Math.abs(-skillRatio - normalizedDifficulty); // == 1 - |skillRatio + normalizedDifficulty|
}
```

Make it **always on** with one unified formula for every preset:
```ts
export function priorityScore(task, teamLocation, skillRatio, taskCounts, hotZone?, nowMs?) {
  const transitNorm = Math.min(transitMinutes(teamLocation, task), 30) / 30;
  return 0.5 * loadFactor(task, taskCounts)
       - 0.3 * transitNorm
       + 0.2 * adaptiveDifficultyMatch(skillRatio, task.difficulty ?? 5)
       + hotZoneBonus(task, hotZone, nowMs);
}
```
- The `skillAware` boolean parameter is **removed** from `priorityScore`,
  `buildRecommendations`, and `assignTask`. All presets now use the same
  `0.5 / 0.3 / 0.2` weighting (the former `smart_weighted` weights), so the
  additive `HOT_ZONE_ROUTING_BONUS` (0.35) keeps the exact calibration it was
  tuned against — no per-preset scale drift.
- **Deliberate consequence:** `fixed_points_speed` / `time_only` shift from
  `0.6·load − 0.4·transit` to `0.5·load − 0.3·transit + 0.2·adaptive`. This is
  the intended "adaptive for everyone". With `skillRatio == 0` the adaptive term
  is `1 - |normalizedDifficulty|` — a per-task constant that does not depend on
  the team, so before any history it only mildly favors mid-difficulty tasks and
  never distorts a same-difficulty comparison.

### Call sites (functions/src/runs/index.ts)
Both already compute `skillRatio` via `computeSkillRatio` unconditionally, so no
new data is needed — just drop the preset argument:
- `assignNextInActiveStage` → `assignTask(teamLocation, candidateTasks, completedTaskIds, skillRatio, ownerUid, gameId, runId)` (remove `game.scoringPreset === 'smart_weighted'`).
- `getRecommendedTasks` → `buildRecommendations(..., 5)` (remove the trailing preset arg).

`computeSkillRatio` itself is unchanged (sign convention stays; we flip only at
consumption inside `adaptiveDifficultyMatch`).

## Part 2 — Default requiredTaskCount = 1 for new stages

No shared type or server change — `requiredTaskCount` and its launch clamp
(`Math.max(1, Math.min(count, tasks.length))`, undefined = all) already exist and
stay. Only the *authoring defaults* change:

- **`apps/creator-web/src/pages/BuilderPage.tsx` `blankStage`:**
  `{ id, order, title, tasks: [blankTask()], requiredTaskCount: 1 }`.
- **`apps/creator-web/src/templates.ts` `stage()` factory:**
  default `requiredTaskCount: 1` (still overridable per template via `over`).

Because a fresh stage has one task, the "complete N of M" control (rendered only
when `m > 1`, BuilderPage ~L714) is hidden until a second task is added — at
which point it shows `req = requiredTaskCount ?? m = 1`, i.e. "complete **1** of
2 (best-suited, others skipped)". That existing control is the comfortable place
to raise the count or set it back to all. Copy already exists
(`completionLead` / `completionOf` / `completionRouted` / `completionAll`); reuse
as-is — verify the phrasing reads correctly with the new default (adjust only if
misleading, keeping EN+HE parity).

**Backward compatibility:** existing games load with their stored value
(undefined ⇒ all). Only stages created after this change carry the `1` default.
The `insertFromLibrary` "blank untouched first task" replacement path is
unaffected (it edits `tasks`, not `requiredTaskCount`).

## Test strategy

### Adaptive routing — vitest (pure), TDD RED→GREEN
Extend `functions/src/routing/assignNextTask.test.ts`. Build two equidistant,
equal-load candidate tasks that differ ONLY in `difficulty` (e.g. `easy`=2,
`hard`=9), same team location, `taskCounts` empty:
- **strong team** (`skillRatio = -0.8`): `priorityScore(hard) > priorityScore(easy)`.
- **weak team** (`skillRatio = +0.8`): `priorityScore(easy) > priorityScore(hard)`.
- **neutral** (`skillRatio = 0`): `priorityScore(hard) == priorityScore(easy)`
  when the two tasks are symmetric around difficulty 5 (e.g. 2 and 8), proving no
  preference without history.
- **always-on**: the same strong-team ordering holds with no preset gate — the
  removed `skillAware` argument means every call adapts (assert via the new
  signature; there is no longer a "false" path).
- Update the **existing hot-zone tests** to the new `priorityScore` signature
  (drop the `false` skillAware arg). Their tasks are all `difficulty 5`
  (adaptive term constant) and assert *differences*, so the expected values are
  unchanged — confirm they stay green.

Optionally add a small seeded property check (monotonicity: increasing a team's
strength never decreases the relative preference for the harder of two tasks).

### requiredTaskCount default — UI, no logic test
Verified via the preview tools + `npm run i18n:check`:
- Add a stage, add a second task → the completion control appears reading
  "complete 1 of 2 (routed)"; two teams in a launched run get routed to
  different single tasks (already covered structurally by the existing
  partial-stage e2e scenario, which exercises `requiredTaskCount` end-to-end — no
  new callable, so the coverage guard is untouched).
- No new user-facing strings expected; if copy is tweaked, keep EN+HE parity and
  route through `t.*` (no hardcoded strings).

## Footguns respected
- No Firestore writes change; routing still increments/decrements
  `run.taskCounts` transactionally via the untouched `assignTask` / `releaseTask`.
- No dotted-array updates; `requiredTaskCount` is a scalar stage field.
- Answer-key secrecy, `FIRESTORE_PATHS`, and server-write-only state all unchanged.
- No new index, rule, or env var.
