## Context (verified 2026-09-28)

- `forceAssignTask` (`functions/src/runs/index.ts`) claims a chosen task through
  `claimSpecificTask` (`functions/src/routing/assignNextTask.ts`), which checks, in order: already
  satisfied → refuse; `isTaskAssignable` (run pause/close) → refuse, **never overridable**; then,
  only when `override` is false: `isReleased`, `isExpired`, `isUnlocked`; then station capacity
  (never overridable). It refuses any stage other than the active one and any record that is
  `completed`/`skipped`/`assigned`. On success it displaces the in-flight task back to
  `unassigned`, writes an audit record and a targeted `forceAssign` notice.
- `completeTaskForTeam` finds the record in ANY stage but throws "This stage is not active yet"
  when the record's stage is not `active`.
- `assignNextInActiveStage` is the single choke point every assignment passes through
  (`requestNextTask`, `startTeams`, completion's reassign, the poll sweep).
- Prerequisites are `Task.unlockAfterTaskIds` (AND), evaluated by `isUnlocked(task, satisfiedIds)`
  over `gateSatisfiedTaskIds(team.stages)` (`packages/shared/src/gating.ts`).
- `returnTeamTo` (`send-team-back`) already moves a team back to completed/skipped work.

## Decisions

### D1: blockers are a computed list, not a flag

Pure `routeBlockers({ game, team, run, taskId, nowMs })` in `packages/shared/src/routeBlockers.ts`
returns `{ waivable: Blocker[]; hard: Blocker[] }` where

- waivable: `notReleased` (with the release instant), `expired`, `prerequisites` (with the exact
  missing task ids, and ONLY the missing ones), `stationFull` (count/cap), `otherStage` (stage id);
- hard (never waived here): `missionClosed` (run pause/close), `alreadyDone` (completed/skipped:
  point to "send back"), `alreadyCurrent`, `teamHeld`, `teamRemoved`, `runFinished`, `unknownTask`.

Total, never throws; every input malformed ⇒ `unknownTask`. The same function feeds the picker
(client) and the claim (server), so what the organizer confirms is what the server checks.

### D2: the claim waives exactly what was accepted

`forceAssignTask({ …, taskId, accept?: BlockerKind[], when?: 'now' | 'after', override? })`:
1. Server recomputes `routeBlockers`. Any `hard` ⇒ refuse with that code.
2. If a computed waivable kind is NOT in `accept` ⇒ refuse `failed-precondition` with details
   `{ blockers }` (the list changed since the preview). `override: true` (staff app, today's
   behaviour) = accept every waivable kind.
3. `claimSpecificTask` takes `waive: Set<BlockerKind>` instead of `override`, skipping only those
   checks; `stationFull` waived = increment past the cap, recorded.
4. Nothing is written to the template or to any other team; the waiver is recorded on the audit
   entry (`waived: [...]`) and on the task record (`routedByOperator: { at, waived }`).

### D3: another stage is a VISIT

The record in stage S′ becomes `assigned` with `routedByOperator`; the team's active stage stays S.
`completeTaskForTeam` accepts completion of a record whose stage is not active **iff** it carries
`routedByOperator`; it scores normally (buildRankings sums every record, so live/final parity
holds) and does NOT evaluate S′'s completion. When S′ later becomes active, its completion is
evaluated on activation (the rule `send-team-back` D2 already requires), so a visited mission that
satisfies S′ completes it then. After the visit the team is routed in S as usual. Chosen over
"move the active stage" because it never leaves an earlier stage stranded.

### D4: "after this mission" is a queue of one

`when: 'after'` stores `team.queuedRoute = { taskId, waived, at, by }` (replacing any earlier
queue) and claims nothing now. `assignNextInActiveStage` consumes it first: recompute blockers; if
the accepted set still covers them, claim it with that waiver; otherwise drop it, audit
`route_queue_dropped` with the reason, and route normally. A queued route never survives the run.
`when: 'now'` is today's displacement (the in-flight record → `unassigned`, not skipped).

### D5: surfaces

- creator-web: `routeTeam` action (team row overflow + team page) opens `RoutePicker`: stages →
  missions with state; selecting one shows the waivable list as checked items that must all be
  confirmed, the hard list as reasons, and Now / After this mission when the team holds a mission.
- play-web staff console: same picker data (`routeBlockers`), same callable.
- The team's notice names the mission; for `after`, the notice is written when it is assigned.

## Test strategy

- **Pure** `scripts/test-route-blockers.ts`: the X/Y example (X done, Y not ⇒ `prerequisites:[Y]`
  only); release/expiry; station full; other stage; each hard blocker; malformed input total; the
  list is stable-ordered.
- **e2e** scenario "route team": (a) same stage, waive a prerequisite: the team gets the mission, a
  third mission gated on the SAME prerequisite stays locked for it; (b) refuse when `accept` omits a
  computed blocker; (c) cross-stage visit completes and scores, active stage unchanged, a later
  activation of that stage counts it; (d) `after`: team completes its current mission and is handed
  the queued one; (e) `override: true` still works (staff app); (f) closed mission refused.
  Authz matrix unchanged (existing `route` capability).
- **UI** preview: picker from the console for a mid-mission team, both Now and After;
  `npm run i18n:check:strict`.
