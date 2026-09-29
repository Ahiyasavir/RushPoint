## Context (verified 2026-09-28)

- `startTeams({ gameId, runId, teamIds? })` (`functions/src/runs/index.ts`) already launches only
  the listed teams, applying the consent and members-offline holds, and returns
  `{ launched, heldForConsent, heldForMembers }`. Used four times by hand in production on
  2026-09-27 for exactly this.
- `setTeamHold` (same file, change `staff-console-field-ops`) sets `RunTeam.held/heldAt/heldReason/
  heldBy`, accumulates `heldMs` (excluded from the race clock by `buildRankings`), is audited and
  capability-gated (`hold`). `assertTeamNotHeld` guards 12 progress paths (10 in `runs/index.ts`,
  `verifyStationCode` and `submitStationPhoto` in `index.ts`). `triggerSOS` is NOT gated, on purpose.
  Only `apps/play-web/src/screens/StaffConsole.tsx` calls it.
- The console team row actions are data: `TEAM_ROW_OVERFLOW` in
  `apps/creator-web/src/lib/runConsoleActions.ts` (`skipTask`, `skipStage`, `sendBack`,
  `adjustTeamScore`), with severity + `CONSEQUENCE` records.
- `LiveTeamMap.tsx` draws one marker per team with a name popup; it receives `teams` but no click
  handler. `TeamPage.tsx` is the team dossier (change `team-dossier-and-search`).
- `sanitizeTeamForParticipant` (`packages/shared/src/testMode.ts`) is an allow-list; `held*` are on it.
- Late-join auto-start happens inside `joinRun` for a NEW team only (`lateJoinerVerdict`); a device of
  an existing team re-joining returns `already` and starts nothing.

## Decisions

### D1: start one team is UI only

The team row gets an inline **Start** action while `launched !== true` (it outranks the overflow
the same way `clearTeamOutOfBounds` does, because it is the one thing that team is waiting for), and
the team page gets the same button. It calls the existing `startTeams` with `teamIds: [id]` and maps
the result: `launched 1` ⇒ "started"; `heldForConsent 1` ⇒ "waiting for a guardian's consent";
`heldForMembers 1` ⇒ "waiting for all members to join on a phone". No confirm: starting is the
routine action of the run and is reversible by pause.

### D2: pause is UI only

`holdTeam` / `resumeTeam` action ids calling the existing `setTeamHold`. Row badge "בהשהיה" while
`held`. The console already streams team docs, so no new read. Confirm with an optional reason
(shown to the team, as the staff app already does).

### D3: remove is a STATE, one new callable

`setTeamRemoved({ ownerUid?, gameId, runId, teamId, removed: boolean, reason? })`:
- Authorization: owner or platform admin only (`assertOwnerOrAdmin`-style; NOT in
  `STAFF_CAPABILITY_BY_CALLABLE`), rate-limited, audited (`team_removed` / `team_restored`),
  refused on a finished run.
- Writes `removed: true, removedAt, removedBy (uid), removedReason` (or clears them on restore),
  in a transaction that also, on removal, moves an `assigned` record back to `unassigned`,
  clears `activeTaskId` and releases that station slot after the commit (the station-slot-leak
  lesson: a removed team must not hold capacity).
- Restoring puts the team back exactly as it was otherwise; its next poll routes it on.
- Idempotent: removing a removed team is a no-op success.

### D4: one gate for "may this team advance"

Rename `assertTeamNotHeld` → `assertTeamMayAdvance` and have it refuse `removed` first
(`failed-precondition`, stable code `TEAM_REMOVED`), then `held` (`TEAM_HELD`, unchanged). All 12
call sites move with the rename, so no progress path can be missed. SOS stays ungated (a removed
team is still people outside). `getMyTeamState` stays readable, so the phone can explain.

### D5: removed teams are out of every standing

`buildRankings` filters `removed === true` before ranking, so live (`refreshLeaderboard`,
`maybeRefreshLeaderboardSnapshot`) and final (`finalizeRun`) cannot diverge. `startTeams` skips
removed teams in its selection. `listRunTeams` returns `removed` so the console can filter. The
run recap/report shows them under "removed", not ranked. Removing or restoring forces a
leaderboard refresh.

### D6: participant payload

Allow-list `removed` and `removedReason` in `sanitizeTeamForParticipant` (never `removedBy`). The
play-web screen for a removed team: "המארגנים הוציאו את הקבוצה מהמשחק", the reason if any, the SOS
button and the organizer contacts, nothing else. `describeCallFailure` maps `TEAM_REMOVED` like
`TEAM_HELD` (non-retryable).

### D7: map → team page

`LiveTeamMap` gets `onTeamClick(teamId)`; the marker element opens the team page instead of (not in
addition to) the popup. The marker keeps its `title` for hover.

## Test strategy

- **Pure** (`scripts/test-team-lifecycle.ts`): `teamRowActions` offers `startTeam` inline for an
  unlaunched team, `holdTeam`/`resumeTeam` by state, `removeTeam`/`restoreTeam` by state; a new
  pure `rankableTeams(teams)` drops removed teams (and nothing else); `assertTeamMayAdvance`
  precedence (removed before held). Every new action id has a `CONSEQUENCE` and i18n copy
  (existing guards).
- **e2e** (`scripts/e2e-verify.mjs`, new scenario "team lifecycle"): start one of two registered
  teams via `startTeams({teamIds})` ⇒ only it launched; remove the other launched team ⇒ its
  `submitTaskAnswer` and `requestNextTask` fail `TEAM_REMOVED`, `triggerSOS` still succeeds,
  `refreshLeaderboard` omits it, `startTeams()` (all) does not launch it, its station slot count
  returned to what it was; restore ⇒ it can play and is ranked again. Authz matrix row:
  participant / stranger / other-run staff / THIS run's staff all denied `setTeamRemoved`.
  Callable coverage guard then covers the new callable.
- **Hardening**: add `setTeamRemoved` to `PRIVILEGED_CALLABLES` (auth marker + audit),
  rate-limit bucket in `packages/shared/src/rateLimit.ts`.
- **UI** (preview): start one team from the row; pause/resume shows the badge and the phone shows
  the paused state; remove hides the row behind "הוסרו (1)" and the phone shows the removed
  screen; bring back; click a team on the live map opens its page. `npm run i18n:check:strict`.
