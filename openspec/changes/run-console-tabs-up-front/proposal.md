## Why

Field report 2026-09-25: *"the scrolling of the topics (what comes in from the field, teams and
scores, surprises etc.) in the operator console is not prominent enough and people miss it"*.

Measured on 2026-09-25 in the running app (local emulator, seeded live run with 2 teams):

| Viewport | Top of the section tabs | Tabs fully visible without sideways scroll |
|---|---|---|
| 375×812 phone | **1,665 px** (two full screens down) | 2 of 5 (a third cut, two off-screen) |
| 1400×860 desktop | **885 px** (below the first screen) | all (vertical rail) |

The tabs are also labelled only by a 12 px uppercase grey caption "מה מציגים", and on a phone they
drop the badge line that says a section has something new (`RunConsolePage.tsx:1640`,
`hidden lg:block`).

The cause is structural: the tabs render AFTER the pinned zone (`RunConsolePage.tsx:1595`), and the
pinned zone (`PANEL_GROUP` = `primary` in `lib/runConsoleLayout.ts`) holds FIVE panels: the join link,
start teams, alerts, the broadcast composer, and the whole live map. With two teams the pinned zone
alone is two phone screens. With forty it is more, because the start-teams panel grows.

## What Changes

- The sections are the console's primary navigation, directly under the run header: a sticky tab
  bar on desktop and a fixed bottom tab bar on phones, all five always visible, each with an icon, a
  short name and its live badge ("3 photos", "2 unread").
- The pinned zone shrinks to what is genuinely urgent everywhere: an active SOS/alert strip, and the
  start-teams control until teams are started. The join link moves to "share and screens", the
  broadcast composer to "surprises and control", the live map to "teams and scores".
- A section with something new since the organizer last opened it shows a dot.
- Desktop keyboard shortcuts 1–5 switch sections.

## Non-goals

- Redesigning any panel's contents.
- The team drawer and search (`team-dossier-and-search`).

## Surfaces

creator-web only: `lib/runConsoleLayout.ts` (grouping + pinned rules; data, tested), `pages/RunConsolePage.tsx`, a new `components/ConsoleTabs.tsx`, `i18n.ts`. No server change.
