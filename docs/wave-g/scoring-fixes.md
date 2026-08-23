# Wave-G — Scoring-correctness fixes (SDD)

Two server-side scoring-correctness fixes surfaced by the Wave-G audit
(`docs/wave-g/scoring-finalize-trigger.md`). Both live in
`functions/src/runs/index.ts`. SDD + TDD (failing test first, then implement).

---

## #1 (HIGH, confirmed) — discovery-POI bonus never reaches the leaderboard

### Problem
`claimDiscoveryPoi` (`runs/index.ts` ~:1419-1427) awards its surprise-trivia-waypoint
bonus by writing `score: (team.score ?? 0) + bonus` on the team doc. But `buildRankings`
(~:1115-1180) derives every ranked score purely from `team.stages[].earnedScore`
(`scoreFixedPointsSpeed` / `scoreSmartWeighted`) + `applyCompletionBonus(stages)` −
`applyPenalties(team.bonusPenalty)`. **It never reads `team.score`.** So the discovery
bonus is invisible in BOTH the live board (`refreshLeaderboard`) and the frozen final
standings (`finalizeRun`). A whole feature's points silently don't count.

`captureZone` (~:2272) is the correct reference: it awards through the `bonusPenalty`
channel — a NEGATIVE penalty is a positive contribution — which `buildRankings` DOES read.

### Fix
Award the discovery bonus via `bonusPenalty: (team.bonusPenalty ?? 0) - bonus`, mirroring
`captureZone` exactly (same sign convention, same in-transaction discipline).

### `team.score` display decision (IMPORTANT — do not silently break a displayed number)
`team.score` **is** a live-displayed field the client reads directly (not via rankings):
- `apps/play-web/src/screens/PlayScreen.tsx` Header `score={team.score}` (:373,:435,:913)
- `apps/play-web/src/screens/StaffConsole.tsx` team rows `td.score` (:199,:398)
- `apps/creator-web/src/pages/RunConsolePage.tsx` falls back to `team.score` when a team
  has no ranking entry yet (:292)

`completeTaskForTeam` (:949,:962) and `skipStage` (:1089) keep `team.score` in step with
earned points as a running display total. The discovery feature previously bumped
`team.score`, so the participant's own header showed the bonus immediately. A pure move to
`bonusPenalty` would fix ranking but REGRESS that live header (the bonus would vanish from
the number the player sees).

**Decision: maintain BOTH channels.**
- `bonusPenalty: (team.bonusPenalty ?? 0) - bonus` → the RANKING channel (live + final board).
- `score: (team.score ?? 0) + bonus` → the DISPLAY channel (participant/staff header), kept.

This does **NOT** double-count: `buildRankings` ignores `team.score` entirely (verified —
it reads only `stages` + `bonusPenalty`), and the one place that folds `team.score` into a
result (`recordPlayerResult` :1568/:1578) prefers the leaderboard ranking and only falls
back to `team.score` when a team has no ranking row — the ranked score (now including the
bonus via `bonusPenalty`) is authoritative there. So no summation double-adds the bonus.

Note: `captureZone` does NOT keep `team.score` in step, so its bonus already does not show
in the live header — a pre-existing minor inconsistency left untouched (out of scope).

### Tests (RED first)
- **Pure unit** (`functions/src/runs/buildRankings.test.ts`): a team whose ONLY score is a
  `bonusPenalty` of `-40` (no completed tasks) must rank with `score === 40`. Proves the
  `bonusPenalty` channel is the one `buildRankings` counts (guards the fix direction).
- **e2e** (`scripts/e2e-verify.mjs`, extend the existing "discovery POIs" scenario): after a
  correct claim, assert the bonus appears in `refreshLeaderboard` rankings AND in the frozen
  `finalizeRun` board (`run.leaderboard.rankings`) for that team — numeric score reflects the
  bonus (40). Keep the existing `team.score` display assertion (still true under the dual write).

---

## #2 (MED) — finalize-vs-last-completion TOCTOU

### Problem
`completeTaskForTeam` reads `run.status === 'finished'` at ~:681-683 OUTSIDE its scoring
transaction. The transaction (~:709) re-reads the run doc only for `taskCounts` (:717-718),
never re-checking status. `finalizeRun` (:1474, a plain non-transactional `update`) can
commit `status:'finished'` + freeze the board BETWEEN the :681 read and the txn commit, so a
team completing its LAST task exactly at run-end lands its score AFTER the board froze →
missing from the published final standings. The auto path
(`maybeRefreshLeaderboardSnapshot` bails on `frozen`) never recovers it; only a manual
`refreshLeaderboard` would.

### Fix
Re-check `run.status` INSIDE the completion transaction using the run doc it already re-reads
for `taskCounts` (all reads still precede all writes — no new read, no disturbance to the
station-slot reservation / `withLockRetry` / idempotency guards). If `status === 'finished'`,
`throw failed-precondition` exactly as the pre-txn guard does. `withLockRetry` rethrows
non-contention errors immediately (verified: `assignNextTask.ts:245` `if (!contended) throw e`),
so the throw does not spin the retry loop. This closes the window the pre-txn guard only narrows.

Safety: the change adds ONLY a status branch immediately after the existing
`tx.get(runRef)`; it does not touch `heldSlot`, `skippedHeldTaskIds`, the idempotency
short-circuits, or the atomic `taskCounts` decrements.

### Tests (RED first)
A true TOCTOU interleave is not deterministically reproducible against the emulator (the
freeze must land in the sub-millisecond window between two awaits). Best deterministic proxy
(extend an existing lifecycle/finalize e2e scenario): after `finalizeRun`, a `completeTask`
on a still-open task is rejected with `failed-precondition` — proving the choke point rejects
post-finalize grading at BOTH the pre-txn and in-txn guards. The in-txn guard is what closes
the race; the assertion confirms the rejection contract holds. Honest scope note recorded: the
test exercises the guard, not the exact interleave.

---

## LOW / deferred (consciously NOT fixed this pass — recorded per work order)
- **#3** `sendRunSummaryEmailOnce` in `onRunFinalized` not gated on `run.isTestDrive` — a
  test-drive finalize emails the owner. Lives in `functions/src/index.ts` (out of my
  ownership this pass). Deferred.
- **#4** post-finalize `adjustTeamScore` / `claimDiscoveryPoi` not `run.status`-guarded —
  a post-finalize adjustment writes the team doc but the frozen auto-board doesn't reflect it
  (manual `refreshLeaderboard` recovers). `adjustTeamScore` is in `functions/src/index.ts`
  (out of ownership). The `claimDiscoveryPoi` half could be guarded but is an operator edge
  case; deferred to keep this pass tightly scoped to the ranking-channel fix.
- **#5** `time_only` emits phantom completion-bonus points in `score` (the `time_only` sort
  ignores `score`, so cosmetic only). Deferred.

---

## Ownership / gates
Files touched: `functions/src/runs/index.ts`, `functions/src/runs/buildRankings.test.ts`,
`scripts/e2e-verify.mjs`. Gates: `npm run shared:build && npm run build --workspace=functions`,
then `npm test` (vitest) and the emulator e2e via `scripts/emulator-exec.mjs`.
