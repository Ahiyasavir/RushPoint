## Why

Scoring is deterministic effort-in/points-out; there is no luck, no surprise beat
between tasks, nothing to whoop about mid-run. Competitor apps ship power-ups as a
retention lever. RushPoint can add them without touching the scoring engine: award
selection is a deterministic server-side roll at task completion, and both award
effects reuse existing, invariant-audited mechanisms (`taskRec.earnedScore` for the
multiplier, `team.bonusPenalty` for flat bonuses — the exact channel
`adjustTeamScore` uses).

## What Changes

- A creator toggle **`Game.powerUpsEnabled`** (default **false** — existing games
  are untouched).
- On each task completion (`completeTaskForTeam`), the server rolls a
  **seeded-deterministic** chance — a pure hash of `runId:teamId:taskId` — with a
  ~25% award rate. Determinism means an idempotent replay of the same completion can
  never re-roll differently or double-award (and the existing
  "already-completed ⇒ return" guard means it never rolls twice at all).
- Two award types (hash-selected, 50/50):
  - **`double_points`** — the team's NEXT completed task earns ×2 points, applied at
    award time to that task's `earnedScore` (so `Σ earned == score` invariants keep
    holding), then the power-up clears.
  - **`bonus_points`** — +15 flat, applied by DECREMENTING `team.bonusPenalty`
    (bonusPenalty is subtracted from the final score; a bonus is a negative penalty —
    same sign convention as `adjustTeamScore` and zone-capture bonuses).
- The team doc gains a **`powerUps`** state: `{ active?: 'double_points', log: [...] }`
  — server-write-only like everything else on the team doc; one active slot (a
  second `double_points` rolled while one is armed converts to `bonus_points`).
- Power-ups never roll on `time_only` runs (there are no task points to double and
  the flat bonus would corrupt a pure-time ranking).
- Play-web: an **award toast** when a power-up lands and an **active chip** ("×2
  armed") next to the score while `double_points` is pending.

## Capabilities

### New Capabilities
- `power-ups`: the pure deterministic `rollPowerUp` predicate (shared, property-
  tested); award + consumption inside the existing `completeTaskForTeam`
  transaction; `Game.powerUpsEnabled`; `powerUps` team state surfaced through
  `getMyTeamState`; play-web toast + chip; Builder toggle.

## Non-goals

- No sabotage / attack power-ups against other teams (v1 is self-buffs only).
- No participant choice or inventory — awards apply automatically (bonus instantly,
  double arms automatically for the next completion).
- No new callable and no change to `buildRankings` — effects flow through the two
  existing audited channels (`earnedScore`, `bonusPenalty`).
- No power-ups on `time_only` scoring, on skipped tasks (`skipStage` awards nothing),
  or on flash-mission bonuses.
- No creator tuning of rate/values in v1 (constants: 25%, ×2, +15).

## Surfaces touched

- **shared:** `packages/shared/src/powerUps.ts` (`rollPowerUp`, `POWER_UP_RATE`,
  `POWER_UP_BONUS`, `PowerUpType`, hash); `Game.powerUpsEnabled?`; `RunTeam.powerUps?`.
- **functions:** `completeTaskForTeam` in `functions/src/runs/index.ts` (consume +
  roll INSIDE the existing transaction — no new transaction); `getMyTeamState`
  passthrough; `updateGame` accepts `powerUpsEnabled`. **No new callable.**
- **creator-web:** Builder settings toggle + i18n EN/HE.
- **play-web:** award toast + active chip in `PlayScreen` + i18n EN/HE.
- **Tests:** vitest property tests
  (`functions/src/__property__/powerUps.property.test.ts`) incl. pinned known
  vectors; a new `power-ups` e2e scenario that PREDICTS the awarding tasks from the
  deterministic roll and audits leaderboard invariants.
