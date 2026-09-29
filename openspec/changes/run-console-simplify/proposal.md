## Why

Field report 2026-09-27 item 2: *"the whole admin interface and the tabs are so cumbersome and
unclear"*, *"the design is planned really badly"*, and 2026-09-28: *"it is so complicated that it is
exhausting to use"*.

Measured: 26 panels (`PanelId` in `apps/creator-web/src/lib/runConsoleLayout.ts`) in five sections
plus a pinned zone, 42 buttons, one 3,950-line page (`RunConsolePage.tsx`). The sections are named
by category ("mechanics", "moderation", "share and screens"), so the organizer has to know WHERE a
thing lives before he can do it. During the run he could not find how to start one team, pause one,
send one to a mission, or end a flash mission, and several of those do exist somewhere.

Comparable tools organise by what the organizer is doing: Loquiz's live page is five single-noun
tabs; Goosechase puts every team action in one menu on the team; a kitchen display shows only what
is waiting, with its age; dispatch tools show the map and the list side by side and act on the item
itself (`docs/field-report-2026-09-27.md`). Ahiya prefers the bold restructure over incremental
tweaks.

## What Changes

The live console becomes **three screens**, chosen from a tab bar that is always visible (top on
desktop, bottom on phones):

1. **עכשיו (Now)**, the default: ONE list of everything waiting for the organizer, oldest first,
   each row with its age and one primary action: submissions to review (with the 20 s alarm from
   `review-wait-alarm`), SOS and safety alerts, unread team and staff messages, stuck teams, teams
   waiting to start, flagged feed items. Empty ⇒ "הכל רגוע. אין מה שמחכה לך". The tab shows the count.
2. **קבוצות (Teams)**: map and team list side by side (stacked on a phone, map on top), with
   search, sort and live standings. Clicking a team, in the list or on the map, opens its page,
   where ALL team actions live: start, pause, send to a mission, send back, skip, points, message,
   call, let in, remove.
3. **משחק (Game)**: things that change the game for everyone: broadcast a message, flash missions
   (composer + live panel), pause/close a mission, hot zone, zones, trackables, and the media
   gallery / photo feed.

Everything done once or afterwards leaves the live console:
- **⋯ menu → "שיתוף והגדרות"**: join link and QR, station QR sheet, screens (TV / board), staff
  invites.
- **⋯ menu → "דוחות"** and the finished-run view: summary, analytics, heatmap, feedback, survey,
  on the existing run report page.

The header keeps only what matters on every screen: run name and state, the join code (tap to
copy), "start all" while teams are waiting, the sound state, ⋯.

## Capabilities

### Modified Capabilities
- `run-console` (from `run-console-progressive-disclosure` / `run-console-tabs-up-front`): three
  task-based screens with an inbox, replacing five category sections and the pinned zone.

## Non-goals

- Changing any panel's server behaviour or any callable.
- The Builder, dashboard (games list) and staff app.
- Removing any capability: every one of the 26 panels has a home (design D2).

## Surfaces

creator-web only: `lib/runConsoleLayout.ts` (new section model + `buildInbox`), a new
`components/console/` split of `RunConsolePage.tsx` (NowScreen, TeamsScreen, GameScreen,
ConsoleHeader, SetupSheet), `ConsoleTabs.tsx`, `TeamPage.tsx` (actions), i18n.
