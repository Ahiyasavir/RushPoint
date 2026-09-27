## Context (verified 2026-09-25)

- Stage completion is evaluated ONLY when a task of that stage completes or is skipped
  (`applyStageCompletion`, `functions/src/runs/helpers.ts:31`). Activating a stage does not evaluate
  it. A rewind that re-activates a later stage whose requirement is ALREADY met would leave the team
  in a stage with nothing to do. **The planner must evaluate completion on every (re)activation.**
- A stage's `earnedScore` is recomputed from its task records only when it completes (`helpers.ts:93`).
- Next-stage unlock honours scheduled release (`isReleased`), so a rewound team can meet a gate again.
- Station capacity is claimed in a transaction (`forceAssignTask`/`assignTask` shape).
- Team notices go through run `announcements` targeted at one team (`forceAssignTask` notice write).
- Score changes must move `team.score` and the task record together (live/final parity rule in
  CLAUDE.md); the approval reversal planner (`packages/shared/src/approvalReversal.ts`) already
  clamps at zero.

## Decisions

### D1: one callable, two targets

`returnTeamTo({ ownerUid?, gameId, runId, teamId, target: { kind: 'task'; taskId } | { kind: 'stage'; stageId }, reason?, dryRun? })`.
Owner, admin, or staff with the `route` capability (`staff-capabilities`); until that lands,
`assertStaffOrOwner`. Refused on a finished (finalized) run, on a held team, on a stage later than
the team's current one, on a task already `assigned`/`unassigned`.

### D2: the plan is pure (`teamRewind.ts`)

`planTeamRewind({ stages, gameStages, target, now })` returns the new `stages` array, the score
delta, the ledger entries, the task to assign (or none), and the ids whose station slots must be
released. Rules:

Returning to a TASK in stage S:
1. If S is not the active stage: current active stage → `locked` (its records kept; an `assigned`
   record → `unassigned`, slot released); every stage after S that is `active` or `completed` →
   `locked`, records kept; S → `active`, `completedAt` cleared.
2. The target record → `unassigned` (then claimed as the current mission, D4), its `earnedScore`
   removed from `team.score` and from the stage total, `completedAt`/`actualMinutes`/`skipCause`
   cleared. `answerLog` is kept (history).
3. The team's stored `requiredTaskCount` for S is restored to the template value, bounded by
   `maxCompletableTasks` (a skip may have lowered it).
4. The team's `taskSubmissions[taskId]` is removed, so the mission starts clean.

Returning to a STAGE S: as above, with no single target: every `skipped` record in S with cause
`operator`, `stageSatisfied` or none becomes `unassigned` (consolations removed); `exclusive` and
`expired` stay skipped (those were the game's rules, not a decision to undo); completed records stay
completed.

After the rewrite: run `applyStageCompletion` on S immediately (a stage whose requirement is still met
by its completed records completes again and cascades) and on each subsequently activated stage.
A finished team becomes `status: 'active'`, `finishedAt` cleared.

### D3: points

The delta is minus the sum of the awards on the reopened records, clamped so `team.score` never goes
below zero (the approval-reversal rule). One ledger entry per reopened record (`kind: 'reversal'`,
`reason` = the operator's reason). Re-earned normally on completion.

### D4: assignment

For a task target: claim the station slot inside the transaction with the same capacity check as
`forceAssignTask`; if full, leave it `unassigned` and report `queued: true` so routing hands it out
when a slot frees. `activeTaskId` set accordingly.

### D5: tell the team

A targeted announcement: "The organizer sent you back to: <mission>" / "…to stage <n>", bilingual
through the existing announcement shape. The participant app needs no new code path.

### D6: preview

`dryRun: true` returns the plan summary (what reopens, the points that will be removed, whether a
later stage is re-locked) without writing. The team page's confirm shows it.

## Risks

- **Re-locking a later stage the team was halfway through.** Its completed records are kept, and the
  planner re-evaluates it on reactivation, so no work is lost; the preview states it.
- **Leaderboard jumps.** Expected and explained by the ledger; a forced leaderboard refresh after write.
- **Time-based scoring.** `fixed_points_speed`/`smart_weighted` durations come from stamped record
  times; a reopened record gets fresh stamps when replayed. No template re-read (parity rule).

## Test strategy

- Pure (`scripts/test-team-rewind.ts`): every row of D2 (same-stage task; earlier-stage task; whole
  stage with mixed skip causes; finished team; requirement restore; score clamp; cascade when the
  later stage is already satisfied; refusal cases). Purity (inputs untouched), totality.
- e2e (`scripts/e2e-verify.mjs`, scenario "send team back"): skip a mission then return to it → it is
  the team's current mission and the consolation is gone; complete stage 1, advance, return to stage
  1 → stage 1 active, stage 2 locked with its completed records intact, completing stage 1 again
  re-activates stage 2 and, if already satisfied, completes it; finished team returned → active;
  finalized run → refused; participant/stranger/other-run staff denied (authz matrix row); `dryRun`
  writes nothing; the callable coverage guard sees it.
- `scripts/test-callable-hardening.ts` green (auth marker + audit write declared).
- UI via preview: from the team page timeline, return to a skipped mission; the player tab shows the notice.
