# Per-Task Scoring Audit — Wave I

**Scope:** verify that a SINGLE task's `earnedScore` is computed correctly and matches the
intended semantics of each of the three scoring presets. Read-only math audit with worked
numerical examples.

**Files inspected**
- `packages/shared/src/scoringPresets.ts` — the preset formulas (source of truth).
- `functions/src/runs/index.ts` — `completeTaskForTeam`, lines 793–912 (where `earnedScore` is set at completion).
- `packages/shared/src/types/index.ts` — Task field ranges (`difficulty: number // 1–10`, line 246).

**Where per-task `earnedScore` is written** — `functions/src/runs/index.ts:842-855`:

```ts
let earnedScore = 0;
if (gameTask) {
  switch (game.scoringPreset) {
    case 'time_only':          earnedScore = 0; break;
    case 'fixed_points_speed': earnedScore = taskScoreFixed(gameTask); break;
    case 'smart_weighted':     earnedScore = taskScoreSmart(gameTask.difficulty, actualMinutes, gameTask.estimatedMinutes); break;
  }
}
```

`actualMinutes` is computed at `index.ts:796-797` and is **already hardened** before it reaches any
formula:
```ts
const rawMinutes = (new Date(now).getTime() - new Date(startedAt).getTime()) / 60_000;
const actualMinutes = Number.isFinite(rawMinutes) ? Math.max(0, rawMinutes) : 0;
```
So an unparseable timestamp → `0`, and negative elapsed (clock skew) → `0`. This guard is the
first line of defense for every preset and it holds.

After the switch, two **separate audited channels** may scale `earnedScore`: the Hot-Zone
multiplier (`index.ts:859-863`) and the double-points power-up (`index.ts:889-902`). Both are
`Math.round(earnedScore * m)` with finite multipliers and cannot introduce NaN/Infinity; power-ups
are explicitly disabled for `time_only` (`index.ts:918`). They are out of the core per-task-formula
scope but were checked for poisoning and are clean.

---

## Preset A — `time_only`

**Intended:** ranked purely by total race duration; per-task points must NOT differentiate teams.

**As implemented** (`index.ts:846`, `scoringPresets.ts:17-27`): `earnedScore = 0` for every task,
unconditionally. Ranking is done by `durationSeconds(startedAt, finishedAt)` elsewhere.

**Worked examples** — every task, any difficulty, any time → `earnedScore = 0`.
- Task done in 2 min → 0.
- Task done in 40 min → 0.
- Hot-zone task (multiplier 2×) → `round(0 × 2) = 0`.
- Power-ups: gated off for this preset, so no flat bonus can leak in (`index.ts:918`).

**VERDICT: CORRECT.** No per-task path can inject a points advantage. `durationSeconds` returns
`Infinity` for a team that never finished (`scoringPresets.ts:25`) and `Math.max(0, …)` floors
negative clock-skew durations to 0 — a DNF sorts last, and skew can't produce a negative winner.

---

## Preset B — `fixed_points_speed`

**Intended:** each completed task awards its fixed `pointValue`; the *run as a whole* earns an
additional speed bonus for finishing under the expected total time.

**Per-task, as implemented** (`index.ts:849`, `scoringPresets.ts:81-85`):
```ts
export function taskScoreFixed(task) {
  return Number.isFinite(task.pointValue) ? task.pointValue : 0;
}
```
Per-task `earnedScore` = `pointValue`, independent of time. The speed bonus is **not** a per-task
quantity — it is computed once over the whole run in `scoreFixedPointsSpeed` /
`speedBonus` (`scoringPresets.ts:37-78`), so a single task's score is purely its fixed points.
This matches the intent (speed is a run-level bonus, not a per-task modifier).

**Worked examples — per-task:**
| pointValue | time to complete | earnedScore | expected |
|---|---|---|---|
| 100 | 3 min | 100 | 100 ✓ |
| 100 | 30 min | 100 | 100 ✓ (time-independent) |
| 0 | any | 0 | 0 ✓ (valid: pure data-collection task) |
| undefined | any | 0 | 0 ✓ (NaN guard) |
| **-50** | any | **-50** | should be 0 — **see Bug B1** |

**Worked examples — run-level speed bonus** (`speedBonus`, `SPEED_BONUS_PER_MINUTE=10`,
`SPEED_BONUS_CAP=200`): `delta = expected - actual; delta<=0 ? 0 : min(200, round(delta*10))`.
- expected 60, actual 45 → delta 15 → `min(200, 150) = 150`.
- expected 60, actual 30 → delta 30 → `min(200, 300) = 200` (**capped**).
- expected 60, actual 60 → delta 0 → `0` (at exactly expected).
- expected 60, actual 90 → delta −30 → `0` (**never negative** — a slow team keeps its fixed points, loses no points).
- expected 60, actual 0 → delta 60 → `min(200, 600) = 200` (capped).

**Speed-bonus properties:** floor 0, ceiling +200, monotonic (faster ⇒ never fewer points),
never negative. Guarded against a task missing both durations (`scoringPresets.ts:71-73`
`Number.isFinite(m) && m > 0`) so a bad task contributes 0 to the expected total rather than NaN.

**VERDICT: CORRECT** for well-formed data. One low-severity defensive gap: negative `pointValue`
(Bug B1). **Design note:** with 100-point tasks a fast run adds at most +200 total — the speed
bonus is a modest tie-breaker, not a dominant factor. That matches the label ("up to +200 pts")
and is a reasonable, non-surprising balance.

---

## Preset C — `smart_weighted` (the "Smart Score")

**Intended:** each task earns `100 × (difficulty/10) × sigmoid(actual/estimated)` — harder tasks
worth more, faster-than-estimate worth more.

**As implemented** (`index.ts:852`, `scoringPresets.ts:92-109`):
```ts
sigmoidMultiplier(x) = 0.2 + 1.3 / (1 + exp(3 * (x - 1)));   // x = actual/estimated

taskScoreSmart(difficulty, actualMinutes, estimatedMinutes):
  if (!Number.isFinite(estimatedMinutes) || estimatedMinutes <= 0) return 0;   // no div-by-zero
  d = Number.isFinite(difficulty) ? Math.max(0, difficulty) : 0;               // clamp >= 0
  x = (Number.isFinite(actualMinutes) ? actualMinutes : 0) / estimatedMinutes;
  return Math.round(100 * (d / 10) * sigmoidMultiplier(x));
```

**Sigmoid characterization** (function of the ratio `x = actual/estimated`):
- Midpoint / inflection at `x = 1` (on-estimate): `sigmoid(1) = 0.2 + 1.3/2 = 0.85`.
- Steepness `k = 3` in `exp(3(x-1))`.
- Instant (`x → 0`): `sigmoid(0) = 0.2 + 1.3/(1+e^-3) = 0.2 + 1.238 = 1.438`.
- Very slow (`x → ∞`): `→ 0.2` (floor). Theoretical ceiling as `x→ -∞` is `1.5`, unreachable since `x ≥ 0`.
- **Range: [0.2, 1.438]** over the reachable domain — bounded, no explosion, always positive.

**Worked examples** — `score = round(100 × d/10 × sigmoid(x))`:

| case | d | x=actual/est | sigmoid(x) | score | check |
|---|---|---|---|---|---|
| EASY fast | 2 | 0.5 | 0.2 + 1.3/(1+e^-1.5)=1.2629 | round(100·0.2·1.2629)=**25** | |
| EASY slow | 2 | 2.0 | 0.2 + 1.3/(1+e^3)=0.2616 | round(100·0.2·0.2616)=**5** | |
| HARD fast | 8 | 0.5 | 1.2629 | round(100·0.8·1.2629)=**101** | |
| HARD slow | 8 | 2.0 | 0.2616 | round(100·0.8·0.2616)=**21** | |

- (i) **Harder worth more at equal speed:** fast → 101 (HARD) vs 25 (EASY); slow → 21 vs 5. ✓
- (ii) **Faster worth more at equal difficulty:** HARD → 101 (fast) vs 21 (slow); EASY → 25 vs 5. ✓
- (iii) **Saturates sensibly:** multiplier floored at 0.2, ceiled ≈1.438, always ≥0, no divide-by-zero. ✓

**Difficulty boundary checks:**
- `difficulty = 0` → `d/10 = 0` → score **0** (a zero-difficulty task is worth nothing; consistent).
- `difficulty = 1` (min) → factor 0.1 → e.g. on-estimate `round(100·0.1·0.85)=9`.
- `difficulty = 10` (max) → factor 1.0 → on-estimate `round(100·1·0.85)=85`; instant `round(100·1·1.438)=144`.
- `difficulty < 0` → `Math.max(0, d)` → 0 → score **0** (cannot subtract). ✓
- `difficulty = undefined/NaN` → `d = 0` → score **0** (no NaN). ✓
- `difficulty > 10` (e.g. 20) → **NOT clamped at the top** → `d/10 = 2.0`, instant score `round(100·2·1.438)=288`. **See Design Note C1.**

**Estimated / actual boundary checks:**
- `estimatedMinutes = 0` / negative / NaN → early return **0** (no divide-by-zero). ✓
- `actualMinutes` reaching this fn is already finite ≥0 (index.ts:797). The internal
  `Number.isFinite(actualMinutes) ? … : 0` is redundant-but-safe. Note it maps a (hypothetical)
  NaN actual → `x=0` → **highest** multiplier; same for clock-skew flooring to 0 → `x=0` → best
  score. Not reachable as a NaN in practice, but see Design Note C2.

**VERDICT: CORRECT.** All three monotonicity/scaling properties hold, the sigmoid is bounded and
positive, and every malformed input (NaN, negative difficulty, zero/negative estimate) is guarded
to a finite non-poisoning value. Two non-blocking notes (C1, C2) below.

---

## Bugs & gaps

| id | file:line | wrong behavior | failing input | severity | one-line fix |
|---|---|---|---|---|---|
| B1 | `packages/shared/src/scoringPresets.ts:84` (`taskScoreFixed`) & `:215` (`skipAward` fixed branch) | Guards NaN but **not negativity**: a negative `pointValue` is returned as-is and *subtracts* from the team total (poisons the leaderboard the same way NaN would). Inconsistent with `taskScoreSmart`, which clamps difficulty `>= 0`. | Task with `pointValue = -50` → `earnedScore = -50` | Low (requires malformed/hand-authored task data; creator UI likely prevents it) | `return Number.isFinite(task.pointValue) ? Math.max(0, task.pointValue) : 0;` |

No NaN, Infinity, or divide-by-zero was found in any per-task path for well-formed data. The
nightly-hardening finiteness guards (`Number.isFinite` on `earnedScore` in the aggregators
`scoreFixedPointsSpeed`/`scoreSmartWeighted`, `helpers.ts:48`) mean even one poisoned per-task
record cannot NaN a whole team total.

## Design notes (not bugs — flagged for fairness/surprise)

- **C1 — `smart_weighted` has no upper clamp on difficulty.** `Math.max(0, difficulty)` floors but
  never ceils. The Task type documents `difficulty: 1–10` (`types/index.ts:246`), but a task with
  `difficulty > 10` earns proportionally more (difficulty 20 ≈ 2× the intended max). If creator
  validation ever lets a >10 value through, that task dominates the run. Consider
  `Math.min(10, Math.max(0, difficulty))` for symmetry with the documented range. `scoringPresets.ts:106`.
- **C2 — degenerate times map to the *best* smart multiplier, not a neutral one.** A NaN
  `actualMinutes` (unreachable given the upstream guard) or a clock-skew "finish before start"
  (floored to `actualMinutes = 0` at `index.ts:797`) both yield `x = 0` → sigmoid ≈ 1.438, i.e. the
  maximum speed reward. It would be slightly fairer for a degenerate/zero elapsed time to award the
  on-estimate multiplier (`x = 1`, 0.85) rather than the instant-completion peak. Very low impact
  (requires a 0-second completion), noted for completeness.
- **Speed-bonus scale (B, informational):** +200 max vs typical 100-point tasks — the bonus is a
  deliberately modest tie-breaker, not a dominant term. Consistent with the preset's label; no action needed.

---

## Bottom line

- **`time_only`** — CORRECT. Per-task always 0; ranking is pure duration; no leak.
- **`fixed_points_speed`** — CORRECT for well-formed data; per-task = fixed `pointValue`,
  run-level speed bonus is floored/capped/monotonic/non-negative. One low-sev gap: negative
  `pointValue` not clamped (Bug B1).
- **`smart_weighted`** ("Smart Score") — CORRECT. Harder⇒more, faster⇒more, sigmoid bounded in
  [0.2, 1.438], all malformed inputs guarded to finite. Two low-impact design notes (C1 no upper
  difficulty clamp, C2 degenerate-time peaks the multiplier).

The math holds. The user can have confidence the smart score and the other presets are accurate;
the only concrete fix worth making is B1 (one-line negativity clamp in `taskScoreFixed`).
