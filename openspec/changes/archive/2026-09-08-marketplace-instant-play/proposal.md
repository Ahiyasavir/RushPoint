## Why

Public games today live in a gallery but can only be PLAYED when an organizer launches a
scheduled live run and shares a code. Geocoding-style discovery ("find a hunt near me and
play it right now, solo") is what turns a one-off event tool into an always-on destination
(Geocaching Adventure Lab, Actionbound "Bounds Nearby"). RushPoint already has the public
gallery + a self-guided demo path — this closes the gap to on-demand play of any public game.

## What Changes

- A new **`startInstantPlay`** callable lets any signed-in (anonymous) player start an
  on-demand, self-guided run of a **public** game: it lazily launches a lightweight
  auto-run (or joins an existing evergreen one) and registers the caller as a solo team,
  returning the run context — no organizer, no access code.
- The play-web **GamePromo** screen for a public game gains a **"Play now"** button that
  calls `startInstantPlay` and drops the player straight into the normal Play flow.
- Instant-play runs are flagged (`selfGuided: true`) so scoring/leaderboards stay per-run
  and billing is untouched (self-guided public play does not consume the owner's credits —
  gated by a per-game `allowInstantPlay` opt-in the creator sets when publishing).

## Capabilities

### New Capabilities
- `marketplace-instant-play`: on-demand self-guided play of an opted-in public game via
  `startInstantPlay` + a "Play now" entry point, reusing the existing run/team/scoring flow.

## Non-goals
- No new map/discovery-by-distance UI in v1 (reuses the existing gallery search); "near me"
  ranking is a later change.
- No cross-run persistent player identity (see player-profile change) — a self-guided run is
  still a normal anonymous team.
- No change to paid/credit runs — instant play is free, opt-in per game, capacity-capped.

## Surfaces touched
- **functions:** `startInstantPlay` in `runs/index.ts` (+ re-export); reuses launch/join
  internals; reads `publicGames` + the owner game template. `Game.allowInstantPlay?` opt-in
  persisted by `updateGame`/publish.
- **shared types:** `Game.allowInstantPlay?`, `Run.selfGuided?`; payload/result types.
- **play-web:** GamePromo "Play now" + wiring into the Play session; `calls.ts` wrapper; i18n.
- **rules:** unchanged (run/team stay CF-written). **Tests:** e2e — publish a game with
  `allowInstantPlay`, call `startInstantPlay` as an anon player, play + finish; a
  non-opted-in game is refused.
