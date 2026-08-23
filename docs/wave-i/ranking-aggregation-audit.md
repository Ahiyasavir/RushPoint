# Wave-I — Final Ranking & Score Aggregation Audit

**Scope:** verify the final ranking and score aggregation are correct, fair, and identical
between the live (`refreshLeaderboard` / auto-snapshot) and final (`finalizeRun`) boards, across
all three presets. Read-only audit; no source changed.

**Verdict up front: CLEAN BILL.** The aggregate is a pure, `now`-independent function shared by
every board write-path, so live and final cannot drift. All identified non-finite / divide-by-zero /
tie paths are guarded. Ranking is a deterministic total order. Three design notes (not bugs) are
flagged at the end for the user's awareness (Z-bonus magnitude, `time_only` placeholder score,
zero-stage completion bonus).

---

## 1. The formula, as actually implemented

### Aggregate (per team) — `buildRankings`, `functions/src/runs/index.ts:1129-1246`

```
rawScore = preset switch:
    time_only          -> 0                                            (:1136)
    fixed_points_speed -> scoreFixedPointsSpeed(stages, startedAt,
                            status==='finished' ? finishedAt : undefined, game)  (:1145)
    smart_weighted     -> scoreSmartWeighted(stages)                   (:1153)

rawScore = applyCompletionBonus(rawScore, stages)   (:1157)  // +500 iff every stage 'completed'
rawScore = applyPenalties(rawScore, bonusPenalty ?? 0)  (:1161)  // max(0, score - bonusPenalty)

// Z-score, non-time presets only, >=2 finishers:
if preset != time_only && scored.length >= 2 && finishedDurations.length >= 2:  (:1197-1201)
    score = applyZScoreBonus(score, durationMin, finishedDurations)  (:1204)

score = Number.isFinite(rawScore) ? rawScore : 0   (:1187)  // non-finite backstop -> 0
```

### The shared helpers — `packages/shared/src/scoringPresets.ts`

- `applyCompletionBonus(raw, stages)` (`:132`): `raw + (stages.every(s=>s.status==='completed') ? 500 : 0)`. `COMPLETION_BONUS = 500` (`:130`).
- `applyPenalties(score, bonusPenalty)` (`:141`): `Math.max(0, score - bonusPenalty)` — **score can never go negative**.
- `applyZScoreBonus(raw, teamDurMin, allDurMin[])` (`:166-178`):
  ```
  if allDurMin.length < 2: return raw
  mu = mean(allDurMin);  sigma = sqrt(populationVariance(allDurMin))
  if !isFinite(sigma) || sigma === 0: return raw          // zero-variance / NaN guard
  z = (teamDurMin - mu) / sigma
  return Math.max(0, raw + Math.round(-z * 200))           // faster (z<0) => +bonus; clamp >=0
  ```
- `scoreFixedPointsSpeed` (`:46-78`): sums `earnedScore` of `completed|skipped` tasks (finiteness-guarded, `NaN -> 0`); if both `startedAt`/`finishedAt` present, adds `speedBonus(expectedTotal, actualTotal)` where `speedBonus = min(200, round((expected-actual)*10))`, `0` if not faster. **Passing `finishedAt=undefined` for an unfinished team short-circuits to pure task points** — time-invariant.
- `scoreSmartWeighted` (`:111-124`): sums finiteness-guarded `earnedScore` of `completed|skipped` tasks. (Per-task `earnedScore` was computed at completion via `taskScoreSmart`, itself clamped: `difficulty` floored at 0, non-finite inputs -> 0, `estimatedMinutes<=0 -> 0`.)
- `durationSeconds(startedAt, finishedAt)` (`:24-27`): `Infinity` if either missing, else `max(0, (finish-start)/1000)`.

### Key structural guarantee — **`now` is dead in `buildRankings`**

`buildRankings(game, teams, now)` receives `now` but **never references it**. Both the score
(`scoreFixedPointsSpeed` gets `status==='finished' ? finishedAt : undefined`, `:1148`) and the
emitted duration (`durationSeconds(startedAt, status==='finished' ? finishedAt : undefined)`,
`:1171`) are gated on stored `status`/`finishedAt`, not wall-clock. **The output is therefore a
pure function of `(game, teams)`.** Given identical team docs, `finalizeRun` (`:1484`),
`refreshLeaderboard` (`:1749`), and the auto-snapshot `maybeRefreshLeaderboardSnapshot` (`:1286`)
— all three calling `buildRankings(game, parseTeamsQuarantining(docs), now)` — produce
**byte-identical rankings.** Live/final parity holds by construction.

---

## 2. `bonusPenalty` sign convention — consistent everywhere, no double-count

`bonusPenalty` is **subtracted** from score (`applyPenalties`). Convention: **a bonus is a
NEGATIVE penalty (decrement), a fine is a positive penalty (increment).** Every channel obeys it:

| Channel | Site | Write | Effect |
|---|---|---|---|
| Hint reveal | `:3014` | `bonusPenalty += penalty` (default 25) | fine (score down) ✓ |
| Manual adjust (`adjustTeamScore`) | `index.ts:1206` via `nextBonusPenalty(prev, delta)` = `prev - delta` (`scoring/bonusPenalty.ts:18`) | `+delta` (bonus) -> penalty down -> score up; `-delta` (fine) -> penalty up | bonus / fine ✓ |
| Power-up `bonus_points` (+15) | `:927` | `bonusPenaltyDelta -= POWER_UP_BONUS` (`=15`) | bonus ✓ |
| Discovery-POI bonus | `:1443` | `bonusPenalty -= bonus` | bonus ✓ (wave-G fix reads correctly — rides the counted channel, `team.score` kept only for display and is ignored by `buildRankings`) |
| Territory capture bonus | `:2297` | `bonusPenalty -= (zone.captureBonus ?? 0)` | bonus ✓ |
| Power-up `double_points` (×2) | `:892` | mutates `earnedScore`, **not** `bonusPenalty` | rides the `earnedScore` channel ✓ |

**No double-counting:** `buildRankings` derives the ranked score exclusively from
`stages[].earnedScore` (+ completion bonus) − `bonusPenalty`. It **never reads `team.score`.**
`team.score` is a parallel display-only running total (participant header / staff console);
discovery/power-up keep both in step but only `bonusPenalty` / `earnedScore` feed the ranking, so
maintaining both does not double count. `nextBonusPenalty` clamps `±1e9` and rejects a non-finite
accumulation — a poisoned `bonusPenalty` can't reach the board.

---

## 3. Worked 3-team examples (hand-computed vs the code's formula)

### 3a. `fixed_points_speed`

Game template: 2 stages / 3 tasks, `expectedTotal = 40` min; pointValues 100/100/200.

| Team | tasks done | taskPoints | actual min | speedBonus | +compl. | bonusPenalty sources | after penalties | finished? |
|---|---|---|---|---|---|---|---|---|
| Alpha | 3/3 | 400 | 30 | `min(200,round(10*10))=100` | +500 -> 1000 | hint +25, power-up −15, manual +50(delta)->−50 = **−40** | `max(0,1000−(−40))=`**1040** | 30 min |
| Bravo | 3/3 | 400 | 50 | delta<0 -> 0 | +500 -> 900 | hint +25 | `900−25=`**875** | 50 min |
| Charlie | 2/3 | 200 | — (unfinished) | n/a (finishedAt undefined) | not all completed -> +0 -> 200 | 0 | **200** | no |

Z-score cohort = finished durations `[30, 50]` (Charlie excluded, unfinished). `mu=40, sigma=10`.
- Alpha: `z=(30−40)/10=−1 -> +round(200)=+200 -> 1040+200 = 1240`
- Bravo: `z=(50−40)/10=+1 -> −200 -> 875−200 = 675`
- Charlie: not finished -> no Z -> `200`

**Ranking (sort by score desc): Alpha 1240 (#1), Bravo 675 (#2), Charlie 200 (#3).** Matches the
code (`b.score - a.score`, `:1222`). A finish 20 min faster + a manual bonus + a power-up cleanly
outrank equal task points.

### 3b. `smart_weighted`

`buildRankings` sums the **stored** per-task `earnedScore` (computed at completion). Assigned totals:

| Team | Σ earnedScore | +compl. | bonusPenalty | after penalties | finished |
|---|---|---|---|---|---|
| Alpha | 333 (all stages) | +500 -> 833 | hint +25 | 808 | 25 min |
| Bravo | 280 (all stages) | +500 -> 780 | 0 | 780 | 35 min |
| Charlie | 130 (1 stage skipped) | not all 'completed' -> +0 | power-up −15 | 145 | 40 min |

Z cohort `[25, 35, 40]`: `mu=33.33, sigma≈6.24`.
- Alpha: `z≈−1.336 -> +round(267)=+267 -> 1075`
- Bravo: `z≈+0.268 -> −54 -> 726`
- Charlie: `z≈+1.069 -> −214 -> max(0,145−214)=0`

**Ranking: Alpha 1075 (#1), Bravo 726 (#2), Charlie 0 (#3).** Matches the code. Points drive the
order; time (Z) is the modifier. Note Charlie's Z penalty hit the `max(0, …)` floor — clamped, no
negative score.

### 3c. `time_only`

`rawScore = 0`; sort ignores score and orders by finish time ascending (`:1211-1220`).

| Team | finished | durationSeconds | rank |
|---|---|---|---|
| Alpha | yes, 30 min | 1800 | #1 |
| Bravo | yes, 45 min | 2700 | #2 |
| Charlie | no | (unfinished -> `Infinity`) | #3 |

Sort key `aDone = finishedAt ? durationSeconds : Infinity`, ascending -> **fastest wins,
unfinished sink to the bottom**, tie-broken by `completedStages` desc then `teamId.localeCompare`.
Matches the code. (Placeholder score here is actually **500** for all-complete teams — see Note 2;
the sort ignores it and the boards hide it.)

---

## 4. Preset-specific ranking — confirmed

- **`time_only`**: rank is **purely by time**; `score` is a placeholder the sort never consults.
  The public and TV boards both explicitly detect `scoringPreset === 'time_only'` and render the
  **time** as primary, hiding the points value — `PublicLeaderboardScreen.tsx:89-92,165` and
  `TvLeaderboard.tsx:55-57,113`. ✓
- **`fixed_points_speed` / `smart_weighted`**: **points drive rank** (`b.score - a.score`,
  `:1222`), with time entering as the speed bonus (fixed) / sigmoid weight + Z-score (both). ✓
- **Deterministic total order**: the comparator always terminates in `teamId.localeCompare`
  (`:1220` / `:1233`) after `score -> completedStages -> finished -> durationSeconds`. Since
  `teamId` is unique (`== uid` / doc id), the order is a **strict total order** — stable across
  identical snapshots read from an unordered Firestore query. Ranks never churn between refreshes.
  ✓ (Explicitly comment-motivated at `:1216-1218`, `:1223-1227`.)

---

## 5. Live vs final parity — the four tricky states

Because `buildRankings` is `now`-independent and all three write-paths feed it the same
quarantined team docs:

| Scenario | Behavior | Parity |
|---|---|---|
| Team mid-task at finalize | `status != 'finished'` -> no completion bonus, `finishedAt`/duration omitted, no Z; sorts by score/progress. Same in live & final for the same doc. | ✓ |
| Skipped / exclusive-group task | `status === 'skipped'` still **counts** its `earnedScore` in both point sums; but a skipped **stage** blocks the `every==='completed'` completion bonus. `completedStages` counts only `'completed'`. Consistent in both boards. | ✓ |
| Hidden-location task not yet arrived | Remains `pending` -> not summed, stage not complete -> no bonus. Identical treatment live & final. | ✓ |
| Team that never started | `startedAt` undefined -> `durationSeconds = Infinity` -> `durFinite` omitted, `durationMin = Infinity` (excluded from Z cohort). Emits a finite score (0-ish), ranks at the bottom via the comparators' `?? Infinity`. No crash, no absent rank. | ✓ |

`completedStages`, `finishedAt`, `durationSeconds` are computed by one code block for every path
(`:1188-1192`). No divergence found.

---

## 6. Edge cases

| Input | Result | Status |
|---|---|---|
| Empty run (0 teams) | `scored=[]`; Z gate `length>=2` false; sort of `[]`; returns `[]`. | Safe |
| 1 team | `<2` -> no Z; single entry rank 1. | Safe |
| All-zero scores (points preset) | `b.score-a.score=0` -> deterministic tie-break chain -> `teamId`. Stable. | Safe |
| All-equal finish times | `sigma===0` -> `applyZScoreBonus` returns raw unchanged. **No divide-by-zero / NaN.** | Safe (`:175`) |
| Huge penalty (negative net) | `applyPenalties` `max(0,…)` and `applyZScoreBonus` `max(0,…)` both clamp. Score never negative on the wire. | Safe |
| Team with only skipped tasks | `skipped` counted in point sums; stage not `'completed'` -> no completion bonus; `completedStages=0`. Consistent. | Safe (by design) |
| NaN/Inf per-task `earnedScore` | Finiteness guard `Number.isFinite(e) ? e : 0` in both sum fns; final `Number.isFinite(rawScore) ? : 0` backstop (`:1187`). | Safe |
| Bad timestamp (Inf duration) | `durFinite` omitted; `durationMin=Inf` excluded from Z cohort; comparators coalesce `?? Infinity`. | Safe |
| Non-finite `bonusPenalty` (accumulated) | `nextBonusPenalty` rejects non-finite + clamps `±1e9`; `?? 0` default at read. | Safe |
| Tie on every field | Final tiebreak is `teamId.localeCompare` — unique key -> strict total order. | Safe |

No edge case produces a wrong rank, a crash, a non-finite score on the wire, or a
non-deterministic order.

---

## 7. Bug table

| # | file:line | Wrong behavior | Failing input | Severity | One-line fix |
|---|---|---|---|---|---|
| — | — | **No bugs found.** Aggregate, Z-score, parity, presets, and edge cases all verified correct. | — | — | — |

---

## 8. Design / fairness notes (NOT bugs — flagged for the user)

1. **Z-bonus can invert a points lead (intended time-normalization, but sizeable).** The Z term is
   `round(-z * 200)`, so each standard deviation of finish time swings **±200 pts** (unbounded in
   sigma count, only floored at 0). In §3b, Charlie's slowness cost 214 pts and zeroed its score;
   a team ~2σ faster gains ~+400. If two teams' point totals differ by less than the Z swing, the
   **faster team wins on time despite fewer earned points.** This is the documented "Z-Score time
   normalization" behavior and is *correct as specified* — but the magnitude (200/σ, no cap) means
   time is a first-class ranking factor, not a mere tiebreak, in the two points presets. Worth a
   conscious product decision if you intend points to dominate.

2. **`time_only` "placeholder" score is ~500, not 0.** For `time_only`, `rawScore=0` but
   `applyCompletionBonus` still adds **500** to every all-complete team (and hints/discovery/
   territory still move `bonusPenalty`), so `entry.score` is `500 − bonusPenalty`, not 0. The sort
   ignores it and the public/TV boards correctly hide it (§4), so this is **cosmetic only** — but
   any surface that shows the raw `score` for a `time_only` run (e.g. a debug view) would display a
   confusing non-zero number. Harmless to ranking.

3. **Zero-stage game gets the completion bonus.** `applyCompletionBonus` uses
   `stages.every(...)`, and `[].every()` is `true`, so a team in a game with **no stages** receives
   +500. Degenerate config (the Builder shouldn't allow it), zero real-world impact, but noted for
   completeness.

---

## Evidence summary

- Aggregate formula: `functions/src/runs/index.ts:1129-1246` (+ helpers `packages/shared/src/scoringPresets.ts:130-178`).
- Shared by all 3 board writers: `finalizeRun` `:1484`, `refreshLeaderboard` `:1749`, `maybeRefreshLeaderboardSnapshot` `:1286` — all `buildRankings(game, parseTeamsQuarantining(docs), now)`.
- `now` unused inside `buildRankings` -> live/final parity by construction.
- `bonusPenalty` sign convention consistent across all 6 channels; no double-count (`buildRankings` ignores `team.score`).
- All non-finite / zero-variance / single-team / tie paths guarded; ranking is a strict total order.
