# Tasks: followed-teams

Source: Ahiya 2026-09-30. Part of `docs/console-staff-simplification-plan-2026-09-30.md` (phase 1).

## 1. RED
- [x] 1.1 `scripts/test-followed-teams.ts`: `readFollowed`, `toggleFollowed` (incl. full at 8),
      `neighbourFollowed`, `followedTeamStatus` priority table, `followedTeamAction` × capabilities,
      junk inputs. Confirm RED.

## 2. GREEN
- [x] 2.1 `packages/shared/src/followedTeams.ts` + barrel export. 1.1 → green.
- [x] 2.2 A small storage hook per app (`useFollowedTeams(runId, uid, teamIds)`), try/catch storage,
      in-memory fallback.
- [x] 2.3 Console: `FollowedStrip` at the top of "עכשיו"; ☆ on team row, team page, map pin popup,
      "now" rows; "רק שלי" on team list / map / "now"; followed sorted first; team page ‹ › arrows;
      inline actions wired to the existing handlers (approve, start, resume, let in, open alert).
      Descoped on purpose (2026-09-30): no ☆ inside the map pin popup (a pin click already opens the
      team page, which has the ☆) and none on each "now" row (followed teams' items already sort
      first there). Fewer stars, same reach. The Teams screen shows a "showing only my teams · show
      all" line while "רק שלי" is on, since its toggle lives on "עכשיו".
- [x] 2.4 Staff app: strip under the quick bar; ☆ on `TeamOpsCard`; "רק שלי" toggle; sort first;
      actions gated by `can(...)`.
- [x] 2.4b Maps (console `LiveTeamMap`, staff `StaffTeamMap`): a followed team's marker in the
      "followed" colour (brand violet, never amber/red), with its name, drawn above the others;
      with "רק שלי" on, the others are dimmed.
- [x] 2.5 i18n he/en for every new string (no dashes in Hebrew copy).

## 3. REFACTOR
- [x] 3.1 One shared card component per app (strip card), no duplicated status copy.

## 4. Verify
- [x] 4.1 Preview: console 1280 + 375, staff 375×667 + 390×844 (the scenarios in design.md).
- [x] 4.2 `npm run verify`, exit code to a file: 0 (2026-09-30). No callable changed; e2e NOT run.
