# scoring-v2 — design

## Research (how comparable games score)

| Game | Rule | What we take |
|---|---|---|
| Kahoot | `points = max × (1 − (t/T)/2)`: a correct answer earns at least 50% | a bounded speed multiplier with a generous floor |
| Loquiz | per-task points by answer speed, plus a fixed bonus under N seconds | speed scales points; it does not replace them |
| Goosechase | fixed mission points, manual bonuses | mission value is the creator's, speed is secondary |
| Rogaine / Score-O | fixed control values; per-minute penalty only past the limit | time is a bounded adjustment |
| Orienteering ranking | the reference time is the MEDIAN (or the mean of the leading 50%) of the field; points by percent behind the reference | the reference comes from the field, so a bad course estimate cancels out |

## D1 — per-mission multiplier (smart_weighted)

`smartMultiplier(x) = 0.7 + 0.6 / (1 + e^{2.5(x−1)})`, where `x = actual / estimate`.

| x | multiplier |
|---|---|
| 0 | ≈ 1.27 |
| 1 | exactly 1.0 |
| → ∞ | → 0.7 |

- Non-finite or ≤ 0 estimate ⇒ 0 points (unchanged guard).
- `skipAward('smart_weighted')` and paused tasks still score on-target (x = 1). On-target now pays
  exactly `100 × d/10`, so they are worth the difficulty value.
- Only completions after deploy use the new curve. A stored `earnedScore` is never rewritten.

## D2 — field-relative pace (fixed_points_speed + smart_weighted, finished teams only)

For each finished team:
- `d` = adjusted duration, minutes. Pause-clock tasks and staff holds are already excluded.
- `E` = Σ `expectedDurationMinutesAtCompletion` over **completed** records. The template fallback
  for legacy records is kept.

Computing the pace ratio `r` (pure `fieldPaceRatios`):
- **Mode.** If any finisher has `E > 0`, use paced values `v = d / E` among those, and a finisher with `E = 0` gets `r = null`. Otherwise use raw
  durations `v = d`, so a game with no estimates is still a plain race against the field.
- **n ≥ 2 finishers.** `ref = median(v)`, and `r = v / ref`. If `ref ≤ 0`, then `r = null`.
- **n = 1, paced mode.** `q = d / E`. Then `r = q` when `1/3 ≤ q ≤ 3`, else `null` (the estimate is
  implausible, so it is not trusted).
- **n = 1, raw mode.** `r = null`.

Turning `r` into a bonus:
- `pacePct(r) = clamp(0.5 × (1 − r), −0.10, +0.15)`, and `null ⇒ 0`. The slow side is capped at the
  completion bonus, so the slowest finisher never scores below an unfinished team with the same points.
  For example, 20% faster than the field median earns +10%.
- `paceBonus = round(points × pacePct)`.

Why the estimate cancels: if every estimate is off by a factor k, then every `v` is off by 1/k,
and `r = v / median(v)` is unchanged.

Unfinished teams get no pace term. That is the same as the old Z-score, and it keeps their live
score time-invariant.

## D3 — percentages

`points` = Σ finite `earnedScore` over completed and skipped records. This is the same sum the
presets already used, and it includes skip consolations.

```
score = max(0, points + round(points × 0.10 if all stages completed) + paceBonus − bonusPenalty)
```

Every bonus is proportional to what the team earned on missions. `bonusPenalty` is applied once,
last, so flat adjustments (hints, staff ±, discovery, zone capture, power-up +15) keep their exact
value. That keeps the e2e "−20 adjustment ⇒ score − 20" and "discovery = 40" assertions true.

## Parity and immutability

- Every input is a stored stamp on a team document (`earnedScore`, the expected-minutes stamp,
  `startedAt` / `finishedAt`, the exclusion stamps), or the set of finished teams. That is the same
  set the Z-score already used.
- `buildRankings` remains the only ranking site, so the live board and the final board compute the
  same function. A finalized run's stored board is frozen.

## Retired

- `speedBonus`, `SPEED_BONUS_*`, `applyZScoreBonus`, `COMPLETION_BONUS` (flat),
  `applyCompletionBonus` and the speed half of `scoreFixedPointsSpeed`.
- Their tests are rewritten for the replacements, not deleted. The property lane keeps the
  invariants: bounded, finite, monotone.

## Test strategy

1. RED, pure (`scripts/test-scoring-v2.ts`):
   - the curve's bounds and its on-target value of 1.0;
   - estimate cancellation (scale every E by k ⇒ identical r);
   - the n=1 plausibility band;
   - raw mode;
   - the pace clamp;
   - the percentage composition, with the penalty applied last;
   - expected minutes taken from completed records only.
2. RED, property (`invariants.property.test.ts`): `pacePct` is bounded and non-increasing in r;
   `smartMultiplier` is bounded and non-increasing in x.
3. GREEN: shared, then `buildRankings`, then the copy.
4. Gates: `npm run verify` pieces plus the full e2e (the leaderboard oracle, live/final parity,
   the adjustment and discovery exact values).
