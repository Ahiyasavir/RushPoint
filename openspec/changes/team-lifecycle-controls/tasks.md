# Tasks: team-lifecycle-controls

Source: `docs/field-report-2026-09-27.md` items 6-9.

## 1. RED

- [x] 1.1 `scripts/test-team-lifecycle.ts`: row actions by state (`startTeam` inline when not
      launched; `holdTeam`/`resumeTeam`; `removeTeam`/`restoreTeam`), `rankableTeams` drops only
      removed teams, `teamAdvanceRefusal` precedence (removed before held). Confirm RED.
- [x] 1.2 e2e scenario "team lifecycle" + authz matrix row for `setTeamRemoved` (design, test
      strategy). Confirm RED (unknown callable / removed team still advances).

## 2. GREEN

- [x] 2.1 Shared: `RunTeam.removed/removedAt/removedBy/removedReason`; pure `rankableTeams` and
      `teamAdvanceRefusal`; allow-list `removed`, `removedReason` in `sanitizeTeamForParticipant`.
- [x] 2.2 Functions: rename `assertTeamNotHeld` → `assertTeamMayAdvance` (12 call sites) reading
      `teamAdvanceRefusal`; `buildRankings` over `rankableTeams`; `startTeams` skips removed;
      `listRunTeams` returns `removed`.
- [x] 2.3 `setTeamRemoved` callable (D3): owner/admin, transaction, slot release, audit, forced
      leaderboard refresh, rate limit, hardening lists, re-export. 1.2 → green.
- [x] 2.4 creator-web: action ids + consequences + row/page buttons (start, pause/resume,
      remove/restore), "הוסרו (N)" filter, `LiveTeamMap` `onTeamClick` → team page, wrappers, i18n.
      1.1 → green.
- [x] 2.5 play-web: removed screen (SOS + contacts), `TEAM_REMOVED` in `describeCallFailure`, i18n.

## 3. Verify

- [x] 3.1 Preview: start one team, pause/resume, remove/bring back (console + phone), map click.
- [ ] 3.2 `npm run verify`, `npm run e2e` green, exit codes captured to a file.

## Progress (2026-09-28)

Implemented 2026-09-28. e2e 'team lifecycle' all PASS (incl. authz + coverage). Browser: per-team start, row menu, map click wiring. 3.2 (final gate run) pending at time of writing.
