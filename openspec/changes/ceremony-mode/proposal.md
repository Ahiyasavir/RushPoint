## Why

A run ends and the big screen just… shows a static table. The awards moment — the
single highest-emotion minute of the whole event — has zero production value. The
platform already has everything a finale needs: a projection leaderboard
(`?tv=<code>` / `?board=<code>` on `getPublicLeaderboard`, published-gated), final
rankings, and (with `live-photo-feed`) a run's best photos ranked by reactions. A
client-driven "ceremony" sequence turns the existing screen into a podium reveal.

## What Changes

- A new **ceremony mode** on the public board route: `?board=<code>&ceremony` plays a
  full-screen client-driven sequence:
  1. **Photo slideshow** — the run's top-liked approved feed items, auto-advancing;
  2. **Podium reveal** — 3rd place slides in, then 2nd, then 1st, with CSS
     animations and canvas confetti (zero new dependencies);
  3. **Final standings** — settles into the full ranked table.
- `getPublicLeaderboard` is **extended** (no new callable) with a capped
  **`ceremonyFeed`** array: the server selects the top-liked N=20 active feed items
  (`{taskTitle, teamName, photoUrl, totalReactions}`) — this is how an
  unauthenticated-ish big screen (play-web anonymous auth) gets photos WITHOUT any
  new rules surface: the callable is the read path, same as rankings.
- The **published gate is unchanged and fully honored**: before the organizer
  publishes the leaderboard, ceremony mode shows the same "not available" holding
  screen; `ceremonyFeed` is `[]` until `published` (photos don't leak early).
- Works with zero feed items (slideshow phase auto-skips) and with fewer than 3
  teams (podium renders what exists).

## Capabilities

### New Capabilities
- `ceremony-mode`: the pure `pickCeremonyFeed` selector + `ceremonyReducer` sequence
  state machine; the `ceremonyFeed` extension of `getPublicLeaderboard`; the play-web
  `CeremonyScreen` (slideshow → podium reveal → standings, CSS/canvas confetti).

## Non-goals

- No new callable, no rules change, no new secret — the published-leaderboard gate is
  the only access control (same as the TV board today).
- No audio/music, no remote "advance" control for the operator — the sequence is
  timer-driven client-side (v1; a presenter remote is a future change).
- No server-side rendering/recording of the ceremony (no video export).
- No per-team "personal ceremony" on phones — this is the shared big screen; the
  phone finish experience stays `FinalScreen`.
- Does not require `live-photo-feed` to ship first at runtime (empty `ceremonyFeed`
  degrades gracefully), but the server selection reads its `feedItems` collection.

## Surfaces touched

- **shared:** `packages/shared/src/ceremony.ts` — `pickCeremonyFeed(items, n)` +
  `ceremonyReducer` (phase machine) + `CeremonyFeedItem` type.
- **functions:** `getPublicLeaderboard` in `functions/src/runs/index.ts` gains the
  server-selected `ceremonyFeed` (changed callable ⇒ e2e assertions extended; no new
  callable, coverage guard unaffected).
- **play-web:** `?board=<code>&ceremony` branch in `App.tsx` → lazy
  `CeremonyScreen.tsx` (slideshow, podium, confetti canvas) + i18n EN/HE.
- **creator-web:** none (the RunConsole already shares the board link; a "+ ceremony"
  copy hint is a one-line addition to the existing share UI).
- **Tests:** `scripts/test-ceremony.ts` (pure selector + reducer); extended
  assertions in the existing public-leaderboard/e2e lifecycle scenario.
