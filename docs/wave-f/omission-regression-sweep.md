# Omission Regression Sweep (commit 0b6a0bb)

Scope: every consumer that assumed a non-assigned / hidden / locked task is present in
the participant payload, or that reads `TaskRecommendation.title` / a task's
`title`/`description`/`choices`/`steps` that can now be `undefined`.
`TaskRunner.allRemainingLocked` (:92) is excluded — owned by the P0 fix agent.

## Headline
Client-side omission migration (PlayScreen/TaskRunner/NavMap) is mostly robust — counts
and progress read the **team records** (`team.stages[].tasks`), not the content list.
Real exposure is concentrated in **(1) a pre-existing live-feed title leak that reopens
the hidden-task secrecy class, and (2) positional `activeStageTasks[0]` reads in
`e2e-verify.mjs` that can silently false-pass.**

## SECURITY / leak-reopened (top priority)

| # | File:line | Assumes | Concrete failure | Severity | Proposed fix |
|---|-----------|---------|------------------|----------|--------------|
| S1 | `functions/src/index.ts:995-1002` (submitStationPhoto autoApprove) and `:1080-1087` (reviewStationSubmission approve) | A completed photo task's `task.title` is safe to broadcast to the whole run's photo feed | For a **hidden-location** photo task, the moment the first team arrives + submits, `writeFeedItem({ taskTitle })` broadcasts the secret title into the run-wide live feed. Every team **still hunting that spot** sees its title — content wave-D withholds from `activeStageTasks` / `buildRecommendations`. | leak-reopened | Before writing the feed item, look up the game task; if `task.hideLocation`, suppress or replace `taskTitle` with a generic label. Same guard at both feed-write sites. |

S1 is **pre-existing** (the commit hardened the poll payload only) but defeats the same
guarantee. `hideLocation` is orthogonal to task `type`, so hidden photo/station tasks exist.

Checked and **clear** (no leak): `getRunRecap`/`composeRunSummary`/ceremony are post-run
(secrecy moot); `getSurveyResults` is owner/staff-gated. Discovery POIs use their own
`locationLeak.ts`.

## Confirmed correct-by-omission (no action — do not "fix" backwards)

| File:line | Why it's fine now |
|-----------|-------------------|
| `PlayScreen.tsx:407-423` (NavMap `targets`) | Joins team records to `activeStageTasks` for coords; omitted task → `content===undefined` → filtered out. Only the assigned/revealed task gets a pin — intended gating. |
| `PlayScreen.tsx:830-862` (`LockedTasksList`) | Deliberately empty now; `.find(...)?.title` guarded by `.filter(!!n)`; no throw. |
| `PlayScreen.tsx:355` (`pendingArrivalRef`) | Optional-chained; safe. |
| `TaskRunner.tsx:428-432` ("stop X of Y") | Reads `stage.tasks` (team records) — count correct. |
| `PlayScreen.tsx:440` `<Progress>` | Stage-level from `team.stages` — correct. |
| `NavMap.tsx` | `title` defaulted upstream (`content?.title ?? 'Task'`). No throw. |
| `calls.ts:83-89` `SafeTask` | Already types `title?`/`type?` optional. |

## P2 — tests/sims that can false-pass (needs runtime check)

| # | File:line | Assumes | Fix |
|---|-----------|---------|-----|
| T1 | `scripts/e2e-verify.mjs:541` (`activeStageTasks[0]`) | index 0 = assigned | `.find(t=>t.id===CODE_TASK_ID)` |
| T2 | `e2e-verify.mjs:578` | `[0].id===CODE_TASK_ID` (viewer) | `.find(id===)` |
| T3 | `e2e-verify.mjs:1231` (`[0]`) | index 0 = hint task | `.find(id==='h-1')` |
| T4 | `e2e-verify.mjs:2213` (`[0]`) | index 0 = quiz q1 | `.find(id==='q1')` |
| T5 | `e2e-verify.mjs:2248` (`[0]`) | index 0 = sequence task | `.find(id===seqId)` |
| T6 | `e2e-verify.mjs:2293` (`[0]`) | index 0 = presence task | `.find(id===)` |
| T7 | `scripts/simulate-browser-run.mjs:287-297` | Every card exposes `data-task-type` + `photo-url` | Sealed hidden card has `data-task-sealed="true"`, no `data-task-type`; `photo-url` testid is stale (camera-capture only). Add a sealed-card branch driving `task-check-arrival`; fix the stale selector. (photo-url staleness predates 0b6a0bb.) |

Remaining `e2e-verify.mjs` task reads already use `.find(id===)` or intentional
absence/`.length===0` assertions — omission-correct.

## Server payload builders — verified safe on new optional fields
- `buildRecommendations` (`assignNextTask.ts:200-218`) emits `locationHidden:true` instead
  of `title` for hidden tasks; never sorts/uppercases `title`. In-app consumers of
  `getRecommendedTasks` don't render `.title` unguarded.
- `sanitizeTaskForParticipant` sealed stub (`sanitizeTask.ts:40-56`) built by construction,
  fails closed — correct.

## Action order
1. **S1 (leak):** guard both `writeFeedItem` sites against `task.hideLocation`. → assigned to a fix agent.
2. **T1–T6:** convert the six positional `activeStageTasks[0]` reads to `.find(id===)`. → held; apply after P0 frees e2e-verify.mjs.
3. **T7:** teach the browser sim about sealed cards + fix the stale `photo-url` selector. → held; needs emulator.
