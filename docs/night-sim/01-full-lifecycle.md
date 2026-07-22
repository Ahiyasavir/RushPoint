# Night-sim #01 — Full-lifecycle classic race (callable API)

**Date:** 2026-07-16 (night shift) · **Agent:** night-simulation #01 ·
**Target:** the 24/7 shared local emulator (Functions :5001, Firestore :8080, Auth :9099) — **other night sims ran concurrently against the same emulator throughout**, which matters for every perf number below.
**Harness:** throwaway script in the session scratchpad (`night-sim-01.mjs`), modeled on `scripts/simulate-run.mjs` + `scripts/e2e-verify.mjs`; final audit reuses the shared oracle `scripts/lib/run-audit.mjs` verbatim.

## What ran

- **Creator:** fresh email/password Auth-emulator user (`nightsim01-*@example.com`) — not the seeded demo creator.
- **Game:** "Night Sim 01 — Classic Race" — 3 stages, **10 tasks covering every type**:
  - Stage 1 (**partial: requiredTaskCount 3 of 4**): quiz (multiple-choice, **paid hint** 20 pts), numeric (±1 tolerance), field check-in (radius, **maxConcurrentTeams 2**), self_report — quiz/numeric/self_report all **locationless**.
  - Stage 2: smart_station (secretCode `LANTERN`), photo **autoApprove**, photo **staff-review**, typed-answer quiz.
  - Stage 3 (final): geofence (60 m, server-validated GPS), sequence (3 steps: answer / tap-confirm / answer).
- **6 anonymous teams** played concurrently at different paces with scripted behaviors: wrong-then-right answers (quiz, numeric, sequence step 3, station code), Team 2 requested the paid hint **twice**, Team 5 went **idle 20 s mid-race**, Team 6 submitted a **duplicate completeTask**, Team 1 attempted the geofence from **556 m away**, Team 4 used `getRecommendedTasks` + `checkOutTask` (released a held slot, re-requested), creator ran `skipStage` on Team 3's stage 2 and approved 5 staff-review photos mid-race, plus 3 mid-race `refreshLeaderboard` calls.
- **21 distinct callables exercised:** createGame, updateGame, getGame, launchRun, joinRun, startTeams, getMyTeamState (~90×), requestNextTask, submitTaskAnswer, submitSequenceStep, completeTask, submitStationPhoto, verifyStationCode, reviewStationSubmission, requestTaskHint, getRecommendedTasks, checkOutTask, skipStage, listRunTeams, refreshLeaderboard, finalizeRun.
- **4 full end-to-end runs** total (runs 1–3 flushed out harness bugs on my side; run 4 was fully clean, exit 0, ~47 s wall, ~230 callable invocations).

**Result: all 34 audits green on the final run.** Every team finished; sanitizer leaked no secrets (`answers`/`numericAnswer`/`hint`/`secretCode` absent, `hasHint:true` + cost exposed); hint text revealed with `penalty:20` once and `alreadyUsed:true, penalty:0` on the repeat; hint charged exactly once (`bonusPenalty == 20`); duplicate completion did not double-score (score conservation Σ earnedScore == team.score held for all 6); geofence far-attempt rejected ("Too far from the spot (556m away)"); wrong station code rejected ("Incorrect code"); partial stage completed exactly 3 + auto-skipped 1 for every team; live & final leaderboards each had one entry per team, contiguous ranks, finite non-increasing scores, and **live/final ordering parity**; **all station counters back to 0, none negative** (no slot leaks despite checkOutTask + skipStage + duplicate paths).

## Defects found

**No product defects with invariant-level evidence were found.** Every server-side invariant I could attack held across all 4 runs (~700 callable invocations total, 0 transient `functions/internal` errors). Items below are evidenced observations short of defects:

1. **[P2] Duplicate `completeTask` is silently indistinguishable from a first completion.**
   Evidence (run 4, Team 6, task `t-geo`): first call → `{"ok":true,"nextTaskId":null}`, immediate duplicate → `{"ok":true,"nextTaskId":null}`. Expected: some `already:true` marker (other idempotent paths, e.g. feedback submit and requestTaskHint, do return one). Actual: identical payloads. Score was NOT double-awarded (conservation audit green), so this is observability only — a client/debugger cannot tell a no-op replay from a real completion.

2. **[P2] In a partial-completion stage, physical stations can be systematically starved by locationless tasks.**
   Evidence: in **all 4 runs × 6 teams = 24 team-stage traversals**, not one team was ever routed to `t-field` (the only stage-1 task with real coordinates, cap 2); every team completed the 3 locationless tasks and `t-field` auto-skipped (final states: `done=3 skipped=1`, `completeTask` call counts contain zero `t-field` completions). This is coherent with the routing formula (locationless ⇒ transit 0, so it dominates), but a creator who builds "3 of 4, one of them my flagship physical station" will find nobody visits the station. Not a crash — a design footgun.

3. **[P2] `listRunTeams` gives the organizer no signal that a photo review is pending.**
   Evidence: run 1 stalled precisely because the summary payload (`functions/src/runs/index.ts` ~1922–1941: id, displayName, status, score, bonusPenalty, completedStages, activeStageOrder, finished, launched, timestamps) carries neither `taskSubmissions` nor any pending-review count. All 6 teams sat blocked on `t-photo-rev` for 80 turns while polling `listRunTeams` showed nothing actionable. The creator-web console evidently compensates by reading team docs directly (owner read allowed by rules), but any consumer of the callable (staff tooling, future API) is blind to pending reviews.

Not re-flagged (known/by-design per memory + e2e): completeTask ignoring payload teamId, hint text present in the idempotent second response (charged 0), geofence error revealing distance on a non-hidden task.

## Software improvement suggestions

1. **Return `already: true` from `completeTask`/`submitStationPhoto` no-op replays** (functions/src/runs — the `status === 'completed'` short-circuit). One field; makes idempotence observable to clients, sims, and support.
2. **Add `pendingReviews: number` (count of `taskSubmissions` with `status:'pending'`) to the `listRunTeams` summary** so organizer surfaces can badge "N photos waiting" without N extra doc reads.
3. **Routing: consider a small transit floor or a load-aware bonus for located tasks in partial stages** (routing/assignNextTask.ts), or at least a Builder warning when a partial stage mixes locationless with located tasks ("locationless tasks will be chosen first"). Evidence in #2 above: 24/24 traversals skipped the physical station.
4. **Latency tail on scoring completions** (see perf): `submitTaskAnswer`/`completeTask` p95 hit 3–7.5 s even in the clean run while non-scoring callables stayed <300 ms. The scoring hot path (leaderboard auto-refresh + benchmark writes) is the plausible driver — worth a targeted profile; on a phone in the field a 7 s "submit answer" feels broken and invites double-taps (mitigated today by idempotence, but see #1).

## Perf notes (emulator, under concurrent night-sim load — NOT production numbers)

Clean run (run 4, moderate shared load), per-callable ms:

| callable | n | p50 | p95 | max |
|---|---|---|---|---|
| getMyTeamState | 87 | 87 | 113 | 151 |
| submitTaskAnswer | 25 | 246 | 7299 | 7552 |
| submitSequenceStep | 24 | 78 | 243 | 264 |
| requestNextTask | 16 | 161 | 188 | 188 |
| completeTask | 14 | 261 | 6477 | 6477 |
| submitStationPhoto | 10 | 177 | 213 | 213 |
| verifyStationCode | 6 | 155 | 166 | 166 |
| refreshLeaderboard | 3 | 571 | 628 | 628 |
| finalizeRun | 1 | 1006 | — | 1006 |

- Read paths are consistently fast (getMyTeamState p95 113 ms across ~90 calls). The slow tail is confined to **scoring completions** (submitTaskAnswer/completeTask), and it appeared in every run, so it is not purely a load artifact — though run 1, under the heaviest concurrent load of the night, degraded much further (completeTask p50 **9.7 s**, submitStationPhoto max 9.5 s, createGame 7.2 s), which shows the same path is also the most load-sensitive.
- Zero transient `functions/internal` errors in ~700 invocations across all 4 runs — the emulator stack under multi-agent load was error-clean, just slow in the tail.
- Housekeeping note for the supervisor: my shell's stdout occasionally received interleaved output from a sibling night-sim's browser scenario (its banner + findings appeared inside my redirected log file). Harmless to my results (verified my own lines separately) but worth knowing when reading raw night logs.
