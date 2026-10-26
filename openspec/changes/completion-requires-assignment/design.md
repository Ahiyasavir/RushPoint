## Context

A mission is "held" when its team record is `assigned` or it is the team's `activeTaskId`. Every
assignment path writes both together: routing's claim (`assignNextInActiveStage`),
`forceAssignTask`, `applyRoute` (route-team-to-mission, including a queued route) and
`returnTeamTo`. There is no mode in which a player chooses their own mission (no free-choice
routing; `getRecommendedTasks` only ranks, and `checkOutTask` only releases).

Legitimate completions that are not the team's own pick were checked one by one:

| Path | Holds the mission? | Outcome |
|---|---|---|
| Routing / force-assign / route-team-to-mission (incl. another stage) | yes, `assigned` | allowed |
| `markTeamArrived` (let them in) | latches arrival on the held mission | allowed |
| Geofence auto check-in, every trigger mode | client sends the held mission | allowed |
| "Everyone does their part" | `contributeToTask` does not complete; the controller completes the held mission | allowed |
| Sequence steps | the held mission | allowed |
| Photo waiting for review | the team stays on it until reviewed | allowed |
| Staff review approving after the team was routed elsewhere | staff path | allowed (`allowUnheld`) |
| Flash missions | separate flow, never `completeTaskForTeam` | unaffected |
| Test drive / test mode | ordinary assignment | allowed |
| Duplicate / retry after success, auto-skipped sibling | record terminal | idempotent no-op, as before |

## Decisions

**D1. The rule is total for participant doors.** No mode lets a player pick a mission, so there is
nothing to carve out. A terminal record passes so a replay stays the no-op it always was.

**D2. Check early AND in the transaction.** The early check (`assertTeamHoldsTask`, right after the
stage check in each door) stops grading, attempts, step writes and submission rows for an unheld
mission, so a wrong vs right answer cannot be told apart. The in-transaction check in
`completeTaskForTeam` closes the window between the early read and the commit (a mission released
by `checkOutTask` or re-routed by staff in between).

**D3. Default-on, staff opt-out.** `completeTaskForTeam` refuses unless `extras.allowUnheld`. A new
participant door therefore cannot forget the rule; only `reviewStationSubmission` opts out, because
the photo was submitted while held and approving it later is an organizer decision.

**D4. Stage first in `completeTask`.** It now calls `assertStageActiveForTask` before the holding
check, like the other four doors, so a locked-stage refusal still names the stage.

## Test strategy

- RED in `scripts/e2e-verify.mjs`, scenario "completion requires holding the mission": five cap-1
  located instant missions, six teams, the team left holding nothing tries every door. All five
  accepted it before the fix (500 points scored); after it each is refused with nothing written and
  the holders still finish.
- Pure: `functions/src/runs/teamHoldsTask.test.ts`.
- Existing scenarios that relied on completing unhanded missions now hand them over first, as an
  organizer would; two assertions that encoded the old behaviour are inverted on purpose
  (cross-team completion is refused, a hand-crafted answer to a non-assigned task is refused).

## Risks

A phone that submits a mission at the moment staff re-routed its team now gets a refusal instead of
silently scoring the old mission; its next poll shows the new mission.
