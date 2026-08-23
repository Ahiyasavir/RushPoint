# Wave-G — Scoring / finalize / run-lifecycle correctness sweep

Read-only audit of the highest-consequence server area: `buildRankings`, `finalizeRun`,
the `onRunFinalized` Firestore trigger, the run lifecycle (skip / partial / start),
and every score-writing callable. Line numbers against the tree at audit time
(`functions/src/runs/index.ts`, `functions/src/index.ts`, `packages/shared/src/scoringPresets.ts`).

Not re-reported (already covered wave-f / earlier wave-g): the hidden-content leak surfaces,
`requestTaskHint` stage-scope, the omission migration, the station-slot-leak fixes,
the `parseTeamsQuarantining` backstop.

---

## CONFIRMED — fix queue (top priority)

| # | file:line | invariant at risk | concrete failure | sev | one-line fix |
|---|-----------|-------------------|------------------|-----|--------------|
| **1** | `runs/index.ts:1424` `claimDiscoveryPoi` (award) vs `runs/index.ts:1115-1147` `buildRankings` | Every earned point must reach the leaderboard. `buildRankings` derives score **only** from `team.stages[].earnedScore` (via `scoreFixedPointsSpeed`/`scoreSmartWeighted`) + `applyCompletionBonus(stages)` − `applyPenalties(bonusPenalty)`. It **never reads `team.score`.** | **Wrong / lost score.** `claimDiscoveryPoi` awards a surprise-trivia-waypoint bonus by writing `score: (team.score ?? 0) + bonus` — a channel `buildRankings` ignores. The bonus is therefore **absent from both the live board and the frozen final standings.** A whole feature's points silently don't count. (`captureZone:2272` does it right: awards through `bonusPenalty`, a counted channel — the discovery path is the lone outlier.) | **High** | Award through a counted channel: `bonusPenalty: (team.bonusPenalty ?? 0) - bonus` (a bonus is a negative penalty, exactly like `captureZone:2270-2272`). Drop the direct `team.score` bump. |
| **2** | `runs/index.ts:675-683` (pre-txn status read) vs `:709-987` (scoring txn) in `completeTaskForTeam` | A completion must not land after the run is finalized (`completeTaskForTeam` is the single choke point that rejects finished-run grading). | **Lost score off the final board (TOCTOU).** `run.status==='finished'` is read at :675 **outside** the transaction; the scoring txn at :709 re-reads `runRef` **only for `taskCounts`** (:717-718), never re-checking status. `finalizeRun` (:1474, a plain non-transactional `update`) can commit `status:'finished'` + freeze the board **between** the :675 read and the txn commit. The straggler's last task then commits `team.score`/`status:'finished'` **after** the board froze → its points are missing from the published final standings. Only a manual `refreshLeaderboard` (recomputes from team docs) recovers it; the auto path (`maybeRefreshLeaderboardSnapshot` bails on `frozen`) never does. Window = a team finishing its last task exactly as the organizer ends the run (common at event close). | **Med** | Re-read the run doc inside the completion txn (all reads already precede writes there) and `throw failed-precondition` if `status==='finished'`, closing the race the pre-txn guard only narrows. |

---

## LOW / NOTED (correctness-adjacent, not data loss)

| # | file:line | issue | why low | fix |
|---|-----------|-------|---------|-----|
| 3 | `runs/index.ts:1596-1601` `sendRunSummaryEmailOnce` in `onRunFinalized` | Summary email is **not** gated on `run.isTestDrive`, while player-profile folds (:1566) and the benchmark fold (:1588) both correctly exclude test-drive runs. A rehearsal (test-drive) finalize emails the owner a "run summary." | Email noise, not a data-integrity bug; guard is easy to forget precisely because it's the only one of the three folds missing it. | Wrap the `sendRunSummaryEmailOnce` call in `if (!run.isTestDrive)`, matching the other two folds. |
| 4 | `runs/index.ts:1424` `claimDiscoveryPoi`; `index.ts:1116` `adjustTeamScore` | Neither checks `run.status`. A discovery claim or a staff score adjustment after `finalizeRun` writes to the team doc, but the frozen auto-board never reflects it. | Same manual-`refreshLeaderboard` recovery as #2; post-finalize adjustments are an operator edge case. | Optional: reject when `run.status==='finished'`, or document that post-finalize adjustments require a manual board refresh. |
| 5 | `runs/index.ts:1143-1147` `buildRankings` (time_only branch) | For `time_only`, `rawScore` starts 0 but `applyCompletionBonus` (+500) and `applyPenalties(bonusPenalty)` still run, so the emitted `score` is non-zero — yet the `time_only` sort (:1197-1206) ignores `score` entirely. | A "Speed Race" board displays phantom points; and a hint/adjustment penalty never affects a `time_only` ranking (arguably by design — time_only ranks by time). Cosmetic. | If the display bothers, force `score:0` for `time_only` in the emit; otherwise leave. |

---

## CLEAN — verified robust (bill of health, do NOT re-flag)

- **`onRunFinalized` transition guard (:1531-1544)** — fires only on `before.status!=='finished' && after.status==='finished'`. `finalizeRun:1475` is the **only** writer of run `status:'finished'` (grep-confirmed; the other `status:'finished'` writes at :967/:1090/:2652/:2716 are on **team** docs, not the run doc). **There is no un-finalize / reopen path**, so `finalize→unfinalize→refinalize` is impossible for run status → the trigger can never re-fire a real transition. Post-finalize run-doc writes (the trigger's own `benchmarkContributed`/`summaryEmailSent` sets, `hotZone`, a late `refreshLeaderboard`) all re-enter `onUpdate` with `before.status==='finished'` → early-return. No infinite loop, no spurious fire on a non-finalize status write.
- **Idempotency under at-least-once redelivery / concurrent finalize** — all three folds are concurrency-safe:
  - `profileRecorded` (`recordPlayerResult:1014-1025`) — checked **and** set inside the same txn on `teamRef`; a redelivery no-ops per already-recorded team.
  - `benchmarkContributed` (`foldPlatformBenchmark:1622-1628`) — transactional claim on `runRef` before merging; two deliveries serialize, the loser returns. **No double-count** of the cross-tenant aggregate.
  - `summaryEmailSent` (`sendRunSummaryEmailOnce:1676-1682`) — same claim pattern. **No double-send.**
  - Two concurrent `finalizeRun` calls each emit an `onUpdate`, but the second's `before` is already `finished` → only one fold pass runs.
- **`applyZScoreBonus` (scoringPresets.ts:166-178)** — zero-variance / non-finite `sigma` is explicitly guarded (`if (!Number.isFinite(sigma) || sigma === 0) return rawScore`), so all-equal completion times (the classic divide-by-zero) can't produce `NaN`/`Infinity`. The z-score mutates `t.score` **after** the initial finite backstop (:1173), but `applyZScoreBonus` returns `Math.max(0, finite)` so nothing non-finite escapes into the sort/emit.
- **NaN/Infinity hygiene** — `taskScoreFixed`/`taskScoreSmart`/`scoreFixedPointsSpeed`/`scoreSmartWeighted`/`skipAward` all use `Number.isFinite` guards on every per-task/earnedScore input; `nextBonusPenalty` validates the **accumulated** result and clamps to ±1e9; `adjustTeamScore:1134` rejects a non-finite input `delta`. `buildRankings:1173` sinks any residual non-finite score to 0 and omits non-finite `durationSeconds` (:1163). `db.settings({ ignoreUndefinedProperties: true })` (`firebase.ts:10`) means the `undefined` `durationSeconds`/`totalMinutes`/`finishedAt` fields in unfinished-team rankings are dropped, not thrown on — `finalizeRun`'s write can't be stranded by them.
- **live / final parity** — `buildRankings` is effectively **`now`-independent** (the `now` param is unused; `scoreFixedPointsSpeed` and `durationSeconds` are fed `team.finishedAt`, gated on `status==='finished'`, never `now ?? finishedAt`). `finalizeRun`, `refreshLeaderboard`, and `maybeRefreshLeaderboardSnapshot` all quarantine-parse teams identically (`parseTeamsQuarantining`) and call the same `buildRankings`, so a mid-task / skipped / not-yet-arrived team is scored the same on the live and final boards. Tie-breaks are total (score → completedStages → finished → duration → `teamId.localeCompare`) in both branches, so no rank churn from the unordered team query.
- **Frozen/published interaction** — `finalizeRun:1481` writes `frozen:true, published:!manualLeaderboardReveal`; `maybeRefreshLeaderboardSnapshot:1258/1285` bails on `frozen` (double-checked inside a re-read txn using dotted field paths so it can't clobber `published`); `refreshLeaderboard` preserves prior `published`/`frozen` unless explicitly overridden. The manual-reveal board is computed+frozen but withheld — consistent across paths.
- **`reconcileTaskCounts` at finalize (:1491)** — recomputes `taskCounts` from live `activeTaskId` holders, self-healing a leaked `+1` to ground truth in one idempotent write; a team stuck mid-task keeps its real reservation rather than a lying `{}`. `completeTaskForTeam`'s finished-run reject (subject to #2's race) plus the atomic in-txn slot release mean no post-finalize double-decrement.
- **`captureZone:2272` and `completeTaskForTeam`/`skipStage` team.score writes (:949/:1089)** — the latter two mirror `earnedScore` that is **also** stamped on the stage record (:890/:1073), so `buildRankings` recomputes them from stages; `captureZone` routes through `bonusPenalty`. All three are counted. (Only the discovery path, #1, writes `team.score` with **no** matching stage/bonusPenalty entry.)

---

## ACCEPTED / KNOWN (documented tradeoff — noted, not a new bug)

- **`foldPlatformBenchmark` claim-before-write gap (:1612-1616 comment)** — the claim is set *before* the per-type merges, so if the trigger process crashes **after** the claim but **before** the merges, that run's per-task-type benchmark sample is **permanently missing** (no retry, `benchmarkContributed` already true). This is an intentional tradeoff (claim-after-write would risk a real double-count under concurrent redelivery, the worse mode) for a best-effort anonymized cross-tenant aggregate that never blocks scoring/leaderboard correctness. Confirmed as designed; flagging only so it isn't mistaken for an oversight.

---

## Highest-severity takeaway

**Finding #1 is the headline: `claimDiscoveryPoi` awards its bonus via `team.score`, the one
channel `buildRankings` ignores — so surprise-trivia-waypoint points never appear on the live
or final leaderboard.** One-line fix: award through `bonusPenalty` (negative delta), exactly as
`captureZone` already does. Finding #2 is a narrow but real finalize-vs-last-completion TOCTOU
that drops a straggler's final task from the frozen board (manually recoverable). The trigger's
idempotency claims and the scoring NaN/parity hardening all hold up — this area is otherwise strong.
