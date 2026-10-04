## Why

Ahiya, 2026-09-30: *"I want the counsellors and the operator to be able to follow a few teams they
choose, with quick access to those teams and control over them, conveniently. Very simple."*

At an event every marshal is really responsible for a handful of teams (the ones at their station,
the ones they walk with, the young ones), and the organizer keeps an eye on a few (the lost one, the
one near the finish, the test team). Today both screens show ALL teams, every time:

- the staff app is one long scroll of every team with every action on every row (a 1,699-line
  screen with ~11 sections), so reaching "my" team means scrolling and scanning names;
- the console's team list and map show the whole field, and the "now" list mixes every team's
  items with no way to say "these are mine".

Comparable tools solve exactly this with a small, personal, always-visible list: Formula 1 timing
apps let you pick drivers, highlight them against the field and focus the map on them
(Formula Live Pulse); Flightradar24 keeps a Bookmarks panel where each followed flight shows a live
one-line summary, in an order the user chooses. See `docs/console-staff-simplification-plan-2026-09-30.md`.

## What Changes

- **Follow a team** with one tap on a ☆ wherever a team appears: the team list, the team page, the
  map pin, the "now" list row, the staff app's team card. ☆ → ★. Up to **8** teams.
- **"הקבוצות שלי" strip**, always at the top (console "עכשיו" screen, staff app under the header):
  one compact card per followed team with its name, what it is doing now, and a status that is
  coloured ONLY when something is wrong (SOS, out of bounds, waiting for approval, stuck, paused,
  waiting to start). Tap a card → that team's page.
- **One action on the card**, the one that team needs right now (approve its waiting photo, let it
  in, start it, resume it); everything else stays on the team page. Only actions the person's
  staff code allows are ever offered.
- **Team page navigation**: "‹ הקבוצה הקודמת · הבאה ›" moves between followed teams without going back.
- **"רק שלי" filter** on the team list, the map (others dimmed, followed teams on top) and the
  "now" list (items of followed teams sorted first; the toggle shows only them).
- The choice is **per person and per device**, kept locally: no server, no Firestore read or write.

## Capabilities

### New Capabilities
- `followed-teams`: a personal list of followed teams in the run console and the staff app, with a
  status strip, quick navigation and a "mine only" filter.

## Non-goals

- The organizer ASSIGNING teams to marshals (a different feature: server state, permissions, a
  roster). Following is a personal view; assignment can later pre-fill it.
- Syncing the list across devices (would need a server document and writes; v1 is local).
- Any new server data: every value on a card is already streamed to both apps.
