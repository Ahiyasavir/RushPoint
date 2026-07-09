# Proposal — TV Leaderboard mode

## Why

Every live event already has a live leaderboard (`refreshLeaderboard`) — but participants and
spectators can only see their own team's position. There is no way to project the race standings on
a big screen / TV at the event venue, which is one of the highest-engagement moments an organizer
can create. People gather around the screen; the social energy multiplies.

## What Changes

> Observable behavior. Read-only UI surface; no new game/scoring logic.

- A **`?tv=<accessCode>`** URL renders a full-screen, auto-refreshing leaderboard optimised for a
  large display: top-N teams with rank, team name, score, and time; clean dark-room design with
  high-contrast text.
- The organizer generates the TV URL from the RunConsole in one tap; it uses the existing
  `getPublicLeaderboard` callable (published gate enforced).
- The screen **auto-refreshes** every 15 s via the existing `onSnapshot` (or a short poll fallback)
  — no manual intervention needed once it is open.
- A **"Now in the lead!"** animation fires when the top team changes between refreshes.

## Capabilities

### New Capabilities
- `tv-leaderboard`: a full-screen, auto-refreshing standings display for projection at events,
  driven by the existing published-leaderboard gate.

### Modified Capabilities
<!-- None -->

## Surfaces touched

- **play-web** only: new `apps/play-web/src/screens/TvLeaderboard.tsx` + `?tv=<accessCode>` route
  in `App.tsx`. No new callable — reads from the existing `getPublicLeaderboard` call.
- **creator-web** RunConsole: one-tap "TV screen" button that opens/copies the `?tv=` URL.
- **No Firestore rules change, no callable, no shared types** beyond a `TV_ROUTE_PARAM` constant.

## Non-goals

- No custom theming per game (fixed dark design for readability).
- No participant-side interactivity (reaction buttons etc.) — this is a pure display screen.
- No new auth — uses the same published gate as the public leaderboard.
