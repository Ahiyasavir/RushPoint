# Proposal: game-intro-instructions

## Why

A real family playtest surfaced a recurring complaint: mechanics like **territory capture** and
**hot zones** feel unexplained. Players are dropped into a live run with no place that says *what
this game is* or *how these mechanics work*. Today a Game carries only a `title` + `description`
(a one-line gallery blurb); there is no authored "how to play" surface a creator can write once and
players can read (a) **before the run starts** (on the join/waiting screen) and (b) **from within
the live game** (a "How to play" button). Per-stage narrative beats (change: `narrative-chapters`)
frame a single chapter, but there is no game-level primer.

## What Changes

- A Game may carry an optional **`instructions`** primer: a `title`, a bilingual body
  (`body` / `bodyHe`, Hebrew falling back to English), and an optional `imageUrl` — exactly the
  shape and https-guard used by narrative `StoryBeat`s.
- The **Builder settings tab** gains a collapsible **"How to play"** section to author the primer
  (title + EN/HE body + optional image URL), `dir="auto"` so authored Hebrew renders RTL.
- **`updateGame`** persists the field, cleaned by a pure `cleanGameInstructions` helper (trims,
  https-guards the image, drops the field entirely when empty). When the game is public the primer
  is denormalized into `publicGames` so the pre-join **game promo/teaser** can show it too.
- **`getMyTeamState`** echoes the cleaned primer in its `game` subset (cosmetic passthrough, not
  secret), so play-web can render it on the **waiting screen before start** and behind an in-run
  **"How to play"** button/modal (reusing the narrative interstitial card style).
- Optional field: existing games and payloads are unchanged (absent ⇒ no primer, no UI surface).

## Capabilities

### New Capabilities
- `game-intro-instructions`: an optional game-level intro/instructions primer (bilingual + image),
  authored in the Builder, persisted + https-guarded server-side, and shown to players before start
  and in-game.

## Non-goals

- No per-stage or per-task instructions (that is `narrative-chapters`; this is game-level).
- No rich-text/markdown engine — plain multiline text with `whitespace-pre-line`, like beats.
- No new callable — the primer rides `updateGame` (write) and `getMyTeamState`/`publicGames` (read).
- No gating: the primer is cosmetic and never blocks joining, starting, or progression.

## Surfaces touched
- **shared types:** `GameInstructions` interface + `Game.instructions?` + `UpdateGamePayload.instructions?`
  + optional `PublicGame.instructions?`; pure `gameInstructions.ts` helpers.
- **functions:** `updateGame` persists `instructions` via `cleanGameInstructions` (+ publicGames
  resync); `getMyTeamState.game` echoes the cleaned primer. No new callable, no rules change.
- **creator-web:** Builder settings "How to play" section + i18n (EN/HE).
- **play-web:** waiting-screen primer card + in-run "How to play" button/modal + i18n (EN/HE);
  optional promo-teaser read of `publicGames.instructions`.
- **Tests:** pure `cleanGameInstructions`/`gameInstructionsHasContent` unit test (RED first);
  `getMyTeamState` echo assertion in e2e (payload changes); UI via preview.
