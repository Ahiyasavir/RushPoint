## Why

Field report 2026-09-27 item 5. The organizer wants to click a team, pick any mission in the game,
and send the team there. If the team is in the middle of a mission he wants to choose: **skip it now
and go**, or **go there after finishing the current one**. And, stated twice with an example: only the
conditions that actually block THIS jump may be waived. If a mission opens after X and Y and the team
has done X, only "Y not done" is waived; nothing about X, and nothing about any other mission or
team, changes.

What exists (`forceAssignTask`, staff app only):
- only the team's ACTIVE stage; refuses missions in other stages;
- refuses a mission already completed or skipped (that is `returnTeamTo`, change `send-team-back`);
- `override: true` is **all or nothing**: one flag waives release time, expiry and prerequisites
  together (`claimSpecificTask`, `functions/src/routing/assignNextTask.ts`);
- only "now": no "after the current mission".
- not in the organizer's console at all.

Comparable tools make reassignment a direct act on the map or list (Onfleet: drag a driver onto a
task, "insert after the current task"). See `docs/field-report-2026-09-27.md`.

## What Changes

- From a team's row or page, **Send to a mission** opens a picker of every mission in the game,
  grouped by stage, each marked done / current / available / blocked.
- Picking a mission shows **exactly what stands in the way**, as a list: not released yet, expired,
  which prerequisite missions are missing (by name), station full, in another stage. The organizer
  confirms that list and only those items are waived, for this team, for this one assignment.
- If the team is on a mission: **Now** (the current mission goes back to available, not skipped) or
  **After this mission** (the chosen mission is queued and given to the team as soon as it finishes
  its current one, before normal routing).
- A mission in another stage is **visited**: the team does it and it counts, then returns to its own
  stage. The visited stage is not completed or skipped by the visit.
- Things that cannot be waived: a mission paused or closed for the run (resume it first), a mission
  the team already did (use "send back"), a paused or removed team.
- The server re-checks: if something new blocks the jump since the organizer looked, it refuses and
  the picker shows the new list.
- The team is told where it was sent. Everything is audited with the exact waived items.

## Capabilities

### New Capabilities
- `team-routing`: operator routing of a team to a chosen mission with per-blocker waivers.

## Non-goals

- Reopening completed/skipped missions (`send-team-back` already does).
- Changing the game template or any other team's routing.
- Batch routing of several teams at once.

## Surfaces

- **Shared (pure):** `routeBlockers()` (the blocker list), `RunTeam.queuedRoute`.
- **Callable (changed):** `forceAssignTask` gains `accept: BlockerKind[]` + `when: 'now' | 'after'`
  and cross-stage visits; `override: true` stays as "accept every waivable blocker" for the staff app.
  `completeTaskForTeam` accepts a visited record outside the active stage. Routing
  (`assignNextInActiveStage`) consumes `queuedRoute` first.
- **creator-web:** route picker (team row + page), wrapper, i18n. **play-web:** the staff picker
  uses the same blocker list; the team notice.
