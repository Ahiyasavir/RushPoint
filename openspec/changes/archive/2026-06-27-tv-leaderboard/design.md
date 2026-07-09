# Design — TV Leaderboard

## Current behavior

- `?board=<accessCode>` (play-web `App.tsx`) calls `getPublicLeaderboard` and renders the public
  shareable leaderboard. Published gate enforced by the callable.
- `refreshLeaderboard` (organizer-triggered) keeps standings fresh during the run.
- RunConsole already has a `ShareSheet` for copying links.

## Approach

Add a `?tv=<accessCode>` branch in `App.tsx` → `<TvLeaderboard accessCode={...} />`.

### `TvLeaderboard.tsx`

- Calls `getPublicLeaderboard(accessCode)` on mount then every 15 s (or real-time via
  `onSnapshot` on the run's leaderboard doc if already subscribed).
- Maintains `prevTop` to detect top-team change → triggers a CSS animation class for the new leader.
- Renders: rank medal (🥇🥈🥉 + number), team name, score badge, elapsed time. Font size scales
  to viewport (`clamp`). Dark background, high-contrast amber/white palette matching the play-web
  theme. No nav bar, no controls.
- `<meta name="viewport" content="width=device-width, initial-scale=1">` is already in `index.html`.

### Creator-web RunConsole

One `<button>` in the live-ops toolbar: "📺 TV Screen" → `window.open(tvUrl, '_blank')` where
`tvUrl = <playBaseUrl>/?tv=<accessCode>`. Also copies to clipboard.

### Shared constant

Add `TV_ROUTE_PARAM = 'tv'` to `packages/shared/src/index.ts` (alongside the existing route params).

## Test strategy (TDD)

- **Pure:** no pure-logic helpers needed — the UI is straightforward.
- **UI (preview):** render `TvLeaderboard` with mock standings; confirm ranks/names/scores render;
  simulate a refresh with a new top team → "Now in the lead!" animation class fires.
- No e2e (no new callable).

## Conventions

- No server writes, no callable. Uses existing published gate.
- No new deps. Dark-mode styles use existing Tailwind zinc palette.
