## Why

Field report 2026-09-25: *"there is no button that returns them to a stage or returns them to a
mission"*.

Confirmed missing (2026-09-25):
- Nothing reopens a mission that is `skipped` or `completed`. `forceAssignTask`
  (`functions/src/runs/index.ts:2033`) refuses both ("That mission is already completed or
  skipped"), refuses any stage other than the active one, and exists only in the staff app
  (`apps/play-web/src/screens/StaffConsole.tsx`), not in the organizer's console.
- Nothing reactivates a completed stage.
- `approval-can-be-undone` deliberately left this out (its design D5: "Putting a team back onto a
  mission they have walked away from is a separate, riskier act") and its open task 8.1 asks
  exactly this question.

Real cases that need it: the skip bug fixed by `skip-keeps-the-stage` already hit a team on
2026-09-22 (its whole stage 1 is `skipped`, and only a rewind can give it back); an organizer who
skipped the wrong team; a mission approved by mistake that should be redone; a stop that reopened
after being closed.

## What Changes

- **A "send back" button on every team row** of the Run Console (Ahiya, 2026-09-25: *"I have no
  button at all to send a team back, make sure there is one"*), in the staff app's team actions, and
  later on the team page. It opens a picker of the team's stages and missions, each marked done,
  skipped or current, and a preview of what will happen.
- An organizer (or permitted staff) can **return a team to a mission**: any
  skipped or completed mission of the active stage or of an earlier stage. The mission becomes the
  team's current mission (station capacity permitting, otherwise next in line).
- An organizer can **return a team to a stage**: reopen a completed stage. The team plays that stage
  again from where it stands (completed missions stay completed unless explicitly reopened; skipped
  ones become playable), and later stages wait until it completes again, keeping what the team
  already achieved there.
- Points follow the truth: a reopened mission's award (points or skip consolation) is removed, and
  it is earned again when the mission is completed again. The ledger records it.
- A finished team can be returned (it becomes active again) while the run is live. A finalized run
  cannot be changed.
- The team is told, in the app, which mission or stage it was sent back to.

## Non-goals

- Undoing time: the team's clock keeps running across the rewind (it is real play time).
- Reopening a run after `finalizeRun`.
- Batch rewinds across teams.

## Surfaces

- **New callable** `returnTeamTo` in `functions/src/runs/index.ts` + re-export + typed wrappers in
  creator-web and play-web `services/calls.ts`; declared in `PRIVILEGED_CALLABLES`
  (`scripts/lib/callableHardening.mjs`) with an audit write; rate-limit entry.
- shared: pure planner `packages/shared/src/teamRewind.ts`.
- creator-web: a `sendBack` entry in the team row's actions (`lib/runConsoleActions.ts`
  `TEAM_ROW_OVERFLOW`, promoted inline for a team whose last stage was skipped) + a picker dialog;
  later the team page timeline. play-web staff console: the same picker in the team actions (gated by
  `route` once `staff-capabilities` lands).
- play-web participant: the existing targeted announcement shows the notice.
