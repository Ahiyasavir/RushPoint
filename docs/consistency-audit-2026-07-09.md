# Cross-surface consistency audit — 2026-07-09

A 4-lane sweep (score / status / time / counts) of every place the same datum is shown on
multiple screens, looking for surfaces that can disagree for the same team/run at the same
moment. Trigger: a team showed 244 in the console but 744 on the TV.

## Fixed in this change (`live-leaderboard-auto-refresh` + score-consistency follow-up)

| # | Class | Bug | Fix |
|---|---|---|---|
| S1 | score | Console teams table showed `score − bonusPenalty` (a 3rd number) while the panel below it + TV showed the ranked score | Table now reads ranked score from `run.leaderboard.rankings` (single source of truth) — `RunConsolePage.tsx` |
| T1 | time | FinalScreen recomputed duration from raw timestamps → disagreed with TV/ceremony/recap when the board was frozen before a team finished | Uses `myEntry.durationSeconds` (server value) — `FinalScreen.tsx` |
| ST1 | status | Console showed "stage 1" for a team between stages (scheduled-release gap; `activeStageOrder == null → ?? 0 + 1`), contradicting "3 done" beside it | Explicit finished / waiting / between-stages / stage-N states, routed through i18n — `RunConsolePage.tsx` + `i18n.ts` |
| C3 | counts | Hint-cost aria-label used `?? 0` while the visible label + server used `?? 25` (screen-reader heard "0 points") | aria-label now `?? 25` — `TaskRunner.tsx` |

Guardrails: property test already asserts `buildRankings` returns exactly one entry per team;
added an e2e assertion that every `listRunTeams` team has a ranked leaderboard entry once scoring
begins (so the console table can never fall back to a different number than the board).

### Second pass (follow-up batch)

| # | Class | Bug | Fix |
|---|---|---|---|
| C5 | counts | Stage progress "N/M" used the team's snapshot numerator but the LIVE `game.stageCount` denominator → "4/5" forever (stage added post-join) or ">100%" (removed) | Denominator is now `team.stages.length` — numerator+denominator share one source — `PlayScreen.tsx`, `FinalScreen.tsx` |
| T2 | time | Public board "updated Ns ago" measured from the client fetch, so a throttled/stale snapshot always read "just now" | Measures from the server `data.updatedAt` — `PublicLeaderboardScreen.tsx` |

**C1 (participant count) — investigated, NOT a live bug.** No code path deletes a team doc
(`pruneRunNow` only strips PII), so `participantCount` (high-water) always equals live
`teams.length`. Changing the display would only create a NEW disagreement with the runs-overview
page + `listLiveRuns`, which read `participantCount`. Left as-is by design.

### Third pass (follow-up batch)

| # | Class | Bug | Fix |
|---|---|---|---|
| C2 | counts | Editing a PUBLISHED game never re-synced the gallery card — `publicGames.stageCount/taskCount/…` stayed at publish-time values while the Dashboard showed live | `updateGame` now best-effort refreshes the gallery **summary** doc when the game is public (never touches `playCount` or `publicTasks.copyCount`) — `functions/src/games/index.ts` |
| T3 | time | Public board rows omitted the completion time the TV/ceremony/recap show | Rows now render the time via a matching `fmtTime` — `PublicLeaderboardScreen.tsx` |

Guardrail: e2e now asserts that editing a published game re-syncs the gallery counts (no
republish) AND preserves the live `playCount`.

## Reported, NOT fixed (genuine product/copy decision, not a correctness bug)

- **C4 — "participants" actually counts teams.** `participantCount`/`maxParticipants` are team
  counters but labels say "participants/משתתפים". In SOLO mode participant == team, so it's
  correct there; only team-mode undercounts people. A correct fix is mode-aware wording
  (solo→"participants", team→"teams") across ~6 strings in both languages — a copy decision the
  owner should make, and the number itself is consistent across every surface.
- **T4 (LOW/cosmetic)** — organizer-side leaderboard timestamps render in the raw browser
  locale/timezone (`toLocaleTimeString()`); fine for a single organizer, not a cross-user value
  disagreement.

## Intentional (by design, not bugs)

- **Player in-run header shows the accumulated earned tally** (e.g. 194), not the ranked score.
  Decision: the ranked score includes a +500 completion bonus (only at finish) and a Z-score that
  moves with OTHER teams' times — a fluctuating number mid-run is worse UX for a player. FinalScreen
  switches to the ranked score at the end (correct). StaffConsole likewise shows the raw team score;
  if staff should match the organizer/TV, that's a follow-up (needs the run-doc leaderboard read +
  a rules check).
