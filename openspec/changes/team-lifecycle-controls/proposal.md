## Why

Field report 2026-09-27 (live run of "המירוץ לציון", `xtg1HP7T3A40YfPNxu4u`). The organizer had to
ask for four things the console could not do, and each had to be done by hand on the server:

- **Start one team** (four times): the console has only "start all teams". The server's
  `startTeams` has always accepted `teamIds`; no button sends it.
- **Pause a team** so it cannot continue: `setTeamHold` exists (change `staff-console-field-ops`),
  with a server gate, a stopped clock and an audit record, but only the staff app on a phone calls it.
- **Remove a team** so it does not play and is not in the standings (a test team, "אחיה - בודק"):
  nothing can do this. The only way was deleting the team document, which was refused.
- **Open a team from the live map**: clicking a team's name on the map shows a popup with the
  name, not the team page that already exists.

Comparable products put every team action in one place on the team (Goosechase: one ⋯ menu per
team, including "Remove team", which there is permanent). See `docs/field-report-2026-09-27.md`.

## What Changes

- The Run Console team row and the team page offer **Start this team** for a team that has not
  started. It starts exactly that team (same holds as "start all": guardian consent, members not
  on a phone), and says why when a team was held instead.
- The team row and the team page offer **Pause** / **Resume**, using the existing team hold. A
  paused team is marked in the list and on its page.
- The team row menu and the team page offer **Remove from the game** and, for a removed team,
  **Bring back**. A removed team:
  - cannot advance (every progress path refuses, like a held team), but can still send SOS;
  - is not in the live standings, the published board or the final standings;
  - is not started by "start all" or by auto-start of late joiners;
  - is hidden from the team list behind a "removed (N)" filter, and its data is kept;
  - sees, on its phones, a screen saying the organizers removed it from the game.
  Bringing it back reverses all of that. Nothing is deleted.
- Clicking a team on the console's live map opens that team's page.

## Capabilities

### New Capabilities
- `team-lifecycle`: start one team, pause/resume, remove/restore, open from the map.

## Non-goals

- Sending a team to a chosen mission (`route-team-to-mission`).
- Deleting a team or its data. Removal is a state, never a delete.
- Letting staff remove teams: removal is owner/admin only in this change.
- Excluding a team from auto-start of late joiners while keeping it in play (removal covers the
  observed case).

## Surfaces

- **Callable (new):** `setTeamRemoved` (+ typed wrapper in creator-web; audit; rate limit;
  hardening lists; e2e scenario + authz matrix row).
- **Callables (changed):** `startTeams` and late-join auto-start skip removed teams;
  `buildRankings` excludes them; `listRunTeams` returns the flag; `getMyTeamState` returns it.
- **Shared types:** `RunTeam.removed`, `removedAt`, `removedBy`, `removedReason`.
- **creator-web:** team row actions, team page actions, live map click, list filter, i18n.
- **play-web:** the removed screen, i18n.
