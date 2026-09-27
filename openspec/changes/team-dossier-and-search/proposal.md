## Why

Field report 2026-09-25:
- *"In teams and scores I can't click a team and see everything about it. I want that: all its
  information, add points, see the photos and videos it submitted, see its location, send it a
  message, and so on."*
- *"I want to be able to search for a team in teams and scores if I have many teams."*

Today (`apps/creator-web/src/pages/RunConsolePage.tsx`, `case 'teams'`, ~line 1214): each team is a
static row (name, stage N, stages done, badges, score, one overflow menu). Nothing is clickable, and
there is no search, filter or sort. The information the organizer wants is spread over five panels
in three sections (photo review, media gallery, chat, live map, standings).

Researched 2026-09-25, and the reason this is cheap: **the console already holds nearly all of it.**
- A live listener on the WHOLE teams collection (`RunConsolePage.tsx:380`) receives every team
  document in full (stages, per-mission records with times, earned points, `answerLog`,
  `taskSubmissions` with media URLs and review state, devices, `registrationData`) and keeps only
  `displayName` + `taskSubmissions`.
- The run chat is already streamed (`:462`) and the team locations are already streamed by
  `LiveTeamMap` (`teamLocations`, owner-readable per `firestore.rules:156`).
- What is missing is WHY a score moved: `adjustTeamScore` writes the reason only to `auditLogs`,
  which clients cannot read (`firestore.rules:281`, and `listAuditLogs` is platform-admin only).

The staff app already has name search (`apps/play-web/src/lib/staffTeamFilter.ts`); the organizer's
console never got it.

## What Changes

- Every team row opens a **team page** (a side drawer on desktop, a full-screen sheet on phones),
  addressable as `?team=<id>` so it survives a refresh and can be shared with a co-organizer.
- The team page shows, from data the console already receives: who is in the team and their phones
  (and which one sends), where they are now (mini map + fix age), the current mission and for how
  long, the full timeline of stages and missions (status, times, points, answers given), every
  photo/video/audio they submitted with approve/reject/undo in place, the chat with them, and the
  score with its reasons.
- Actions on the team page: message the team, add or remove points with a reason, skip the
  current mission (with the consequence preview of `skip-keeps-the-stage`), hold/release, and the
  entry points for `send-team-back` and `quick-dial-and-actions`.
- Team search and filters above the teams list: by team name, member name, phone name or team code;
  quick filters (needs attention, waiting for review, not started, finished); sort by rank, name or
  last activity. `/` focuses search on desktop.
- Every score change is recorded on the team with its reason and who made it, so the team page can
  show a score ledger.

## Non-goals

- The same page inside the staff app (follow-up after `staff-capabilities`, which decides what a
  marshal may see).
- Rewind actions themselves (`send-team-back`) and calling (`quick-dial-and-actions`).
- New analytics.

## Surfaces

- functions: `adjustTeamScore`, `requestTaskHint` (paid hint), `skipTaskForTeam`/`skipStage`
  (consolation), the approval reversal path append to a bounded `RunTeam.scoreLedger`. Owner/staff
  readable through the team document; NOT added to the participant sanitizer.
- creator-web: `RunConsolePage.tsx`, new `components/TeamPage.tsx`, new pure `lib/teamDossier.ts`
  and `lib/teamSearch.ts`, `i18n.ts`.
- No new callable, no new index, no new listener: the page is a projection of the streams the console
  already holds (the location for ONE team comes from the existing `teamLocations` stream).
